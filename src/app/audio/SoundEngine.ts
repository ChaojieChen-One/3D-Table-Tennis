import { BallState } from "../../engine/BallState";
import { Vec3 } from "../../engine/math/Vec3";
import { Point } from "../../game/Referee";
import { Score } from "../../game/Scoreboard";
import { RallyEvents } from "../RallyEvents";
import { Chosen, Preferences, Prefs } from "../ui/Prefs";
import { Moment, RallyTracker } from "../ui/RallyTracker";
import { Dice, Stereo, Synth } from "./Synth";

/** The crowd layers a recorded file may replace: ./audio/<name>.mp3. */
const SampleNames = ["crowd-bed", "applause", "cheer", "ooh"] as const;
type SampleName = typeof SampleNames[number];

/**
 * Which of those files this build has, known when it is built (Vite lists the folder), so a
 * missing one costs no request and no line in the console. The entries are never imported; only
 * their names are read.
 */
const SamplesPresent: readonly string[] = Object.keys(import.meta.glob("/public/audio/*.mp3", { query: "?url" }));

function Clamp(Value: number, Low: number, High: number): number { return Math.max(Low, Math.min(High, Value)); }

/**
 * The game's sound, all of it synthesized (Synth) and played through the Web Audio API: the ball
 * on every surface, placed left to right by its x and nearer or further by its z, ringing in the
 * hall's reverberation; the crowd, which murmurs, swells with a rally, gasps and applauds; and
 * the menus' ticks. It listens to the game loop's events and starts on the first click or key,
 * as browsers require.
 *
 * The graph: each voice -> pan -> the effects bus (dry) and the hall (send); crowd layers -> the
 * crowd bus; both buses and the hall's return -> master -> a soft limiter -> the speakers.
 */
export class SoundEngine implements RallyEvents {
    /** Where the listener stands, m: behind the near end, at about head height above the table. */
    private static readonly Ear = new Vec3(0, 0.6, 2.2);

    /** TUNED: past the first metre from the listener, a ball sound falls to half its level in this many metres (the far end is about 3.7 m off). */
    private static readonly HalfLevelAt = 3.0;

    /** TUNED: a contact that changes the ball's velocity by this much, m/s, is as hard as the sounds go. */
    private static readonly HardestContact = 16;

    /** TUNED: the hall's reverberation, s, to fall 60 dB: a big hall with people in it. */
    private static readonly HallSeconds = 2.3;

    /** TUNED: the crowd's murmur between rallies, as a share of its bus, and how much each stroke of a rally adds, up to MostSwell. */
    private static readonly BedAtRest = 0.55;
    private static readonly SwellPerStroke = 0.05;
    private static readonly MostSwell = 0.6;

    /** TUNED: the least real time, s, between two "ooh"s. */
    private static readonly OohEvery = 3.5;

    private Context: AudioContext | null = null;
    private Master!: GainNode;
    private Effects!: GainNode;
    private Crowd!: GainNode;
    private HallSend!: GainNode;
    private Bed: GainNode | null = null;
    /** The applause and cheers now sounding, so a new ball can hush them. */
    private Reaction: GainNode | null = null;
    private readonly Layers: Partial<Record<string, AudioBuffer[]>> = {};
    private readonly Random: Dice = Math.random;
    private readonly Tracker = new RallyTracker();
    private LastOoh = -100;
    private LastTick = -100;

    constructor(private readonly Choices: Preferences = Prefs) {
        this.Tracker.OnMoment = What => this.React(What);
        this.Tracker.OnStroke = Strokes => {
            this.SwellTo(Strokes);
            // A rally that keeps going draws a gasp each time it passes another four strokes.
            if (Strokes >= RallyTracker.LongRally && Strokes % 4 === 0) this.SayOoh(Clamp((Strokes - 4) / 12, 0.2, 1));
        };
        Choices.Listen(Now => this.ApplyVolumes(Now));
        if (typeof window !== "undefined") {
            const Begin = () => this.Start();
            for (const Each of ["pointerdown", "keydown", "touchstart"]) window.addEventListener(Each, Begin, { capture: true, passive: true });
        }
    }

    /** True once the browser has let the sound start. */
    Running(): boolean { return this.Context !== null && this.Context.state === "running"; }

    /** Starts the sound, or wakes it; a browser allows this only from a click or a key, so it is safe to call from any. */
    Start(): void {
        if (this.Context !== null) {
            if (this.Context.state === "suspended") void this.Context.resume();
            return;
        }
        const Made = typeof AudioContext !== "undefined" ? AudioContext : (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (Made === undefined) return;
        const Context = this.Context = new Made({ latencyHint: "interactive" });
        // The limiter only catches peaks: a hard smash under applause must not clip, nor pump the crowd.
        const Limiter = Context.createDynamicsCompressor();
        Limiter.threshold.value = -9;   // dB
        Limiter.knee.value = 8;         // dB
        Limiter.ratio.value = 14;
        Limiter.attack.value = 0.002;   // s
        Limiter.release.value = 0.14;   // s
        Limiter.connect(Context.destination);
        this.Master = Context.createGain();
        this.Master.connect(Limiter);
        this.Effects = Context.createGain();
        this.Effects.connect(this.Master);
        this.Crowd = Context.createGain();
        this.Crowd.connect(this.Master);
        const Room = Context.createConvolver();
        Room.buffer = this.Buffer(Synth.Hall(Context.sampleRate, SoundEngine.HallSeconds, this.Random));
        this.HallSend = Context.createGain();
        this.HallSend.connect(Room);
        const Return = Context.createGain();
        Return.gain.value = 0.9;   // TUNED: the hall's level against the dry sound, before each voice's own send
        Room.connect(Return);
        Return.connect(this.Effects);
        this.ApplyVolumes(this.Choices.Get(), true);
        void Context.resume();
        this.PrepareCrowd();
    }

    Muted(): boolean { return this.Choices.Get().Muted; }

    ToggleMute(): void {
        this.Choices.Set({ Muted: !this.Muted() });
        if (!this.Muted()) this.Click();
    }

    /** The graph's nodes, for a scripted check that the sound is wired; null before Start. */
    Probe(): { Context: AudioContext; Master: GainNode; Effects: GainNode; Crowd: GainNode } | null {
        return this.Context === null ? null : { Context: this.Context, Master: this.Master, Effects: this.Effects, Crowd: this.Crowd };
    }

    // ---- The menus.

    /** A pointer came over a button; at most one every 40 ms, so sweeping a row does not rattle. */
    Tick(): void {
        if (this.Context === null || this.Context.currentTime - this.LastTick < 0.04) return;
        this.LastTick = this.Context.currentTime;
        this.Voice(Synth.UiTick(this.Context.sampleRate, 0), { Gain: 0.10 });
    }

    Click(): void {
        if (this.Context !== null) this.Voice(Synth.UiTick(this.Context.sampleRate, 1), { Gain: 0.22 });
    }

    /** The rising chime of a game won (3 notes) or a match (5). */
    Chime(Notes: number): void {
        if (this.Context !== null) this.Voice(Synth.Chime(this.Context.sampleRate, Notes), { Gain: 0.3, Send: 0.25 });
    }

    // ---- The rally (RallyEvents).

    Bounce(At: Vec3, SpeedChange: number, Ball: BallState): void {
        this.Tracker.Bounce(At, SpeedChange, Ball);
        if (this.Context === null) return;
        const Hard = SoundEngine.Hardness(SpeedChange);
        this.Voice(Synth.Tock(this.Context.sampleRate, Hard, this.Random), { Gain: 0.75 * SoundEngine.Level(SpeedChange), At });
    }

    Hit(Racket: number, At: Vec3, SpeedChange: number, Ball: BallState): void {
        this.Tracker.Hit(Racket, At, SpeedChange, Ball);
        if (this.Context === null) return;
        const Hard = SoundEngine.Hardness(SpeedChange);
        // The player's own racket is the nearest thing in the hall: a little louder than its distance alone says.
        const Own = Racket === 0 ? 1.2 : 1.0;
        this.Voice(Synth.Pock(this.Context.sampleRate, Hard, this.Random), { Gain: 0.85 * Own * SoundEngine.Level(SpeedChange), At });
    }

    Net(At: Vec3, SpeedChange: number): void {
        this.Tracker.Net(At, SpeedChange);
        if (this.Context === null) return;
        this.Voice(Synth.NetTick(this.Context.sampleRate, SoundEngine.Hardness(SpeedChange), this.Random), { Gain: 0.4 * SoundEngine.Level(SpeedChange), At });
    }

    Floor(At: Vec3, SpeedChange: number): void {
        if (this.Context === null) return;
        this.Voice(Synth.FloorKnock(this.Context.sampleRate, SoundEngine.Hardness(SpeedChange), this.Random), { Gain: 0.6 * SoundEngine.Level(SpeedChange), At });
    }

    NewBall(Ball: BallState): void {
        this.Tracker.NewBall(Ball);
        this.Hush();
    }

    Point(Called: Point, Now: Score): void {
        const Strokes = this.Tracker.Strokes;
        this.Tracker.Point(Called);
        if (this.Context === null) return;
        this.SwellTo(0);
        if (Now.MatchWinner !== null) { this.Applaud(1.0, 1.0); this.Chime(5); return; }
        if (Now.GameWinner !== null) { this.Applaud(0.75, 0.7); this.Chime(3); return; }
        if (Called.Winner === null) return;
        // An ordinary point: a ripple for a short one, more the longer the rally ran, and a cheer only for a real one.
        const Size = Clamp(0.12 + 0.05 * Strokes, 0.12, 0.6);
        this.Applaud(Size, Strokes >= 6 ? Size * 0.8 : 0);
    }

    // ---- Inside.

    /** Hardness 0 to 1 from how much the contact changed the ball's velocity, m/s. */
    private static Hardness(SpeedChange: number): number { return Clamp(SpeedChange / SoundEngine.HardestContact, 0, 1); }

    /** Loudness from the same: quiet touches stay audible, and a contact twice as hard is well short of twice as loud. */
    private static Level(SpeedChange: number): number { return Clamp(Math.pow(SpeedChange / 9, 0.65), 0.1, 1.3); }

    private Buffer(Sound: Stereo): AudioBuffer {
        const Made = this.Context!.createBuffer(2, Sound.Left.length, Sound.Rate);
        Made.getChannelData(0).set(Sound.Left);
        Made.getChannelData(1).set(Sound.Right);
        return Made;
    }

    /**
     * Plays one short sound. At places it in the hall: panned by x, quieter and duller with its
     * distance from the listener, and with more of the hall in it the further off it is.
     */
    private Voice(Samples: Float32Array, How: { Gain: number; At?: Vec3; Send?: number }): void {
        const Context = this.Context!;
        const Made = Context.createBuffer(1, Samples.length, Context.sampleRate);
        Made.getChannelData(0).set(Samples);
        const Source = Context.createBufferSource();
        Source.buffer = Made;
        let Tail: AudioNode = Source, Level = How.Gain, Send = How.Send ?? 0.1;
        if (How.At !== undefined) {
            const Far = How.At.Minus(SoundEngine.Ear).Length();
            Level *= SoundEngine.HalfLevelAt / (SoundEngine.HalfLevelAt + Math.max(0, Far - 1));
            // Air and distance take the top off: wide open at the player's racket, about 7 kHz at the far end.
            const Dull = Context.createBiquadFilter();
            Dull.type = "lowpass";
            Dull.frequency.value = Clamp(19000 / (1 + 0.55 * Math.max(0, Far - 1)), 4500, 19000);
            Tail.connect(Dull);
            const Pan = Context.createStereoPanner();
            // TUNED: the table's edge (0.76 m) sits about half way to one side.
            Pan.pan.value = Clamp(How.At.X / 1.5, -0.85, 0.85);
            Dull.connect(Pan);
            Tail = Pan;
            Send = 0.10 + 0.06 * Far;
        }
        const Dry = Context.createGain();
        Dry.gain.value = Level;
        Tail.connect(Dry);
        Dry.connect(this.Effects);
        const Wet = Context.createGain();
        Wet.gain.value = Level * Send;
        Tail.connect(Wet);
        Wet.connect(this.HallSend);
        Source.start();
    }

    private ApplyVolumes(Now: Chosen, AtOnce = false): void {
        if (this.Context === null) return;
        // A slider's square is nearer to how loud it sounds than the slider itself.
        const Set = (Node: GainNode, Value: number) => {
            if (AtOnce) Node.gain.value = Value; else Node.gain.setTargetAtTime(Value, this.Context!.currentTime, 0.03);
        };
        Set(this.Master, Now.Muted ? 0 : Now.Master * Now.Master);
        Set(this.Effects, Now.Effects * Now.Effects);
        // TUNED: the crowd bus at full slider is still under the ball; see Prefs for the default.
        Set(this.Crowd, 0.8 * Now.Crowd * Now.Crowd);
    }

    /**
     * Makes the crowd's layers a few at a time between frames, so the first click does not stall
     * the game: the murmur first (it starts as soon as it exists), then the reactions.
     */
    private PrepareCrowd(): void {
        const Jobs: Array<() => void> = [
            () => { this.Layers["crowd-bed"] = [this.Buffer(Synth.CrowdBed(24000, 9, 30, this.Random))]; this.StartBed(); },
            () => { this.Layers["applause"] = [this.Buffer(Synth.Applause(32000, 0.15, this.Random))]; },
            () => { this.Layers["ooh"] = [this.Buffer(Synth.Ooh(24000, 0.4, this.Random)), this.Buffer(Synth.Ooh(24000, 1, this.Random))]; },
            () => { this.Layers["applause"]!.push(this.Buffer(Synth.Applause(32000, 0.5, this.Random))); },
            () => { this.Layers["cheer"] = [this.Buffer(Synth.Cheer(32000, 0.3, this.Random))]; },
            () => { this.Layers["applause"]!.push(this.Buffer(Synth.Applause(32000, 1, this.Random))); },
            () => { this.Layers["cheer"]!.push(this.Buffer(Synth.Cheer(32000, 1, this.Random))); },
        ];
        const Next = () => {
            const Job = Jobs.shift();
            if (Job === undefined) { void this.LoadSamples(); return; }
            Job();
            setTimeout(Next, 30);
        };
        setTimeout(Next, 30);
    }

    /** A recorded file, where the build has one, takes the place of the synthesized layer of its name. */
    private async LoadSamples(): Promise<void> {
        const Context = this.Context!;
        for (const Name of SampleNames) {
            if (!SamplesPresent.some(Each => Each.endsWith(`/${Name}.mp3`))) continue;
            try {
                const Answer = await fetch(`./audio/${Name}.mp3`);
                if (!Answer.ok) throw new Error(String(Answer.status));
                this.Layers[Name] = [await Context.decodeAudioData(await Answer.arrayBuffer())];
                if (Name === "crowd-bed") this.StartBed();
            } catch (Failure) {
                console.debug(`Sound: ./audio/${Name}.mp3 could not be used (${(Failure as Error).message}); the synthesized ${Name} stays.`);
            }
        }
    }

    private BedSource: AudioBufferSourceNode | null = null;

    private StartBed(): void {
        const Context = this.Context!, Loop = this.Layers["crowd-bed"]?.[0];
        if (Loop === undefined) return;
        this.BedSource?.stop();
        const Source = this.BedSource = Context.createBufferSource();
        Source.buffer = Loop;
        Source.loop = true;
        if (this.Bed === null) {
            this.Bed = Context.createGain();
            this.Bed.gain.value = 0;
            this.Bed.connect(this.Crowd);
            // The murmur comes up over a couple of seconds, not at a stroke.
            this.Bed.gain.setTargetAtTime(SoundEngine.BedAtRest, Context.currentTime, 1.2);
        }
        Source.connect(this.Bed);
        Source.start();
    }

    /** The murmur rises with each stroke of a rally and settles when it ends. */
    private SwellTo(Strokes: number): void {
        if (this.Context === null || this.Bed === null) return;
        const Extra = Math.min(SoundEngine.MostSwell, SoundEngine.SwellPerStroke * Math.max(0, Strokes - 2));
        this.Bed.gain.setTargetAtTime(SoundEngine.BedAtRest + Extra, this.Context.currentTime, 0.7);
    }

    /** Before the next ball the hall goes quiet: the applause dies and the murmur drops, then finds its level again. */
    private Hush(): void {
        if (this.Context === null) return;
        const Now = this.Context.currentTime;
        this.Reaction?.gain.setTargetAtTime(0, Now, 0.35);
        this.Reaction = null;
        if (this.Bed !== null) {
            this.Bed.gain.cancelScheduledValues(Now);
            this.Bed.gain.setTargetAtTime(SoundEngine.BedAtRest * 0.55, Now, 0.25);
            this.Bed.gain.setTargetAtTime(SoundEngine.BedAtRest, Now + 1.2, 1.5);
        }
    }

    /** Plays the layer's variant nearest Size (0 to 1) on the crowd bus at Gain, and returns its gain node. */
    private Layer(Name: SampleName, Size: number, Gain: number, Delay = 0): GainNode | null {
        const Context = this.Context!, Variants = this.Layers[Name];
        if (Variants === undefined || Variants.length === 0) return null;
        const Source = Context.createBufferSource();
        Source.buffer = Variants[Math.min(Variants.length - 1, Math.round(Size * (Variants.length - 1)))];
        // No two reactions quite alike: a few percent of pitch either way.
        Source.playbackRate.value = 0.96 + 0.08 * this.Random();
        const Level = Context.createGain();
        Level.gain.value = Gain;
        Source.connect(Level);
        Level.connect(this.Crowd);
        Source.start(Context.currentTime + Delay);
        return Level;
    }

    /** Applause of Size (0 to 1), with a cheer of CheerSize over its start if that is above 0. */
    private Applaud(Size: number, CheerSize: number): void {
        // The hall takes a moment to react; the cheer comes first and the clapping under it.
        const Shared = this.Context!.createGain();
        Shared.connect(this.Crowd);
        const Join = (Made: GainNode | null) => { if (Made !== null) { Made.disconnect(); Made.connect(Shared); } };
        Join(this.Layer("applause", Size, 0.5 + 0.5 * Size, 0.18));
        if (CheerSize > 0) Join(this.Layer("cheer", CheerSize, 0.35 + 0.45 * CheerSize, 0.08));
        this.Reaction = Shared;
    }

    private SayOoh(Size: number): void {
        if (this.Context === null || this.Context.currentTime - this.LastOoh < SoundEngine.OohEvery) return;
        this.LastOoh = this.Context.currentTime;
        this.Layer("ooh", Size, 0.45 + 0.4 * Size, 0.05);
    }

    private React(What: Moment): void {
        if (What.Kind === "Smash") this.SayOoh(Clamp((What.Kmh - 25) / 40, 0.3, 1));
        else if (What.Kind === "NetCord" || What.Kind === "Edge") this.SayOoh(0.5);
    }
}
