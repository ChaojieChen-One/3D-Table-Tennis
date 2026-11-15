import { Codec } from "./Codec";
import { Message } from "./Message";
import { RtcPeer } from "./RtcPeer";
import { LinkPath, Transport } from "./Transport";

/** One step of a direct connection's negotiation, as the two machines pass it through the relay. */
export interface PeerSignal {
    readonly Type: "offer" | "answer" | "ice";
    readonly Sdp?: string;
    readonly Candidate?: unknown;
}

/**
 * A direct connection to the other machine, as much of one as WebRtcTransport needs: two channels
 * of text lines, and the signals that set them up. The real one is RtcPeer (an RTCPeerConnection);
 * tests join two fakes in memory.
 *
 *   - the fast channel is unordered and never retransmits: a line arrives soon or not at all,
 *     and may overtake an earlier one. For what is stale a moment later (Pose, Ping, Pong).
 *   - the sure channel is ordered and reliable, for what must arrive (Hit, Spawn, Point).
 */
export interface PeerLink {
    /** Told each signal this end makes, to pass to the other machine. */
    OnSignal: (Signal: PeerSignal) => void;

    /** Told each line that arrives, on either channel. */
    OnLine: (Line: string) => void;

    /** On the offering end only: opens both channels and makes the offer. */
    Offer(): void;

    /** A signal the other machine made. */
    Take(Signal: PeerSignal): void;

    /** Both channels are open. */
    Open(): boolean;

    /** The connection failed or closed, for good. */
    Dead(): boolean;

    SendFast(Line: string): void;
    SendSure(Line: string): void;
    Close(): void;
}

/**
 * A relay link that upgrades itself to a direct one. The match starts over the relay at once (a
 * WebSocket: one TCP stream through a server that may be far away, where one late packet holds up
 * everything behind it). Meanwhile the two machines negotiate a direct connection through that
 * same relay (Signal messages; the host offers), and once its channels are open and heard from,
 * the path is "direct". If it never connects, or goes quiet or dies mid-match, the path is the
 * relay again, and the host offers afresh a few times. Whoever uses the Transport sees none of this.
 *
 * What may be lost goes one way at a time: Pose, Ping and Pong take the fast channel when the path
 * is direct, the relay otherwise. One sent just before a switch can arrive after one sent just
 * after it; a receiver tells by its timestamp.
 *
 * What must arrive is never trusted to the direct link alone: each such message is numbered and
 * sent through the relay always, and down the sure channel as well whenever that is open. The
 * receiver hands each number on once, in order, from whichever copy comes first. So a switch
 * either way loses nothing and repeats nothing, with no acknowledgements to keep; the relay is the
 * record, and the direct link only gets there sooner. Such messages are a few a second at most.
 *
 * The relay stays the match's lifeline: Connected is the relay's, since it is what tells each
 * machine the other has left.
 */
export class WebRtcTransport implements Transport {
    /** A direct connection not open this long after its offer is given up, real s: a NAT the two machines cannot cross. */
    static readonly ConnectWithin = 8.0;

    /** A keep-alive line down the fast channel this often, real s, so each end knows the other still hears it. */
    static readonly ProbeEvery = 0.25;

    /** TUNED: nothing heard on the direct link for this long, real s (four probes), and the path is the relay again. */
    static readonly DirectSilence = 1.0;

    /** TUNED: still nothing after this long, real s, and the direct connection is closed, to be offered afresh. */
    static readonly GiveUpAfter = 6.0;

    /** TUNED: the wait before the host offers again after a direct connection is lost, real s, and the most offers a match gets. */
    static readonly RetryAfter = 2.0;
    static readonly MostOffers = 4;

    /**
     * The most of a signal that goes in one line, characters: the relay closes a socket that sends
     * a line over 2048 bytes, and an offer can run longer than that.
     */
    private static readonly SignalChunk = 900;

    /** The keep-alive line: no Codec line starts with it. */
    private static readonly Probe = "~";

    private Link: PeerLink | null = null;

    /** Which offer the current Link belongs to; a signal from an earlier one is ignored. */
    private Round = 0;
    private Offers = 0;
    private OfferedAt = 0;
    private OpenedAt = Number.NaN;
    private EverOpen = false;
    private RetryAt = 0;
    private HeardAt = Number.NEGATIVE_INFINITY;
    private ProbedAt = Number.NEGATIVE_INFINITY;

    /** The numbers of what must arrive: the next to send, and the next to hand on. */
    private NextSeq = 0;
    private Expected = 0;
    private readonly Early = new Map<number, Message>();

    private readonly Incoming: Message[] = [];
    private readonly Heard: string[] = [];
    private Pieces: string[] = [];
    private PeerSeat: number | undefined = undefined;

    /**
     * Relay is the link the match starts on. Offering is true on one machine only (the host).
     * MakeLink makes a fresh direct connection, or is null where there can be none (the transport
     * then only numbers what must arrive). Now is real time, s.
     */
    constructor(private readonly Relay: Transport,
                private readonly Offering: boolean,
                private readonly MakeLink: (() => PeerLink) | null,
                private readonly Now: () => number = () => performance.now() / 1000) {}

    /** The upgrade over Relay with the browser's own RTCPeerConnection, where it has one. */
    static Over(Relay: Transport, Host: boolean): WebRtcTransport {
        return new WebRtcTransport(Relay, Host, RtcPeer.Maker());
    }

    Send(Msg: Message): void {
        if (Msg.Kind === "Pose" || Msg.Kind === "Ping" || Msg.Kind === "Pong") {
            if (this.Link !== null && this.Path() === "direct") this.Link.SendFast(Codec.Encode(Msg));
            else this.Relay.Send(Msg);
            return;
        }
        const Numbered: Message = { Kind: "Numbered", Seq: this.NextSeq++, Inner: Msg };
        this.Relay.Send(Numbered);
        if (this.Link !== null && this.Link.Open()) this.Link.SendSure(Codec.Encode(Numbered));
    }

    Poll(): Message[] {
        for (const Msg of this.Relay.Poll()) {
            if (Msg.From !== undefined) this.PeerSeat = Msg.From;
            if (Msg.Kind === "Signal") this.Piece(Msg.Part, Msg.Of, Msg.Text);
            else this.Arrive(Msg);
        }
        for (const Line of this.Heard.splice(0, this.Heard.length)) {
            if (Line === WebRtcTransport.Probe) continue;
            let Msg: Message;
            try { Msg = Codec.Decode(Line); } catch { continue; }   // an unreadable line is dropped, not fatal
            Msg.From = this.PeerSeat;
            this.Arrive(Msg);
        }
        this.Tend();
        return this.Incoming.splice(0, this.Incoming.length);
    }

    Connected(): boolean { return this.Relay.Connected(); }

    Close(): void {
        this.Drop();
        this.Relay.Close();
    }

    /** "direct" while the direct link is open and has been heard from within DirectSilence. */
    Path(): LinkPath {
        return this.Link !== null && this.Link.Open() && this.Now() - this.HeardAt <= WebRtcTransport.DirectSilence ? "direct" : "relay";
    }

    /** How many direct connections this machine has offered: for tests and for curiosity. */
    Offered(): number { return this.Offers; }

    /** Hands Msg on: at once if it is unnumbered, else once and in its place in the sender's order. */
    private Arrive(Msg: Message): void {
        if (Msg.Kind !== "Numbered") { this.Incoming.push(Msg); return; }
        if (Msg.Seq < this.Expected || this.Early.has(Msg.Seq)) return;   // the other path's copy got here first
        if (Msg.From !== undefined) Msg.Inner.From = Msg.From;
        this.Early.set(Msg.Seq, Msg.Inner);
        for (let Next = this.Early.get(this.Expected); Next !== undefined; Next = this.Early.get(this.Expected)) {
            this.Early.delete(this.Expected++);
            this.Incoming.push(Next);
        }
    }

    /** The direct link's upkeep, once a Poll: offer, probe, give up, offer again. */
    private Tend(): void {
        const Now = this.Now();
        if (this.Link === null) {
            const Due = this.Offers === 0 || (this.EverOpen && this.Offers < WebRtcTransport.MostOffers && Now >= this.RetryAt);
            if (this.Offering && this.MakeLink !== null && this.Relay.Connected() && Due) {
                this.Offers++;
                this.Begin(this.Round + 1).Offer();
            }
            return;
        }
        if (!this.Link.Open()) {
            const Lost = !Number.isNaN(this.OpenedAt);   // it was open, and is not now
            if (Lost || this.Link.Dead() || Now - this.OfferedAt > WebRtcTransport.ConnectWithin) this.Drop();
            return;
        }
        if (Number.isNaN(this.OpenedAt)) {
            this.OpenedAt = Now;
            this.EverOpen = true;
        }
        if (this.Link.Dead() || Now - Math.max(this.HeardAt, this.OpenedAt) > WebRtcTransport.GiveUpAfter) { this.Drop(); return; }
        if (Now - this.ProbedAt >= WebRtcTransport.ProbeEvery) {
            this.ProbedAt = Now;
            this.Link.SendFast(WebRtcTransport.Probe);
        }
    }

    /** A fresh direct connection for offer Round, replacing any before it. */
    private Begin(Round: number): PeerLink {
        this.Drop();
        const Link = this.MakeLink!();
        this.Link = Link;
        this.Round = Round;
        this.OfferedAt = this.Now();
        this.OpenedAt = Number.NaN;
        this.HeardAt = this.ProbedAt = Number.NEGATIVE_INFINITY;
        // Both callbacks come off the browser's event loop; a closed link's stragglers are ignored.
        Link.OnSignal = Signal => { if (this.Link === Link) this.Signal({ ...Signal, Round }); };
        Link.OnLine = Line => {
            if (this.Link !== Link) return;
            this.HeardAt = this.Now();
            this.Heard.push(Line);
        };
        return Link;
    }

    private Drop(): void {
        if (this.Link === null) return;
        const Link = this.Link;
        this.Link = null;
        this.RetryAt = this.Now() + WebRtcTransport.RetryAfter;
        try { Link.Close(); } catch { /* already gone */ }
    }

    /** Sends one signal through the relay, in as many lines as it needs. */
    private Signal(Signal: PeerSignal & { Round: number }): void {
        const Text = encodeURIComponent(JSON.stringify(Signal));
        const Of = Math.max(1, Math.ceil(Text.length / WebRtcTransport.SignalChunk));
        for (let Part = 0; Part < Of; Part++)
            this.Relay.Send({ Kind: "Signal", Part, Of, Text: Text.slice(Part * WebRtcTransport.SignalChunk, (Part + 1) * WebRtcTransport.SignalChunk) });
    }

    /** One line of a signal from the relay, which keeps them in order; the last completes it. */
    private Piece(Part: number, Of: number, Text: string): void {
        if (Part === 0) this.Pieces = [];
        if (Part !== this.Pieces.length) { this.Pieces = []; return; }
        this.Pieces.push(Text);
        if (this.Pieces.length < Of) return;
        const Whole = this.Pieces.join("");
        this.Pieces = [];
        let Signal: PeerSignal & { Round?: number };
        try { Signal = JSON.parse(decodeURIComponent(Whole)); } catch { return; }
        if (this.MakeLink === null || typeof Signal.Round !== "number") return;
        // A new offer always starts a new connection on the answering end; anything else must belong to the current one.
        if (Signal.Type === "offer" && !this.Offering && Signal.Round !== this.Round) this.Begin(Signal.Round).Take(Signal);
        else if (Signal.Type !== "offer" && this.Link !== null && Signal.Round === this.Round) this.Link.Take(Signal);
    }
}
