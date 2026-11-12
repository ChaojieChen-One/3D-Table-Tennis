import { Codec } from "./Codec";
import { Hello, Message, WireVersion } from "./Message";
import { Unwrap } from "./Relay";
import { Transport } from "./Transport";

/** What the relay said about the room, for the Match page. */
export interface RoomState {
    readonly Code: string;
    readonly Seat: number;
    readonly Count: number;
}

/**
 * A seat in a relay room over a WebSocket (TCP underneath, so lines arrive in order). Frames arrive
 * on the browser's event loop and queue; Poll drains them on the game loop's own step. Every peer
 * says HELLO as it arrives, and one of another wire version is ignored, so two builds of the game
 * never play each other by mistake.
 */
export class WebSocketTransport implements Transport {
    private readonly Incoming: Message[] = [];
    private Open = false;
    private Seat = -1;
    private Count = 0;
    private readonly Strangers = new Set<number>();

    /** Told when the room fills or empties, and when the link ends (with why). */
    OnRoom: (State: RoomState) => void = () => {};
    OnClosed: (Why: string) => void = () => {};

    private constructor(private readonly Socket: WebSocket, readonly Code: string, private readonly Name: string) {}

    /**
     * Opens (Host true) or joins the room Code on the relay at Url. Resolves once the relay has
     * seated this machine; rejects if it refuses or cannot be reached.
     */
    static Connect(Url: string, Code: string, Host: boolean, Name = "player", Size = 2): Promise<WebSocketTransport> {
        return new Promise((Resolve, Reject) => {
            let Socket: WebSocket;
            try { Socket = new WebSocket(Url); } catch (Failure) { Reject(Failure); return; }
            const Link = new WebSocketTransport(Socket, Code, Name);
            let Settled = false;
            Socket.onopen = () => Socket.send(Host ? `OPEN ${Code} ${Size}` : `JOIN ${Code}`);
            Socket.onerror = () => { if (!Settled) { Settled = true; Reject(new Error("could not reach the relay at " + Url)); } };
            Socket.onclose = () => {
                const Was = Link.Open;
                Link.Open = false;
                if (!Settled) { Settled = true; Reject(new Error("the relay closed the connection")); }
                else if (Was) Link.OnClosed("the connection closed");
            };
            Socket.onmessage = Event => {
                const Frame = String(Event.data);
                if (!Settled) {
                    const Words = Frame.split(" ");
                    if (Words[0] === "SEATED") {
                        Settled = true;
                        Link.Open = true;
                        Link.Seat = Number(Words[1]);
                        Link.Count = Number(Words[2]);
                        Link.SendRaw(Codec.Encode(Hello(Name)));
                        Resolve(Link);
                    } else if (Words[0] === "REFUSED") {
                        Settled = true;
                        Reject(new Error(Words.slice(1).join(" ") || "refused"));
                        Socket.close();
                    }
                    return;
                }
                Link.Receive(Frame);
            };
        });
    }

    private Receive(Frame: string): void {
        const Words = Frame.split(" ");
        if (Words[0] === "ARRIVED" || Words[0] === "LEFT") {
            this.Count += Words[0] === "ARRIVED" ? 1 : -1;
            if (Words[0] === "ARRIVED") this.SendRaw(Codec.Encode(Hello(this.Name)));   // so the newcomer hears from everyone
            else this.Strangers.delete(Number(Words[1]));
            this.OnRoom({ Code: this.Code, Seat: this.Seat, Count: this.Count });
            return;
        }
        const Wrapped = Unwrap(Frame);
        if (Wrapped === null) return;
        let Msg: Message;
        try { Msg = Codec.Decode(Wrapped.Line); } catch { return; }   // an unreadable line is dropped, not fatal
        if (Msg.Kind === "Hello" && Msg.Version !== WireVersion) { this.Strangers.add(Wrapped.From); return; }
        if (this.Strangers.has(Wrapped.From)) return;
        Msg.From = Wrapped.From;
        this.Incoming.push(Msg);
    }

    private SendRaw(Line: string): void {
        if (this.Open && this.Socket.readyState === WebSocket.OPEN) this.Socket.send(Line);
    }

    /** This machine's seat in the room (0 hosts), and how many seats are filled. */
    Room(): RoomState { return { Code: this.Code, Seat: this.Seat, Count: this.Count }; }

    Send(Msg: Message): void { this.SendRaw(Codec.Encode(Msg)); }

    Poll(): Message[] { return this.Incoming.splice(0, this.Incoming.length); }

    Connected(): boolean { return this.Open; }

    Close(): void {
        this.Open = false;
        try { this.Socket.close(); } catch { /* already gone */ }
    }
}
