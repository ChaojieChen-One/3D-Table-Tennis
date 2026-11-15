import { BallState } from "../engine/BallState";
import { Vec3 } from "../engine/math/Vec3";
import { Point } from "../game/Referee";
import { Score } from "../game/Scoreboard";
import { Side, SideNames } from "../game/Side";
import { CameraRig } from "./camera/CameraRig";
import { RallyEvents } from "./RallyEvents";
import { Announcer } from "./ui/Announcer";
import { ControlsList } from "./ui/Controls";
import { HudButton, Icon, Make, Replay } from "./ui/Dom";
import { BrightnessControl, MenuOverlay } from "./ui/MenuOverlay";
import { Level, Prefs, Quality } from "./ui/Prefs";
import { Moment, RallyTracker } from "./ui/RallyTracker";
import { ScoreBug } from "./ui/ScoreBug";
import { SpinGauge } from "./ui/SpinGauge";

/** The speaker, drawn sounding and silenced. */
const SpeakerOn = "M4 9.5h3.5L12 5.5v13l-4.5-4H4zM15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11";
const SpeakerOff = "M4 9.5h3.5L12 5.5v13l-4.5-4H4zM16 9.5l5 5M21 9.5l-5 5";

/**
 * The 2D layer over the court, in the manner of a televised match: the scoreboard, the umpire's
 * calls, the rally's length, the player's shot speed and the ball's spin, with the menus (title,
 * settings, pause, results) over it all. The game loop tells it the score and the spin every
 * frame and the rally's events as they happen (it is a RallyEvents listener); it reaches back
 * into nothing but the callbacks it was given.
 */
export class CourtOverlay implements RallyEvents {
    /** TUNED: the rally counter appears from this stroke on. */
    private static readonly CountFrom = 4;

    /** TUNED: the least real time, ms, between two accolades, and how long one stays. */
    private static readonly AccoladeEvery = 2600;
    private static readonly AccoladeFor = 2200;

    /** TUNED: how long after the match's last call its results card comes up, real ms: after the band has been read. */
    private static readonly ResultsAfter = 2400;

    /** Everything this class draws; main adds it to the page. */
    readonly Root = Make("div", "ui-root");

    /** The menus over the arena: the title, settings, pause and results. */
    readonly Menu: MenuOverlay;

    private readonly Layer = Make("div", "hud");
    private readonly Bug = new ScoreBug();
    private readonly Calls = new Announcer();
    private readonly Gauge = new SpinGauge();
    private readonly Tracker = new RallyTracker();
    private readonly Speed = Make("div", "chip chip-speed");
    private readonly Shot = Make("div", "chip chip-shot");
    private readonly ShotValue = Make("span", "chip-value", "–");
    private readonly Count = Make("div", "rally");
    private readonly CountValue = Make("span", "rally-value", "0");
    private readonly Accolade = Make("div", "accolade");
    private readonly Keys = Make("div", "hud-keys");
    private readonly Views = Make("div", "hud-views");
    private readonly Sound = HudButton("", () => Prefs.Set({ Muted: !Prefs.Get().Muted }), "hud-icon");
    private readonly Link = Make("div", "chip chip-link");

    private ShownScore: Score | null = null;
    private ShownCall: Point | null = null;
    private Names: SideNames = { Near: "Player", Far: "Computer" };
    private Badges: SideNames = { Near: "YOU", Far: "CPU" };
    private OnMatch: () => void = () => {};
    private SpeedLine = "";
    /** The points of each finished game of the match being played, for the results card. */
    private Games: Array<{ Near: number; Far: number }> = [];
    private MatchOver = false;
    private LastAccolade = -1e9;
    private AccoladeLeaves = 0;
    private ResultsDue = 0;

    constructor(Rig: CameraRig, Brightness: BrightnessControl) {
        this.Menu = new MenuOverlay(Brightness);

        const TopLeft = Make("div", "hud-top-left");
        TopLeft.append(this.Bug.Root);

        // Top centre, above the far end of the table: the rally's length and the accolades, clear of the ball's path.
        const TopCentre = Make("div", "hud-top-centre");
        this.Count.append(Make("span", "rally-label", "RALLY"), this.CountValue);
        this.Count.hidden = this.Accolade.hidden = true;
        TopCentre.append(this.Count, this.Accolade);

        const Help = HudButton("", () => { this.Keys.hidden = !this.Keys.hidden; Help.setAttribute("aria-expanded", String(!this.Keys.hidden)); }, "hud-button hud-help");
        Help.append(Make("span", "hud-help-mark", "?"), Make("span", "hud-wide", "CONTROLS"));
        Help.setAttribute("aria-label", "Controls");
        Help.setAttribute("aria-expanded", "false");
        const Pause = HudButton("", () => this.Menu.Show("Pause"), "hud-icon");
        Pause.append(Icon("M5 7h14M5 12h14M5 17h14"));
        Pause.setAttribute("aria-label", "Menu (Esc)");
        Pause.title = "Menu (Esc)";
        this.Sound.title = "Sound (N)";
        const Corner = Make("div", "hud-row");
        Corner.append(Help, this.Sound, Pause);
        this.Keys.append(ControlsList(true));
        this.Keys.hidden = true;
        this.Link.hidden = true;
        const TopRight = Make("div", "hud-top-right");
        TopRight.append(Corner, this.Link, this.Keys);

        this.Shot.append(Make("span", "chip-label", "SHOT"), this.ShotValue, Make("span", "chip-unit", "KM/H"));
        this.Shot.hidden = true;
        const BottomLeft = Make("div", "hud-bottom-left");
        BottomLeft.append(this.Gauge.Root, this.Shot, this.Speed);

        const ViewRow = Make("div", "hud-row");
        ViewRow.append(HudButton("1  PLAYER", () => Rig.Reset()), HudButton("2  COURTSIDE", () => Rig.View("courtside")),
                       HudButton("3  OVERHEAD", () => Rig.View("overhead")), HudButton("4  REVERSE", () => Rig.View("reverse")),
                       HudButton("7  HALL", () => Rig.View("hall")), HudButton("8  RACKET", () => Rig.View("racket")));
        this.Views.append(ViewRow, Make("div", "hud-note", "DRAG TO ORBIT  ·  SCROLL TO ZOOM  ·  5–6 SIDE VIEWS  ·  R RESET  ·  H HIDE HUD"));
        this.Views.hidden = true;
        const Toggles = Make("div", "hud-row");
        Toggles.append(HudButton("M  MATCH", () => this.OnMatch()), HudButton("CAMERA", () => { this.Views.hidden = !this.Views.hidden; }));
        const BottomRight = Make("div", "hud-bottom-right");
        BottomRight.append(this.Views, Toggles);

        this.Layer.append(TopLeft, TopCentre, TopRight, BottomLeft, BottomRight, this.Calls.Root);
        this.Root.append(this.Layer, this.Menu.Root);

        this.Tracker.OnStroke = (Strokes, Racket, Kmh) => this.ShowStroke(Strokes, Racket, Kmh);
        this.Tracker.OnMoment = What => this.Praise(What);
        Prefs.Listen(() => this.ShowSound());
        this.ShowSound();
        this.SetOpponent("CPU", "Computer");
    }

    // ---- What the game loop and main call.

    /** The ball's spin in words (SpinLine); called every frame, so the gauge changes only when the words do. */
    ShowSpin(Line: string): void { this.Gauge.Show(Line); }

    /** The game speed, or that it is paused, set by the game loop when either changes. */
    ShowSpeed(Line: string): void {
        this.SpeedLine = Line;
        const Percent = /(\d+)%/.exec(Line);
        this.Speed.replaceChildren();
        if (Percent !== null) {
            this.Speed.append(Make("span", "chip-label", "SPEED"), Make("span", "chip-value", Percent[1]), Make("span", "chip-unit", "%"));
            this.Menu.ShowSpeed(Number(Percent[1]) / 100);
        } else {
            this.Speed.append(Make("span", "chip-value", Line.split("  ·  ")[0]));
        }
        if (Line.includes("ONLINE")) this.Speed.append(Make("span", "chip-note live", "ONLINE"));
        this.Speed.classList.toggle("paused", this.Paused());
    }

    /** True while the game loop says it is paused. */
    Paused(): boolean { return this.SpeedLine.startsWith("PAUSED"); }

    /** Settings, as the "?settings" option and the old DISPLAY SETTINGS button opened them. */
    ShowDisplaySettings(): void { this.Menu.Show("Settings"); }

    SetOnMatch(Action: () => void): void { this.OnMatch = Action; }

    /** Opens the Match page, as the M key and the MATCH button do. */
    OpenMatch(): void { this.OnMatch(); }

    /** H: hides the in-play HUD (a menu that is open stays). */
    ToggleVisible(): void { this.Layer.hidden = !this.Layer.hidden; }

    /** True while a menu is open: the racket and the game's keys should then be left alone. */
    IsOpen(): boolean { return this.Menu.IsOpen(); }

    /** The ball beside whoever serves on the scoreboard; null hides it. */
    SetServer(Server: Side | null): void { this.Bug.SetServer(Server); }

    /** A short instruction low in the middle of the screen, e.g. "DOUBLE-CLICK TO SERVE"; empty hides it. */
    ShowPrompt(Text: string): void {
        if (this.Prompt.parentElement === null) { this.Prompt.className = "hud-prompt"; this.Prompt.hidden = true; this.Root.append(this.Prompt); }
        this.Prompt.hidden = Text === "";
        if (this.Prompt.textContent !== Text) this.Prompt.textContent = Text;
    }
    private readonly Prompt = document.createElement("div");

    /** The line about the connection under the corner buttons, e.g. "PING 34 ms · DIRECT"; empty hides it. */
    ShowLink(Text: string): void {
        this.Link.hidden = Text === "";
        if (this.Link.textContent !== Text) this.Link.textContent = Text;
    }

    /** Tells Listener the graphics quality chosen in Settings, now and whenever it changes. */
    OnQuality(Listener: (Chosen: Quality) => void): void {
        this.Menu.OnQuality = Listener;
        Listener(Prefs.Get().Quality);
    }

    /** Tells Listener the opponent's level chosen on the title or in Settings, now and whenever it changes. */
    OnLevel(Listener: (Chosen: Level) => void): void {
        this.Menu.OnLevel = Listener;
        Listener(Prefs.Get().Level);
    }

    /** Tells Listener the game speed picked in Settings, game seconds per real second (0.1 to 1). */
    OnSpeed(Listener: (Value: number) => void): void { this.Menu.OnSpeed = Listener; }

    /** The far end's badge on the scoreboard (CPU, or OPP in a match) and its name in the calls. */
    SetOpponent(Badge: string, Name: string): void {
        this.Badges = { Near: "YOU", Far: Badge };
        this.Names = { Near: "Player", Far: Name };
        this.Bug.SetBadges(this.Badges);
        this.ShownScore = null;   // so the next ShowScore redraws the board for the new rally
        // A match begun from the title or the pause menu is played, not looked at through a menu.
        if (Badge !== "CPU" && this.Menu.IsOpen()) this.Menu.Close();
    }

    /**
     * The score and the umpire's last call: who won the point and why, or the game or match.
     * Called every frame, so the board and the banner change only when the score or the call does.
     */
    ShowScore(Now: Score, Called: Point | null): void {
        const NewCall = Called !== this.ShownCall;
        if (this.ShownScore !== null && Now.Equals(this.ShownScore) && !NewCall) return;
        this.ShownScore = Now;
        this.ShownCall = Called;
        this.Bug.Show(Now);
        if (!NewCall) return;
        window.clearTimeout(this.ResultsDue);
        if (Called === null) {
            // A fresh rally (a new match, or back to practice) has no call yet: don't leave the last one's up.
            this.Calls.Clear();
            this.Games = [];
            this.MatchOver = false;
            return;
        }
        this.Calls.Call(Called, Now, this.Badges, this.Names);
        if (Now.GameWinner === null) return;
        if (this.MatchOver) { this.Games = []; this.MatchOver = false; }
        this.Games.push({ Near: Now.NearPoints, Far: Now.FarPoints });
        if (Now.MatchWinner === null) return;
        this.MatchOver = true;
        const Result = { Won: Now.MatchWinner === "Near", Badges: this.Badges, NearGames: Now.NearGames, FarGames: Now.FarGames, Games: [...this.Games] };
        this.ResultsDue = window.setTimeout(() => { this.Calls.Clear(false); this.Menu.ShowResults(Result); }, CourtOverlay.ResultsAfter);
    }

    // ---- The rally's events (RallyEvents).

    NewBall(Ball: BallState): void {
        this.Tracker.NewBall(Ball);
        this.Calls.Clear(false);
        this.Count.hidden = true;
    }

    Hit(Racket: number, At: Vec3, SpeedChange: number, Ball: BallState): void { this.Tracker.Hit(Racket, At, SpeedChange, Ball); }

    Bounce(At: Vec3, SpeedChange: number, Ball: BallState): void { this.Tracker.Bounce(At, SpeedChange, Ball); }

    Net(At: Vec3, SpeedChange: number): void { this.Tracker.Net(At, SpeedChange); }

    Point(Called: Point, _Now: Score): void { this.Tracker.Point(Called); }

    // ---- Inside.

    private ShowSound(): void {
        const Muted = Prefs.Get().Muted;
        this.Sound.replaceChildren(Icon(Muted ? SpeakerOff : SpeakerOn));
        this.Sound.classList.toggle("off", Muted);
        this.Sound.setAttribute("aria-label", Muted ? "Sound off (N)" : "Sound on (N)");
        this.Sound.setAttribute("aria-pressed", String(!Muted));
    }

    private ShowStroke(Strokes: number, Racket: number, Kmh: number): void {
        if (Racket === 0) {
            this.Shot.hidden = false;
            this.ShotValue.textContent = Kmh.toFixed(0);
            Replay(this.Shot, "fresh");
        }
        if (Strokes < CourtOverlay.CountFrom) return;
        const Shown = this.Count.hidden;
        this.Count.hidden = false;
        this.CountValue.textContent = String(Strokes);
        Replay(Shown ? this.Count : this.CountValue, Shown ? "entering" : "tick");
    }

    /** A word for a notable moment, no more often than AccoladeEvery; a moment that comes too soon is let go. */
    private Praise(What: Moment): void {
        const Now = performance.now();
        if (Now - this.LastAccolade < CourtOverlay.AccoladeEvery) return;
        this.LastAccolade = Now;
        const Line = What.Kind === "Smash" ? `SMASH  ${What.Kmh.toFixed(0)} KM/H`
            : What.Kind === "NetCord" ? "NET CORD"
            : What.Kind === "Edge" ? "EDGE"
            : `${What.Strokes}-SHOT RALLY`;
        this.Accolade.textContent = Line;
        this.Accolade.hidden = false;
        this.Accolade.classList.remove("leaving");
        Replay(this.Accolade, "entering");
        window.clearTimeout(this.AccoladeLeaves);
        this.AccoladeLeaves = window.setTimeout(() => {
            this.Accolade.classList.add("leaving");
            this.AccoladeLeaves = window.setTimeout(() => { this.Accolade.hidden = true; }, 300);
        }, CourtOverlay.AccoladeFor);
    }
}
