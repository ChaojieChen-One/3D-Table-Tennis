import { CleanRoomCode, DefaultPort, NewRoomCode } from "../net/Relay";
import { WebSocketTransport } from "../net/WebSocketTransport";

function Make<K extends keyof HTMLElementTagNameMap>(Tag: K, Class: string, Text = ""): HTMLElementTagNameMap[K] {
    const Made = document.createElement(Tag);
    Made.className = Class;
    if (Text) Made.textContent = Text;
    return Made;
}

/**
 * Where the relay is unless told otherwise: the address the build was given (VITE_RELAY_URL, set
 * on a hosted build such as Vercel's), else the page's own server if it is the relay, else the same
 * machine on the relay's port.
 */
export function DefaultRelay(): string {
    const Built = (import.meta.env.VITE_RELAY_URL as string | undefined)?.trim();
    if (Built) return Built;
    const Secure = location.protocol === "https:";
    if (location.port === String(DefaultPort) || location.protocol === "https:") return `${Secure ? "wss" : "ws"}://${location.host}`;
    return `ws://${location.hostname || "localhost"}:${DefaultPort}`;
}

function Remembered(Key: string, Fallback: string): string {
    try { return localStorage.getItem(Key) ?? Fallback; } catch { return Fallback; }
}

function Remember(Key: string, Value: string): void {
    try { localStorage.setItem(Key, Value); } catch { /* private window: nothing kept */ }
}

function Forget(Key: string): void {
    try { localStorage.removeItem(Key); } catch { /* nothing kept anyway */ }
}

/**
 * Wakes a relay that may be asleep (a free host stops it when idle, and takes about a minute to
 * start again): an ordinary request to its address, whose answer is not needed.
 */
function Wake(Url: string): void {
    try {
        const Http = Url.replace(/^ws(s?):/, "http$1:");
        void fetch(Http, { mode: "no-cors", cache: "no-store" }).catch(() => {});
    } catch { /* an address that cannot be one: the connect will say so */ }
}

/**
 * The Match page (M): host a match and share its room code, or type a friend's code to join.
 * Both machines reach each other through the relay (npm run relay); the page says where it is
 * looking for it, and that can be changed for a relay elsewhere.
 */
export class MatchPage {
    readonly Root = Make("div", "match");
    private readonly Status = Make("div", "match-status");
    private readonly RoomCode = Make("div", "match-code");
    private readonly Code = Make("input", "match-input");
    private readonly Relay = Make("input", "match-input");
    private readonly Name = Make("input", "match-input");
    private readonly HostButton = Make("button", "hud-button match-primary", "HOST A MATCH");
    private readonly JoinButton = Make("button", "hud-button", "JOIN");
    private readonly LeaveButton = Make("button", "hud-button", "LEAVE MATCH");
    private Waiting: WebSocketTransport | null = null;
    private Playing = false;

    /**
     * OnStart is given each link once the other player is there (Host true on the machine that
     * opened the room); OnLeave runs when this player leaves a match under way.
     */
    constructor(private readonly OnStart: (Link: WebSocketTransport, Host: boolean, Opponent: string) => void,
                private readonly OnLeave: () => void) {
        const Card = Make("div", "match-card");
        Card.setAttribute("role", "dialog");
        Card.setAttribute("aria-label", "Match");
        const Close = Make("button", "match-close", "✕");
        Close.setAttribute("aria-label", "Close");
        Close.addEventListener("click", () => this.Close());

        this.Code.placeholder = "ROOM CODE";
        this.Code.maxLength = 12;
        this.Code.autocomplete = "off";
        this.Code.addEventListener("keydown", Event => { if (Event.key === "Enter") this.Join(); });
        // Only a relay the player typed themselves is kept; otherwise the build's own default stays current.
        this.Relay.value = Remembered("relayUrl", DefaultRelay());
        this.Relay.spellcheck = false;
        this.Name.value = Remembered("name", "player");
        this.Name.maxLength = 16;

        for (const Each of [this.HostButton, this.JoinButton, this.LeaveButton]) Each.type = "button";
        this.HostButton.addEventListener("click", () => this.Host());
        this.JoinButton.addEventListener("click", () => this.Join());
        this.LeaveButton.addEventListener("click", () => this.Leave());
        this.LeaveButton.hidden = true;

        const JoinRow = Make("div", "match-row");
        JoinRow.append(this.Code, this.JoinButton);
        const Settings = Make("details", "match-settings");
        const Summary = Make("summary", "", "CONNECTION");
        const Field = (Label: string, Input: HTMLInputElement) => { const Box = Make("label", "match-field"); Box.append(Make("span", "", Label), Input); return Box; };
        Settings.append(Summary, Field("Your name", this.Name), Field("Relay address", this.Relay),
                        Make("p", "match-note", "Both players need the same relay. Run it with npm run relay on one machine (it also serves the game), or host it anywhere Node runs."));

        Card.append(Close, Make("h2", "match-title", "MATCH"),
                    Make("p", "match-note", "Play another person: one of you hosts and reads out the room code, the other types it in."),
                    this.HostButton, Make("div", "match-or", "OR"), JoinRow, this.RoomCode, this.Status, this.LeaveButton, Settings);
        this.RoomCode.hidden = true;
        this.Root.append(Card);
        this.Root.hidden = true;
        this.Root.addEventListener("keydown", Event => Event.stopPropagation());
    }

    IsOpen(): boolean { return !this.Root.hidden; }

    Open(): void {
        this.Root.hidden = false;
        Wake(this.Relay.value.trim() || DefaultRelay());
        if (!this.Playing && this.Waiting === null) this.Code.focus();
    }

    Close(): void { this.Root.hidden = true; }

    /** The match is over because the link went: say so, and offer the page again. */
    Ended(Why: string): void {
        this.Playing = false;
        this.Waiting = null;
        this.Busy(false);
        this.Say(Why);
        this.Open();
    }

    private Say(Line: string): void { this.Status.textContent = Line; }

    /** The room code being shown, if any: for whoever hosts to read out. */
    ShownCode(): string { return this.RoomCode.hidden ? "" : this.RoomCode.textContent ?? ""; }

    private Busy(On: boolean): void {
        if (!On && !this.Playing) this.RoomCode.hidden = true;
        this.HostButton.disabled = this.JoinButton.disabled = this.Code.disabled = On || this.Playing;
        this.LeaveButton.hidden = !(On || this.Playing);
    }

    private Settings(): { Url: string; Name: string } {
        const Url = this.Relay.value.trim() || DefaultRelay();
        const Name = this.Name.value.trim().replace(/\s+/g, "_") || "player";
        if (Url === DefaultRelay()) Forget("relayUrl"); else Remember("relayUrl", Url);
        Remember("name", Name);
        return { Url, Name };
    }

    private async Host(): Promise<void> {
        const { Url, Name } = this.Settings();
        this.Busy(true);
        this.Say("Opening a room… (a relay that was asleep takes up to a minute to wake)");
        try {
            const Link = await WebSocketTransport.Connect(Url, NewRoomCode(), true, Name);
            this.Waiting = Link;
            this.RoomCode.textContent = Link.Code;
            this.RoomCode.hidden = false;
            this.Say("Room code above: waiting for your opponent to join…");
            Link.OnRoom = State => {
                if (State.Count >= 2 && !this.Playing) this.Begin(Link, true);
            };
            Link.OnClosed = Why => { if (this.Waiting === Link) this.Ended("The room closed: " + Why + "."); };
        } catch (Failure) {
            this.Busy(false);
            this.Say(`Couldn't open a room: ${(Failure as Error).message}. Is the relay running?`);
        }
    }

    private async Join(): Promise<void> {
        const Code = CleanRoomCode(this.Code.value);
        if (Code === null) { this.Say("Type the room code your opponent sees."); return; }
        const { Url, Name } = this.Settings();
        this.Busy(true);
        this.Say(`Joining room ${Code}… (a relay that was asleep takes up to a minute to wake)`);
        try {
            const Link = await WebSocketTransport.Connect(Url, Code, false, Name);
            this.Begin(Link, false);
        } catch (Failure) {
            this.Busy(false);
            this.Say(`Couldn't join: ${(Failure as Error).message}.`);
        }
    }

    private Begin(Link: WebSocketTransport, Host: boolean): void {
        this.Waiting = null;
        this.Playing = true;
        this.Busy(true);
        this.Say(`In a match${Host ? ` (room ${Link.Code})` : ""}. Close this page to play.`);
        this.OnStart(Link, Host, "OPP");
        this.Close();
    }

    private Leave(): void {
        if (this.Waiting !== null) { this.Waiting.Close(); this.Waiting = null; }
        if (this.Playing) { this.Playing = false; this.OnLeave(); }
        this.Busy(false);
        this.Say("Back to practice.");
    }
}
