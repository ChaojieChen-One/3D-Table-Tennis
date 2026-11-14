import { SideNames } from "../../game/Side";
import { ControlsList } from "./Controls";
import { Make, MenuButton } from "./Dom";
import { Level, Levels, Prefs, Qualities, Quality } from "./Prefs";

export type Screen = "Title" | "HowTo" | "Settings" | "Pause" | "Results";

/** A finished match for the results card: who won, the games, and each game's points. */
export interface MatchResult {
    readonly Won: boolean;
    readonly Badges: SideNames;
    readonly NearGames: number;
    readonly FarGames: number;
    readonly Games: ReadonlyArray<{ readonly Near: number; readonly Far: number }>;
}

/** The court's brightness, as main keeps it: percent, 30 to 100. */
export interface BrightnessControl { Get: () => number; Set: (Percent: number) => void; }

/** One choice out of a few, as a row of buttons that behaves as a radio group: arrows move the choice, Tab leaves it. */
class Segmented<T extends string> {
    readonly Root = Make("div", "seg");
    private readonly Buttons = new Map<T, HTMLButtonElement>();

    constructor(Label: string, Options: readonly T[], private readonly Pick: (Chosen: T) => void) {
        this.Root.setAttribute("role", "radiogroup");
        this.Root.setAttribute("aria-label", Label);
        for (const Each of Options) {
            const Made = MenuButton(Each.toUpperCase(), () => this.Pick(Each), "seg-option");
            Made.setAttribute("role", "radio");
            this.Buttons.set(Each, Made);
            this.Root.append(Made);
        }
        this.Root.addEventListener("keydown", Event => {
            const Step = Event.key === "ArrowRight" ? 1 : Event.key === "ArrowLeft" ? -1 : 0;
            if (Step === 0) return;
            const Now = Options.findIndex(Each => this.Buttons.get(Each)!.getAttribute("aria-checked") === "true");
            const Next = Options[(Now + Step + Options.length) % Options.length];
            this.Pick(Next);
            this.Buttons.get(Next)!.focus();
            Event.preventDefault();
            Event.stopPropagation();
        });
    }

    Show(Chosen: T): void {
        for (const [Each, Made] of this.Buttons) {
            Made.setAttribute("aria-checked", String(Each === Chosen));
            Made.tabIndex = Each === Chosen ? 0 : -1;
        }
    }
}

/**
 * The menus that sit over the live arena: the title, how to play, the settings, the pause menu
 * and the card at the end of a match. One is open at a time; while any is, the game is held and
 * the keys are the menu's. What the buttons do is the caller's (the callbacks below): this class
 * only shows the choices and remembers them (Prefs).
 */
export class MenuOverlay {
    readonly Root = Make("div", "menu");

    /** PLAY on the title: practice against the computer. */
    OnPlay: () => void = () => {};
    /** ONLINE MATCH: open the Match page. */
    OnOnline: () => void = () => {};
    /** MAIN MENU from the pause menu or the results card. */
    OnMainMenu: () => void = () => {};
    /** PLAY AGAIN on the results card. */
    OnPlayAgain: () => void = () => {};
    /** A menu opened where none was, or the last one closed. */
    OnOpened: () => void = () => {};
    OnClosed: () => void = () => {};
    /** The game speed picked in Settings, game seconds per real second (0.1 to 1). */
    OnSpeed: (Value: number) => void = () => {};
    OnQuality: (Chosen: Quality) => void = () => {};
    OnLevel: (Chosen: Level) => void = () => {};
    /** Whether a match is on: then the pause menu offers the Match page in place of the main menu. */
    IsOnline: () => boolean = () => false;

    private readonly Screens: Record<Screen, HTMLElement>;
    private readonly Art = Make("img", "title-art");
    private Now: Screen | null = null;
    /** Where BACK from Settings or How to play returns. */
    private Behind: Screen | null = null;
    private readonly LevelRows: Array<Segmented<Level>> = [];
    private readonly QualityRow: Segmented<Quality>;
    private readonly SpeedSlider = Make("input", "slider");
    private readonly SpeedValue = Make("span", "field-value");
    private readonly Syncs: Array<() => void> = [];
    private readonly PauseTitle = Make("h2", "panel-title", "PAUSED");
    private readonly ToMain = MenuButton("MAIN MENU", () => this.OnMainMenu());
    private readonly ResultBody = Make("div", "result-body");

    constructor(private readonly Brightness: BrightnessControl) {
        this.QualityRow = new Segmented<Quality>("Graphics quality", Qualities, Chosen => { Prefs.Set({ Quality: Chosen }); this.OnQuality(Chosen); });
        this.Screens = {
            Title: this.BuildTitle(), HowTo: this.BuildHowTo(), Settings: this.BuildSettings(),
            Pause: this.BuildPause(), Results: this.BuildResults(),
        };
        // The key art lies under the title screen only; without it the live arena shows through the scrim.
        this.Art.alt = "";
        this.Art.decoding = "async";
        this.Art.addEventListener("error", () => { this.Art.hidden = true; });
        this.Root.append(this.Art, ...Object.values(this.Screens));
        for (const Each of Object.values(this.Screens)) Each.hidden = true;
        this.Root.hidden = true;
        Prefs.Listen(() => this.Sync());
        this.Sync();
    }

    IsOpen(): boolean { return this.Now !== null; }

    Showing(): Screen | null { return this.Now; }

    /** The picture behind the title; null leaves the live arena there. */
    SetTitleArt(Url: string | null): void {
        this.Art.hidden = Url === null;
        if (Url !== null) this.Art.src = Url;
    }

    Show(Which: Screen): void {
        const WasOpen = this.IsOpen();
        if (Which === "Settings" || Which === "HowTo") this.Behind = this.Now; else this.Behind = null;
        this.Now = Which;
        for (const [Name, Each] of Object.entries(this.Screens)) Each.hidden = Name !== Which;
        this.Root.hidden = false;
        this.Root.dataset.screen = Which;
        if (Which === "Pause") {
            const Online = this.IsOnline();
            this.PauseTitle.textContent = Online ? "MATCH MENU" : "PAUSED";
            this.ToMain.textContent = Online ? "MATCH PAGE" : "MAIN MENU";
        }
        this.Sync();
        this.Focusable()[0]?.focus({ preventScroll: true });
        if (!WasOpen) this.OnOpened();
    }

    Close(): void {
        if (this.Now === null) return;
        this.Now = this.Behind = null;
        this.Root.hidden = true;
        (document.activeElement as HTMLElement | null)?.blur();
        this.OnClosed();
    }

    /** Esc, or BACK: to the screen behind, or out of the pause menu; the title and the results card stay until a button is chosen. */
    Back(): void {
        if (this.Now === "Settings" || this.Now === "HowTo") {
            if (this.Behind !== null) this.Show(this.Behind); else this.Close();
        } else if (this.Now === "Pause") this.Close();
    }

    /** A key while a menu is open: the arrows walk the buttons, Esc goes back; the rest is the browser's (Tab, Enter, Space). */
    Key(Event: KeyboardEvent): void {
        if (Event.key === "Escape") { this.Back(); Event.preventDefault(); return; }
        const Step = Event.key === "ArrowDown" ? 1 : Event.key === "ArrowUp" ? -1 : 0;
        if (Step === 0) return;
        const All = this.Focusable(), At = All.indexOf(document.activeElement as HTMLElement);
        All[(At + Step + All.length) % All.length]?.focus();
        Event.preventDefault();
    }

    /** The speed the game runs at now, so the slider in Settings shows it. */
    ShowSpeed(Value: number): void {
        this.SpeedSlider.value = String(Math.round(Value * 100));
        this.SpeedValue.textContent = `${Math.round(Value * 100)}%`;
    }

    ShowResults(Result: MatchResult): void {
        const Head = Make("div", "result-head");
        Head.append(Make("div", "result-kicker", "MATCH RESULT"),
                    Make("div", Result.Won ? "result-title won" : "result-title", Result.Won ? "VICTORY" : "DEFEAT"));
        const Line = (Badge: string, Games: number, Points: number[], Class: string, Winner: boolean) => {
            const Row = Make("div", `result-row ${Class}` + (Winner ? " winner" : ""));
            Row.append(Make("span", "result-name", Badge), Make("span", "result-games", String(Games)));
            for (const Each of Points) Row.append(Make("span", "result-points", String(Each)));
            return Row;
        };
        const Table = Make("div", "result-table");
        const Top = Make("div", "result-row result-heading");
        Top.append(Make("span", "result-name", ""), Make("span", "result-games", "GAMES"));
        Result.Games.forEach((_, Index) => Top.append(Make("span", "result-points", `G${Index + 1}`)));
        Table.append(Top,
            Line(Result.Badges.Near, Result.NearGames, Result.Games.map(Each => Each.Near), "near", Result.Won),
            Line(Result.Badges.Far, Result.FarGames, Result.Games.map(Each => Each.Far), "far", !Result.Won));
        this.ResultBody.replaceChildren(Head, Table);
        this.Show("Results");
    }

    // ---- Building the screens.

    private Focusable(): HTMLElement[] {
        if (this.Now === null) return [];
        return Array.from(this.Screens[this.Now].querySelectorAll<HTMLElement>("button, input"))
            .filter(Each => Each.tabIndex >= 0 && !(Each as HTMLButtonElement).disabled && Each.offsetParent !== null);
    }

    private LevelRow(): HTMLElement {
        const Row = new Segmented<Level>("Opponent level", Levels, Chosen => { Prefs.Set({ Level: Chosen }); this.OnLevel(Chosen); });
        this.LevelRows.push(Row);
        return Row.Root;
    }

    private BuildTitle(): HTMLElement {
        const Page = Make("div", "title");
        const Lockup = Make("h1", "lockup");
        Lockup.setAttribute("aria-label", "3D Table Tennis");
        const Top = Make("span", "lockup-top");
        Top.append(Make("span", "lockup-3d", "3D"), Make("span", "lockup-rule"));
        Lockup.append(Top, Make("span", "lockup-word", "TABLE"), Make("span", "lockup-word", "TENNIS"));
        const Play = MenuButton("PLAY", () => this.OnPlay(), "menu-button primary");
        const Level = Make("div", "title-level");
        Level.append(Make("span", "field-label", "OPPONENT"), this.LevelRow());
        const Buttons = Make("nav", "menu-list");
        Buttons.setAttribute("aria-label", "Main menu");
        Buttons.append(Play, Level,
            MenuButton("ONLINE MATCH", () => this.OnOnline()),
            MenuButton("HOW TO PLAY", () => this.Show("HowTo")),
            MenuButton("SETTINGS", () => this.Show("Settings")));
        const Column = Make("div", "title-column");
        Column.append(Make("div", "title-kicker", "REAL CONTACT PHYSICS  ·  EVERY SHOT IS YOUR SWING"), Lockup, Buttons);
        Page.append(Column, Make("div", "title-foot", "FIRST TO 11  ·  BEST OF 5  ·  ITTF LAWS"));
        return Page;
    }

    private Panel(Title: HTMLElement | string, Class: string, ...Body: HTMLElement[]): HTMLElement {
        const Page = Make("div", "panel-page");
        const Card = Make("div", `panel ${Class}`);
        Card.setAttribute("role", "dialog");
        const Heading = typeof Title === "string" ? Make("h2", "panel-title", Title) : Title;
        Card.setAttribute("aria-label", Heading.textContent ?? "");
        Card.append(Heading, ...Body);
        Page.append(Card);
        return Page;
    }

    private BuildHowTo(): HTMLElement {
        const Tip = Make("p", "panel-note",
            "Every shot comes from the contact between your moving racket and the ball. Push forward through the ball for pace, "
            + "brush up or down for spin, and hold A or D to aim across the table.");
        const Foot = Make("div", "panel-foot");
        Foot.append(MenuButton("BACK", () => this.Back(), "menu-button primary"));
        return this.Panel("HOW TO PLAY", "wide", Tip, ControlsList(), Foot);
    }

    private Field(Label: string, Value: HTMLElement | null, Control: HTMLElement): HTMLElement {
        // A label wraps only a real input: around a row of buttons it would press the first of them when clicked.
        const Box = Make(Control instanceof HTMLInputElement ? "label" : "div", "field");
        const Head = Make("span", "field-head");
        Head.append(Make("span", "field-label", Label));
        if (Value !== null) Head.append(Value);
        Box.append(Head, Control);
        return Box;
    }

    /** A slider from Low to High with its value shown as a percentage; Read and Write are in the slider's own units. */
    private Slider(Label: string, Low: number, High: number, Step: number, Read: () => number, Write: (Value: number) => void): HTMLElement {
        const Input = Make("input", "slider"), Value = Make("span", "field-value");
        Object.assign(Input, { type: "range", min: String(Low), max: String(High), step: String(Step) });
        Input.setAttribute("aria-label", Label);
        const Show = () => {
            Input.value = String(Math.round(Read()));
            Value.textContent = `${Math.round(Read())}%`;
            Input.style.setProperty("--fill", `${((Read() - Low) / (High - Low)) * 100}%`);
        };
        Input.addEventListener("input", () => { Write(Number(Input.value)); Show(); });
        this.Syncs.push(Show);
        return this.Field(Label.toUpperCase(), Value, Input);
    }

    private BuildSettings(): HTMLElement {
        const Section = (Title: string, ...Fields: HTMLElement[]) => {
            const Block = Make("section", "settings-section");
            Block.append(Make("h3", "settings-title", Title), ...Fields);
            return Block;
        };
        const Mute = MenuButton("", () => Prefs.Set({ Muted: !Prefs.Get().Muted }), "toggle");
        Mute.setAttribute("role", "switch");
        this.Syncs.push(() => {
            Mute.setAttribute("aria-checked", String(!Prefs.Get().Muted));
            Mute.textContent = Prefs.Get().Muted ? "SOUND OFF" : "SOUND ON";
        });
        const Sound = Section("SOUND",
            this.Slider("Master volume", 0, 100, 1, () => Prefs.Get().Master * 100, Value => Prefs.Set({ Master: Value / 100 })),
            this.Slider("Effects", 0, 100, 1, () => Prefs.Get().Effects * 100, Value => Prefs.Set({ Effects: Value / 100 })),
            this.Slider("Crowd", 0, 100, 1, () => Prefs.Get().Crowd * 100, Value => Prefs.Set({ Crowd: Value / 100 })),
            this.Field("SOUND  (N)", null, Mute));

        Object.assign(this.SpeedSlider, { type: "range", min: "10", max: "100", step: "10" });
        this.SpeedSlider.setAttribute("aria-label", "Game speed");
        this.SpeedSlider.addEventListener("input", () => {
            const Value = Number(this.SpeedSlider.value) / 100;
            this.ShowSpeed(Value);
            this.OnSpeed(Value);
        });
        this.Syncs.push(() => this.SpeedSlider.style.setProperty("--fill", `${(Number(this.SpeedSlider.value) - 10) / 0.9}%`));
        const Game = Section("GAME",
            this.Field("OPPONENT", null, this.LevelRow()),
            this.Field("GAME SPEED  ( [  ] )", this.SpeedValue, this.SpeedSlider));
        const Display = Section("DISPLAY",
            this.Slider("Court brightness", 30, 100, 1, () => this.Brightness.Get(), Value => this.Brightness.Set(Value)),
            this.Field("GRAPHICS QUALITY", null, this.QualityRow.Root));

        const Columns = Make("div", "settings-columns");
        const Right = Make("div", "settings-stack");
        Right.append(Game, Display);
        Columns.append(Sound, Right);
        const Foot = Make("div", "panel-foot");
        Foot.append(MenuButton("DONE", () => this.Back(), "menu-button primary"));
        return this.Panel("SETTINGS", "wide", Columns, Foot);
    }

    private BuildPause(): HTMLElement {
        const List = Make("nav", "menu-list");
        List.append(MenuButton("RESUME", () => this.Close(), "menu-button primary"),
                    MenuButton("SETTINGS", () => this.Show("Settings")),
                    MenuButton("HOW TO PLAY", () => this.Show("HowTo")),
                    this.ToMain);
        return this.Panel(this.PauseTitle, "narrow", List);
    }

    private BuildResults(): HTMLElement {
        const Foot = Make("div", "panel-foot pair");
        Foot.append(MenuButton("PLAY AGAIN", () => this.OnPlayAgain(), "menu-button primary"), MenuButton("MENU", () => this.OnMainMenu()));
        const Page = this.Panel("", "result", this.ResultBody, Foot);
        Page.querySelector(".panel")!.setAttribute("aria-label", "Match result");
        return Page;
    }

    private Sync(): void {
        const Now = Prefs.Get();
        for (const Each of this.LevelRows) Each.Show(Now.Level);
        this.QualityRow.Show(Now.Quality);
        for (const Each of this.Syncs) Each();
    }
}
