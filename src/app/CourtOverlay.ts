import { Point } from "../game/Referee";
import { Score } from "../game/Scoreboard";
import { Other, Side, SideNames } from "../game/Side";
import { CameraRig } from "./camera/CameraRig";

function Make<K extends keyof HTMLElementTagNameMap>(Tag: K, Class: string, Text = ""): HTMLElementTagNameMap[K] {
    const Made = document.createElement(Tag);
    Made.className = Class;
    if (Text) Made.textContent = Text;
    return Made;
}

function Button(Title: string, Action: () => void): HTMLButtonElement {
    const Made = Make("button", "hud-button", Title);
    Made.type = "button";
    Made.tabIndex = -1;   // keys belong to the game, never to a focused button
    Made.addEventListener("click", Event => { Action(); (Event.currentTarget as HTMLElement).blur(); });
    return Made;
}

/**
 * The HUD: the score, the umpire's last call, the ball's spin, the game speed, the controls
 * legend, and the camera and display settings. Only working controls are shown.
 */
export class CourtOverlay {
    readonly Root = Make("div", "hud");
    private readonly Spin = Make("div", "hud-chip", "SPIN   none");
    private readonly Speed = Make("div", "hud-chip");
    private readonly Call = Make("div", "hud-chip hud-call", "FIRST TO 11  ·  BEST OF 5");
    private readonly Board = Make("div", "score");
    private readonly Cells: Record<Side, { Name: HTMLElement; Games: HTMLElement; Points: HTMLElement }>;
    private readonly Display = Make("div", "hud-panel");
    private readonly Views = Make("div", "hud-views");
    private ShownScore: Score | null = null;
    private ShownCall: Point | null = null;
    private Names: SideNames = { Near: "Player", Far: "Computer" };
    private Badges: SideNames = { Near: "YOU", Far: "CPU" };
    private OnMatch: () => void = () => {};

    constructor(Rig: CameraRig, Brightness: { Get: () => number; Set: (Percent: number) => void }) {
        const Row = (Colour: string) => {
            const Line = Make("div", "score-row");
            const Name = Make("div", "score-name");
            const Badge = Make("div", "score-badge");
            const Disc = Make("span", "score-disc");
            Disc.style.background = Colour;
            Badge.append(Disc);
            const Games = Make("div", "score-games", "0"), Points = Make("div", "score-points", "0");
            Line.append(Name, Badge, Games, Points);
            this.Board.append(Line);
            return { Name, Games, Points };
        };
        this.Cells = { Near: Row("#c83446"), Far: Row("#253648") };
        this.Board.setAttribute("role", "status");
        const TopLeft = Make("div", "hud-top-left");
        TopLeft.append(this.Board, this.Call, this.Spin, this.Speed);

        const ViewRow = Make("div", "hud-row");
        ViewRow.append(Button("1  PLAYER", () => Rig.Reset()), Button("2  COURTSIDE", () => Rig.View("courtside")),
                       Button("3  OVERHEAD", () => Rig.View("overhead")), Button("4  REVERSE", () => Rig.View("reverse")),
                       Button("7  HALL", () => Rig.View("hall")), Button("8  RACKET", () => Rig.View("racket")));
        this.Views.append(ViewRow, Make("div", "hud-chip hud-help", "DRAG TO ORBIT   /   SCROLL TO ZOOM   /   5–6 SIDE VIEWS   /   R RESET   /   H HIDE UI"));
        this.Views.hidden = true;

        const Heading = Make("div", "hud-panel-heading");
        const Value = Make("span", "", "");
        Heading.append(Make("span", "", "BRIGHTNESS"), Value);
        const Slider = Make("input", "hud-slider");
        Object.assign(Slider, { type: "range", min: "30", max: "100", step: "1" });
        Slider.setAttribute("aria-label", "Court brightness");
        const Show = () => { Slider.value = String(Brightness.Get()); Value.textContent = `${Math.round(Brightness.Get())}%`; };
        Slider.addEventListener("input", () => { Brightness.Set(Number(Slider.value)); Show(); });
        Show();
        this.Display.append(Heading, Slider, Make("div", "hud-hint", "Dimmer court · HUD stays clear"),
                            Button("RESET TO 75%", () => { Brightness.Set(75); Show(); }));
        this.Display.hidden = true;

        const Toggles = Make("div", "hud-row");
        Toggles.append(Button("M  MATCH", () => this.OnMatch()),
                       Button("DISPLAY SETTINGS", () => { this.Display.hidden = !this.Display.hidden; }),
                       Button("CAMERA VIEWS", () => { this.Views.hidden = !this.Views.hidden; }));
        const BottomRight = Make("div", "hud-bottom-right");
        BottomRight.append(this.Views, this.Display, Toggles);

        const Legend = Make("div", "hud-chip hud-legend",
            "MOUSE  move racket   ·   W / S  face down / up   ·   A / D  face right / left   ·   SPACE  new ball"
            + "   ·   [ / ]  slower / faster   ·   P  pause   ·   F  follow camera   ·   M  match");
        this.Root.append(TopLeft, Legend, BottomRight);
        this.SetOpponent("CPU", "Computer");
    }

    /** The ball's spin in words (SpinLine); called every frame, so the label changes only when the words do. */
    ShowSpin(Line: string): void { if (this.Spin.textContent !== Line) this.Spin.textContent = Line; }

    /** The game speed, or that it is paused, set by the game loop when either changes. */
    ShowSpeed(Line: string): void { this.Speed.textContent = Line; }

    ShowDisplaySettings(): void { this.Display.hidden = false; }

    SetOnMatch(Action: () => void): void { this.OnMatch = Action; }

    ToggleVisible(): void { this.Root.hidden = !this.Root.hidden; }

    /** The far end's badge on the scoreboard (CPU, or OPP in a match) and its name in the calls. */
    SetOpponent(Badge: string, Name: string): void {
        this.Badges = { Near: "YOU", Far: Badge };
        this.Names = { Near: "Player", Far: Name };
        this.Cells.Near.Name.textContent = this.Badges.Near;
        this.Cells.Far.Name.textContent = this.Badges.Far;
        this.ShownScore = null;   // so the next ShowScore rewrites the call with the new name
    }

    /**
     * The score and the umpire's last call: who won the point and why, or the game or match.
     * Called every frame, so the labels change only when the score or the call does.
     */
    ShowScore(Now: Score, Called: Point | null): void {
        if (this.ShownScore !== null && Now.Equals(this.ShownScore) && Called === this.ShownCall) return;
        this.ShownScore = Now;
        this.ShownCall = Called;
        for (const Each of ["Near", "Far"] as Side[]) {
            this.Cells[Each].Games.textContent = String(Now.Games(Each));
            this.Cells[Each].Points.textContent = String(Now.Points(Each));
        }
        this.Board.setAttribute("aria-label", `You: ${Now.NearGames} games, ${Now.NearPoints} points. Opponent: ${Now.FarGames} games, ${Now.FarPoints} points.`);
        if (Now.MatchWinner !== null) {
            this.Call.textContent = `MATCH TO ${this.Badges[Now.MatchWinner]}  ${Now.Games(Now.MatchWinner)}–${Now.Games(Other(Now.MatchWinner))}`;
        } else if (Now.GameWinner !== null) {
            this.Call.textContent = `GAME TO ${this.Badges[Now.GameWinner]}  ${Now.Points(Now.GameWinner)}–${Now.Points(Other(Now.GameWinner))}`;
        } else if (Called !== null) {
            const Why = Called.Reason(this.Names).replace(/^[0-9.]+: /, "");
            this.Call.textContent = (Called.Winner === null ? "LET" : "POINT TO " + this.Badges[Called.Winner]) + "  ·  " + Why;
        } else {
            // A fresh rally (a new match, or back to practice) has no call yet: don't leave the last one's up.
            this.Call.textContent = "FIRST TO 11  ·  BEST OF 5";
        }
    }
}
