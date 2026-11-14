/**
 * Every sound the game makes, computed as plain samples: the ball on the table, on rubber, on the
 * net and on the floor, the hall's impulse response, and the crowd. Nothing here touches Web
 * Audio or the DOM, so each sound can be measured in a test; SoundEngine wraps the samples in
 * buffers and plays them.
 *
 * The constants are TUNED by measurement of the output (spectral centroid, decay, level) against
 * what the sounds are known to be, not yet by ear: a 40 mm ball on a table is a hollow "tock"
 * whose strongest partials sit between 1 and 1.6 kHz; on rubber it is a lower, duller "pock".
 */

/** Two channels of samples at Rate, Hz. */
export interface Stereo { readonly Left: Float32Array; readonly Right: Float32Array; readonly Rate: number; }

/** A source of numbers in [0, 1): Math.random in play, a seeded one in tests. */
export type Dice = () => number;

/** A small repeatable generator (mulberry32) for tests and for sounds that should not differ between runs. */
export function Seeded(Seed: number): Dice {
    let State = Seed >>> 0;
    return () => {
        State = (State + 0x6D2B79F5) >>> 0;
        let T = State;
        T = Math.imul(T ^ (T >>> 15), T | 1);
        T ^= T + Math.imul(T ^ (T >>> 7), T | 61);
        return ((T ^ (T >>> 14)) >>> 0) / 4294967296;
    };
}

const Tau = Math.PI * 2;

/** A second-order filter (the Audio EQ Cookbook's), stepped a sample at a time. */
class Biquad {
    private X1 = 0; private X2 = 0; private Y1 = 0; private Y2 = 0;
    private B0 = 1; private B1 = 0; private B2 = 0; private A1 = 0; private A2 = 0;

    constructor(Kind: "Low" | "High" | "Band", Rate: number, Hz: number, Q: number) {
        const W = Tau * Math.min(Hz, Rate * 0.45) / Rate, Cos = Math.cos(W), Alpha = Math.sin(W) / (2 * Q);
        const A0 = 1 + Alpha;
        if (Kind === "Low") { this.B0 = (1 - Cos) / 2 / A0; this.B1 = (1 - Cos) / A0; this.B2 = this.B0; }
        else if (Kind === "High") { this.B0 = (1 + Cos) / 2 / A0; this.B1 = -(1 + Cos) / A0; this.B2 = this.B0; }
        else { this.B0 = Alpha / A0; this.B1 = 0; this.B2 = -Alpha / A0; }   // unity gain at Hz
        this.A1 = -2 * Cos / A0;
        this.A2 = (1 - Alpha) / A0;
    }

    Step(X: number): number {
        const Y = this.B0 * X + this.B1 * this.X1 + this.B2 * this.X2 - this.A1 * this.Y1 - this.A2 * this.Y2;
        this.X2 = this.X1; this.X1 = X; this.Y2 = this.Y1; this.Y1 = Y;
        return Y;
    }
}

function Filtered(In: Float32Array, Kind: "Low" | "High" | "Band", Rate: number, Hz: number, Q: number): Float32Array {
    const Stage = new Biquad(Kind, Rate, Hz, Q), Out = new Float32Array(In.length);
    for (let I = 0; I < In.length; I++) Out[I] = Stage.Step(In[I]);
    return Out;
}

function Noise(Length: number, Random: Dice): Float32Array {
    const Out = new Float32Array(Length);
    for (let I = 0; I < Length; I++) Out[I] = Random() * 2 - 1;
    return Out;
}

/** Scales Samples so the loudest is Peak. */
function Normalised(Samples: Float32Array, Peak: number): Float32Array {
    let Most = 0;
    for (let I = 0; I < Samples.length; I++) Most = Math.max(Most, Math.abs(Samples[I]));
    if (Most > 0) for (let I = 0; I < Samples.length; I++) Samples[I] *= Peak / Most;
    return Samples;
}

/** Scales both channels alike so the louder one's loudest sample is Peak. */
function NormalisedPair(Sound: Stereo, Peak: number): Stereo {
    let Most = 0;
    for (let I = 0; I < Sound.Left.length; I++) Most = Math.max(Most, Math.abs(Sound.Left[I]), Math.abs(Sound.Right[I]));
    if (Most > 0) for (let I = 0; I < Sound.Left.length; I++) { Sound.Left[I] *= Peak / Most; Sound.Right[I] *= Peak / Most; }
    return Sound;
}

function Clamp01(Value: number): number { return Math.max(0, Math.min(1, Value)); }

/** A decaying partial added to Out: Hz at Gain, dying with time constant Decay, s; Glide raises the pitch at the start by that fraction. */
function Ring(Out: Float32Array, Rate: number, Hz: number, Gain: number, Decay: number, Glide = 0, GlideDecay = 0.004): void {
    let Phase = 0;
    for (let I = 0; I < Out.length; I++) {
        const T = I / Rate;
        Phase += Tau * Hz * (1 + Glide * Math.exp(-T / GlideDecay)) / Rate;
        Out[I] += Gain * Math.sin(Phase) * Math.exp(-T / Decay);
    }
}

/** A burst of filtered noise added to Out, dying with time constant Decay, s, after an Attack, s. */
function Burst(Out: Float32Array, Rate: number, Kind: "Low" | "High" | "Band", Hz: number, Q: number, Gain: number, Decay: number, Random: Dice, Attack = 0): void {
    const Stage = new Biquad(Kind, Rate, Hz, Q);
    for (let I = 0; I < Out.length; I++) {
        const T = I / Rate;
        const Rise = Attack > 0 ? 1 - Math.exp(-T / Attack) : 1;
        Out[I] += Gain * Rise * Math.exp(-T / Decay) * Stage.Step(Random() * 2 - 1);
    }
}

/** Takes the click off the very first samples: a rise over about a fifth of a millisecond. */
function Soften(Out: Float32Array, Rate: number, Seconds = 0.0002): void {
    const Count = Math.min(Out.length, Math.ceil(Seconds * Rate * 4));
    for (let I = 0; I < Count; I++) Out[I] *= 1 - Math.exp(-I / (Seconds * Rate));
}

/**
 * The ball on the table: a hollow "tock". The ball's shell rings between 1.15 and 1.55 kHz (higher
 * the harder it lands), with a weaker overtone, the tabletop's own low knock under it, and a
 * click of bright noise at the instant of contact that grows with the impact. Hardness is 0 for
 * the softest touch and 1 for the hardest; the loudness is the caller's.
 */
export function Tock(Rate: number, Hardness: number, Random: Dice): Float32Array {
    const H = Clamp01(Hardness), Out = new Float32Array(Math.ceil(0.09 * Rate));
    const Shell = (1150 + 400 * H) * (0.98 + 0.04 * Random());
    Ring(Out, Rate, Shell, 1.0, 0.011);
    Ring(Out, Rate, Shell * 2.32, 0.30 + 0.2 * H, 0.0045);
    Ring(Out, Rate, 215, 0.32, 0.018);
    Burst(Out, Rate, "Band", 3000 + 2600 * H, 0.9, 0.30 + 0.55 * H, 0.0025, Random);
    Soften(Out, Rate);
    return Normalised(Out, 0.9);
}

/**
 * The ball on a racket's rubber: a lower, duller "pock". The sponge and blade give a body between
 * 560 and 850 Hz whose pitch falls as the ball leaves, soft noise under a low-pass that opens with
 * the stroke, and for a hard drive the blade's own sharper knock near 1.9 kHz.
 */
export function Pock(Rate: number, Hardness: number, Random: Dice): Float32Array {
    const H = Clamp01(Hardness), Out = new Float32Array(Math.ceil(0.08 * Rate));
    const Body = (560 + 290 * H) * (0.97 + 0.06 * Random());
    Ring(Out, Rate, Body, 1.0, 0.009 + 0.003 * (1 - H), 0.22);
    Ring(Out, Rate, Body * 1.59, 0.26, 0.005, 0.15);
    Ring(Out, Rate, 1900, 0.34 * H * H, 0.003);
    Burst(Out, Rate, "Low", 1700 + 2800 * H, 0.7, 0.22 + 0.4 * H, 0.006, Random);
    Soften(Out, Rate, 0.0003);
    return Normalised(Out, 0.9);
}

/** The ball brushing the net: a soft tick of high noise with a slow start, and the faint thud of the cord. */
export function NetTick(Rate: number, Hardness: number, Random: Dice): Float32Array {
    const H = Clamp01(Hardness), Out = new Float32Array(Math.ceil(0.12 * Rate));
    Burst(Out, Rate, "Band", 4200 + 1500 * H, 0.7, 1.0, 0.020, Random, 0.002);
    Burst(Out, Rate, "High", 6500, 0.7, 0.35, 0.008, Random, 0.001);
    Ring(Out, Rate, 310, 0.22, 0.014);
    Soften(Out, Rate, 0.0005);
    return Normalised(Out, 0.9);
}

/** The ball on the hall's sport floor: duller than the table, a lower shell note over a soft thud. */
export function FloorKnock(Rate: number, Hardness: number, Random: Dice): Float32Array {
    const H = Clamp01(Hardness), Out = new Float32Array(Math.ceil(0.11 * Rate));
    const Shell = (760 + 200 * H) * (0.97 + 0.06 * Random());
    Ring(Out, Rate, Shell, 0.8, 0.010);
    Ring(Out, Rate, Shell * 1.47, 0.22, 0.005);
    Ring(Out, Rate, 135, 0.6, 0.028);
    Burst(Out, Rate, "Low", 1300 + 700 * H, 0.7, 0.45, 0.007, Random);
    Soften(Out, Rate, 0.0003);
    return Normalised(Out, 0.9);
}

/** A menu's soft tick: a very short, rounded blip; Pitch 0 is a hover and 1 a click. */
export function UiTick(Rate: number, Pitch: number): Float32Array {
    const Out = new Float32Array(Math.ceil(0.05 * Rate));
    Ring(Out, Rate, 1250 + 500 * Pitch, 1.0, 0.008 + 0.006 * Pitch);
    Ring(Out, Rate, (1250 + 500 * Pitch) * 2, 0.2, 0.004);
    Soften(Out, Rate, 0.0008);
    return Normalised(Out, 0.5);
}

/** A rising chime for a game or a match won: bell-like notes a fourth and a fifth apart; Notes is 3 for a game, 5 for a match. */
export function Chime(Rate: number, Notes: number): Float32Array {
    // G4, C5, E5, G5, C6: a major chord climbing, Hz.
    const Scale = [392.0, 523.25, 659.25, 783.99, 1046.5].slice(5 - Math.max(2, Math.min(5, Notes)));
    const Gap = 0.11, Out = new Float32Array(Math.ceil((Gap * Scale.length + 1.6) * Rate));
    Scale.forEach((Hz, Index) => {
        const Note = new Float32Array(Math.ceil(1.5 * Rate));
        Ring(Note, Rate, Hz, 1.0, 0.42);
        Ring(Note, Rate, Hz * 2.0, 0.35, 0.22);
        Ring(Note, Rate, Hz * 3.01, 0.12, 0.12);
        Soften(Note, Rate, 0.002);
        const From = Math.floor(Index * Gap * Rate);
        for (let I = 0; I < Note.length; I++) Out[From + I] += Note[I];
    });
    return Normalised(Out, 0.6);
}

/**
 * The hall's impulse response: a short gap before the first reflections come back from the
 * boards and the stands, then a diffuse tail that lasts Seconds and loses its treble first, as a
 * big room full of people does. The two channels are made apart so the tail is wide.
 */
export function Hall(Rate: number, Seconds: number, Random: Dice): Stereo {
    const Length = Math.ceil(Seconds * Rate);
    const Channel = (): Float32Array => {
        const Out = new Float32Array(Length);
        // Reverberation time, s, to fall 60 dB: the low band rings the full length, the bright band under half of it.
        const LowTime = Seconds * 0.85 / 6.91, HighTime = Seconds * 0.38 / 6.91, Gap = 0.022;
        const Low = Filtered(Noise(Length, Random), "Low", Rate, 1100, 0.6);
        const High = Filtered(Noise(Length, Random), "Low", Rate, 5200, 0.6);
        for (let I = Math.floor(Gap * Rate); I < Length; I++) {
            const T = I / Rate - Gap, Build = 1 - Math.exp(-T / 0.03);
            Out[I] = Build * (0.9 * Low[I] * Math.exp(-T / LowTime) + 0.6 * High[I] * Math.exp(-T / HighTime));
        }
        // A handful of distinct early reflections, 12 to 80 ms: the floor, the boards, the far wall.
        for (let Tap = 0; Tap < 7; Tap++) {
            const At = Math.floor((0.012 + 0.068 * Random()) * Rate);
            Out[At] += (Random() < 0.5 ? -1 : 1) * (0.9 - 0.08 * Tap);
        }
        return Out;
    };
    const Made: Stereo = { Left: Channel(), Right: Channel(), Rate };
    // Level by energy, so the send's gain means the same whatever the length.
    let Energy = 0;
    for (let I = 0; I < Length; I++) Energy += Made.Left[I] * Made.Left[I] + Made.Right[I] * Made.Right[I];
    const Scale = 1 / Math.sqrt(Energy / 2);
    for (let I = 0; I < Length; I++) { Made.Left[I] *= Scale; Made.Right[I] *= Scale; }
    return Made;
}

/** One person's voice for the crowd sounds: a buzzing source through two vowel resonances. */
interface Sung {
    /** When it starts and how long it lasts, s. */
    Start: number; Seconds: number;
    /** The pitch, Hz, at U from 0 (start) to 1 (end). */
    Pitch: (U: number) => number;
    /** The loudness at U from 0 to 1. */
    Shape: (U: number) => number;
    /** The vowel's two resonances, Hz. */
    First: number; Second: number;
    Gain: number;
    /** Where it sits, 0 left to 1 right. */
    Pan: number;
    /** The share of breath (noise) in the source, 0 to 1. */
    Breath: number;
}

function Sing(Into: Stereo, Voice: Sung, Random: Dice): void {
    const Rate = Into.Rate, From = Math.floor(Voice.Start * Rate), Count = Math.floor(Voice.Seconds * Rate);
    const Low = new Biquad("Band", Rate, Voice.First, 5), High = new Biquad("Band", Rate, Voice.Second, 7);
    const LeftGain = Voice.Gain * Math.cos(Voice.Pan * Math.PI / 2), RightGain = Voice.Gain * Math.sin(Voice.Pan * Math.PI / 2);
    let Phase = Random();
    for (let I = 0; I < Count && From + I < Into.Left.length; I++) {
        const U = I / Count;
        Phase += Voice.Pitch(U) / Rate;
        Phase -= Math.floor(Phase);
        // A falling ramp is rich in harmonics, as a voice's buzz is; the resonances then pick the vowel out of it.
        const Source = (1 - Voice.Breath) * (1 - 2 * Phase) + Voice.Breath * (Random() * 2 - 1) * 1.6;
        const Sample = Voice.Shape(U) * (Low.Step(Source) + 0.55 * High.Step(Source));
        Into.Left[From + I] += LeftGain * Sample;
        Into.Right[From + I] += RightGain * Sample;
    }
}

function Silence(Rate: number, Seconds: number): Stereo {
    const Length = Math.ceil(Seconds * Rate);
    return { Left: new Float32Array(Length), Right: new Float32Array(Length), Rate };
}

/** Both channels through the same kind of filter. */
function FilteredPair(Sound: Stereo, Kind: "Low" | "High", Hz: number): Stereo {
    return { Left: Filtered(Sound.Left, Kind, Sound.Rate, Hz, 0.7), Right: Filtered(Sound.Right, Kind, Sound.Rate, Hz, 0.7), Rate: Sound.Rate };
}

/** A smooth rise and fall over a sound's length: sin squared. */
function Swell(U: number): number { const S = Math.sin(Math.PI * U); return S * S; }

/**
 * The crowd at rest: Voices people murmuring, each a run of syllables at a talking pace on a
 * drifting pitch through wandering vowels, spread across the hall, over the hall's low room
 * tone. Individually they are nonsense; together they are the hum of a full stand. The end is
 * folded into the start so it loops without a seam.
 */
export function CrowdBed(Rate: number, Seconds: number, Voices: number, Random: Dice): Stereo {
    const Fold = 1.0, Whole = Silence(Rate, Seconds + Fold);
    for (let Voice = 0; Voice < Voices; Voice++) {
        const Base = Random() < 0.55 ? 95 + 55 * Random() : 170 + 80 * Random();   // men's and women's speaking pitch, Hz
        const Pan = Random(), Level = 0.4 + 0.6 * Random();
        let At = Random() * 0.6;
        while (At < Seconds + Fold - 0.1) {
            const Length = 0.11 + 0.2 * Random(), From = Base * (0.9 + 0.25 * Random()), To = From * (0.85 + 0.25 * Random());
            Sing(Whole, {
                Start: At, Seconds: Length, Pitch: U => From + (To - From) * U, Shape: Swell,
                First: 300 + 480 * Random(), Second: 950 + 1100 * Random(),
                Gain: Level * (0.35 + 0.65 * Random()), Pan, Breath: 0.25,
            }, Random);
            // Mostly the next syllable follows at once; now and then the speaker stops to listen.
            At += Length * 0.8 + (Random() < 0.22 ? 0.3 + 1.2 * Random() : 0.03 * Random());
        }
    }
    // The room tone: the air handling and the shuffle of a few thousand people, well under the voices.
    const Stage = [new Biquad("Low", Rate, 260, 0.7), new Biquad("Low", Rate, 260, 0.7)];
    const Tone = 0.05 * Math.sqrt(Voices);
    for (let I = 0; I < Whole.Left.length; I++) {
        Whole.Left[I] += Tone * Stage[0].Step(Random() * 2 - 1);
        Whole.Right[I] += Tone * Stage[1].Step(Random() * 2 - 1);
    }
    const Length = Math.ceil(Seconds * Rate), Over = Math.floor(Fold * Rate);
    const Looped = Silence(Rate, Seconds);
    for (let I = 0; I < Length; I++) {
        // Equal power across the fold: the tail fades out under the head fading in.
        const In = I < Over ? Math.sin((I / Over) * Math.PI / 2) : 1, Out = I < Over ? Math.cos((I / Over) * Math.PI / 2) : 0;
        Looped.Left[I] = Whole.Left[I] * In + (I < Over ? Whole.Left[Length + I] * Out : 0);
        Looped.Right[I] = Whole.Right[I] * In + (I < Over ? Whole.Right[Length + I] * Out : 0);
    }
    return NormalisedPair(FilteredPair(FilteredPair(Looped, "Low", 3200), "High", 110), 0.7);
}

/**
 * Applause: every clapper claps at their own pace (2.6 to 4.6 a second, never quite evenly), with
 * their own hands' resonance and their own seat, joins within the first half second and tires at
 * their own moment. Size 0 is a polite ripple from a few dozen people, 1 an ovation from more
 * than a hundred that lasts twice as long.
 */
export function Applause(Rate: number, Size: number, Random: Dice): Stereo {
    const S = Clamp01(Size), Seconds = 2.6 + 3.2 * S, Clappers = Math.round(36 + 90 * S);
    const Made = Silence(Rate, Seconds + 0.1);
    const Grain = Math.ceil(0.035 * Rate);
    for (let Clapper = 0; Clapper < Clappers; Clapper++) {
        const Period = 1 / (2.6 + 2.0 * Random()), Hz = 850 + 1900 * Random(), Q = 1.4 + 2.2 * Random();
        const Pan = Random(), Level = 0.35 + 0.65 * Random(), Depth = 0.4 + 0.6 * Random();
        const LeftGain = Level * Math.cos(Pan * Math.PI / 2), RightGain = Level * Math.sin(Pan * Math.PI / 2);
        // The keen ones clap to the end; most stop somewhere in the second half.
        const Stops = Seconds * (0.45 + 0.55 * Random() ** 0.7);
        for (let At = 0.5 * Random() * Random(); At < Stops; At += Period * (0.9 + 0.2 * Random())) {
            const Stage = new Biquad("Band", Rate, Hz * (0.96 + 0.08 * Random()), Q);
            const From = Math.floor(At * Rate), Fade = Math.min(1, (Stops - At) / 0.8) * (0.8 + 0.2 * Random());
            for (let I = 0; I < Grain && From + I < Made.Left.length; I++) {
                // A clap is a few milliseconds of noise; a seat deeper in the stand hears it a little longer and softer.
                const Sample = Fade * Math.exp(-I / (Rate * 0.004 * (1 + Depth))) * Stage.Step(Random() * 2 - 1);
                Made.Left[From + I] += LeftGain * Sample;
                Made.Right[From + I] += RightGain * Sample;
            }
        }
    }
    // The whole hall swells in over a quarter second and dies away over the last third.
    for (let I = 0; I < Made.Left.length; I++) {
        const T = I / Rate, Shape = (1 - Math.exp(-T / 0.12)) * Math.min(1, (Seconds - T) / (Seconds * 0.35));
        Made.Left[I] *= Math.max(0, Shape);
        Made.Right[I] *= Math.max(0, Shape);
    }
    return NormalisedPair(FilteredPair(Made, "Low", 7000), 0.8);
}

/**
 * A cheer: Voices people shouting an open vowel that rises and falls, each starting when they
 * react, over a roar of breath. Size 0 is a short "yeah" from part of the stand, 1 the whole hall.
 */
export function Cheer(Rate: number, Size: number, Random: Dice): Stereo {
    const S = Clamp01(Size), Seconds = 1.8 + 1.6 * S, Voices = Math.round(18 + 30 * S);
    const Made = Silence(Rate, Seconds);
    for (let Voice = 0; Voice < Voices; Voice++) {
        const Base = Random() < 0.5 ? 150 + 90 * Random() : 260 + 160 * Random(), Rise = 1.15 + 0.3 * Random();
        const Start = 0.45 * Random() * Random(), Length = Math.min(Seconds - Start, 0.7 + (0.8 + S) * Random());
        const Open = Random() < 0.65;   // "yeah" (open) or "woo" (closed)
        Sing(Made, {
            Start, Seconds: Length,
            Pitch: U => Base * (1 + (Rise - 1) * Math.sin(Math.PI * Math.min(1, U * 1.6) / 2) - 0.12 * U),
            Shape: U => Math.min(1, U / 0.08) * (1 - U) ** 1.4,
            First: Open ? 620 + 160 * Random() : 340 + 80 * Random(), Second: Open ? 1250 + 400 * Random() : 800 + 200 * Random(),
            Gain: 0.4 + 0.6 * Random(), Pan: Random(), Breath: 0.2,
        }, Random);
    }
    const Stage = [new Biquad("Band", Rate, 1100, 0.6), new Biquad("Band", Rate, 1100, 0.6)];
    const Roar = 0.9 * Math.sqrt(Voices / 20);
    for (let I = 0; I < Made.Left.length; I++) {
        const T = I / Rate, Shape = (1 - Math.exp(-T / 0.15)) * Math.exp(-T / (0.5 + 0.5 * S)) * Math.min(1, (Seconds - T) / 0.3);
        Made.Left[I] = Made.Left[I] * Math.min(1, (Seconds - T) / 0.3) + Roar * Shape * Stage[0].Step(Random() * 2 - 1);
        Made.Right[I] = Made.Right[I] * Math.min(1, (Seconds - T) / 0.3) + Roar * Shape * Stage[1].Step(Random() * 2 - 1);
    }
    return NormalisedPair(FilteredPair(Made, "Low", 4200), 0.8);
}

/** The crowd's "ooh" at a near thing: a closed, rounded vowel from Voices people, swelling and sinking in pitch together. */
export function Ooh(Rate: number, Size: number, Random: Dice): Stereo {
    const S = Clamp01(Size), Seconds = 1.3 + 0.7 * S, Voices = Math.round(16 + 20 * S);
    const Made = Silence(Rate, Seconds);
    for (let Voice = 0; Voice < Voices; Voice++) {
        const Base = Random() < 0.55 ? 120 + 60 * Random() : 220 + 110 * Random();
        const Start = 0.22 * Random(), Length = (Seconds - Start) * (0.75 + 0.25 * Random());
        Sing(Made, {
            Start, Seconds: Length,
            Pitch: U => Base * (1 + 0.10 * Math.sin(Math.PI * Math.min(1, U * 2.2) / 2) - 0.20 * U * U),
            Shape: U => Math.sin(Math.PI * U ** 0.6) ** 1.5,
            First: 320 + 60 * Random(), Second: 760 + 140 * Random(),
            Gain: 0.4 + 0.6 * Random(), Pan: Random(), Breath: 0.12,
        }, Random);
    }
    return NormalisedPair(FilteredPair(Made, "Low", 2400), 0.7);
}

export const Synth = { Seeded, Tock, Pock, NetTick, FloorKnock, UiTick, Chime, Hall, CrowdBed, Applause, Cheer, Ooh } as const;
