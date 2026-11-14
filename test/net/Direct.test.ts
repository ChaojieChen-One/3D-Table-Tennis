import { test } from "vitest";
import { BallState } from "../../src/engine/BallState";
import { Vec3 } from "../../src/engine/math/Vec3";
import { Codec } from "../../src/net/Codec";
import { Message } from "../../src/net/Message";
import { MemoryTransport, Transport } from "../../src/net/Transport";
import { PeerLink, PeerSignal, WebRtcTransport } from "../../src/net/WebRtcTransport";
import { Check, F } from "../Measure";

/**
 * The upgrade from the relay to a direct link, with the direct connection faked in memory: a
 * relay 80 to 100 ms long each way, and a direct wire 5 ms long whose fast channel may reorder.
 * Every check is the transport's promise itself: what must arrive arrives once and in order, what
 * may be lost takes the quicker path, and the match never depends on the direct link.
 */
const Tick = 0.005;

/** The long, awkward text a real offer is: several lines, spaces and symbols, well over one relay line. */
const LongSdp = Array.from({ length: 120 }, (_, Line) => `a=candidate:${Line} 1 udp 2113937151 192.168.1.${Line} 5${Line} typ host generation 0 network-cost 999`).join("\r\n");

/** The direct wire both fake ends share. */
class FakeWire {
    Now = 0;
    /** Whether a negotiation ends with the channels open (false: a NAT that cannot be crossed). */
    Connects = true;
    /** Lines vanish, though the channels still look open (a NAT mapping that expired). */
    Silent = false;
    readonly Ends: (FakePeer | null)[] = [null, null];
    readonly Flying: { Due: number; To: number; Line: string }[] = [];
    Carried = 0;
    private Draw = 1;

    /** A cheap repeatable 0..1. */
    Random(): number { this.Draw = (this.Draw * 16807) % 2147483647; return this.Draw / 2147483647; }

    Deliver(): void {
        for (let At = 0; At < this.Flying.length;) {
            if (this.Flying[At].Due > this.Now) { At++; continue; }
            const [Landed] = this.Flying.splice(At, 1);
            const To = this.Ends[Landed.To];
            if (To !== null && To.Open()) { this.Carried++; To.OnLine(Landed.Line); }
        }
    }

    /** The direct connection dies outright: both ends see it closed. */
    Kill(): void { for (const Each of this.Ends) if (Each !== null) Each.Broken = true; }
}

class FakePeer implements PeerLink {
    OnSignal: (Signal: PeerSignal) => void = () => {};
    OnLine: (Line: string) => void = () => {};
    Agreed = false;
    Broken = false;
    Closed = false;
    OfferSeen = "";
    private LastSure = 0;

    constructor(private readonly Wire: FakeWire, private readonly Side: number) { Wire.Ends[Side] = this; }

    Offer(): void { this.OnSignal({ Type: "offer", Sdp: LongSdp }); }

    Take(Signal: PeerSignal): void {
        if (Signal.Type === "offer") {
            this.OfferSeen = Signal.Sdp ?? "";
            this.Agreed = true;
            this.OnSignal({ Type: "answer", Sdp: "v=0 answer" });
        } else if (Signal.Type === "answer") this.Agreed = true;
    }

    Open(): boolean {
        const Other = this.Wire.Ends[1 - this.Side];
        return this.Wire.Connects && this.Agreed && !this.Broken && !this.Closed && Other !== null && Other.Agreed && !Other.Closed;
    }

    Dead(): boolean { return this.Broken || this.Closed; }

    /** 5 ms, plus up to 10 ms more for the fast channel, so one line can overtake another. */
    SendFast(Line: string): void {
        if (this.Open() && !this.Wire.Silent) this.Wire.Flying.push({ Due: this.Wire.Now + 0.005 + 0.010 * this.Wire.Random(), To: 1 - this.Side, Line });
    }

    SendSure(Line: string): void {
        if (!this.Open() || this.Wire.Silent) return;
        this.LastSure = Math.max(this.LastSure, this.Wire.Now + 0.005);
        this.Wire.Flying.push({ Due: this.LastSure, To: 1 - this.Side, Line });
    }

    Close(): void { this.Closed = true; }
}

/** A relay link that keeps every message it was asked to carry, to see what still goes that way. */
class Watched implements Transport {
    readonly Sent: Message[] = [];
    constructor(private readonly Inner: Transport) {}
    Send(Msg: Message): void { this.Sent.push(Msg); this.Inner.Send(Msg); }
    Poll(): Message[] { return this.Inner.Poll(); }
    Connected(): boolean { return this.Inner.Connected(); }
    Close(): void { this.Inner.Close(); }
}

interface Table {
    readonly Wire: FakeWire;
    readonly Host: WebRtcTransport;
    readonly Guest: WebRtcTransport;
    readonly HostRelay: Watched;
    /** What each end has been handed, in order. */
    readonly AtHost: Message[];
    readonly AtGuest: Message[];
    /** Advances both machines until Until s, with Each run before every tick. */
    Run(Until: number, Each?: (Now: number) => void): void;
}

function Seat(Direct: boolean): Table {
    const Wire = new FakeWire();
    const Random = () => Wire.Random();
    const [A, B] = MemoryTransport.Pair(() => Wire.Now, 0.08, 0.02, Random);
    const HostRelay = new Watched(A);
    const Host = new WebRtcTransport(HostRelay, true, Direct ? () => new FakePeer(Wire, 0) : null, () => Wire.Now);
    const Guest = new WebRtcTransport(B, false, Direct ? () => new FakePeer(Wire, 1) : null, () => Wire.Now);
    const AtHost: Message[] = [], AtGuest: Message[] = [];
    return {
        Wire, Host, Guest, HostRelay, AtHost, AtGuest,
        Run(Until, Each) {
            while (Wire.Now < Until - 1e-9) {
                Each?.(Wire.Now);
                Wire.Now += Tick;
                Wire.Deliver();
                AtHost.push(...Host.Poll());
                AtGuest.push(...Guest.Poll());
            }
        },
    };
}

const Pose = (At: number): Message => ({ Kind: "Pose", Centre: Vec3.Zero, Normal: new Vec3(0, 0, 1), Roll: 0, At });
const Hit = (At: number): Message => ({ Kind: "Hit", Ball: new BallState(Vec3.Zero, Vec3.Zero, Vec3.Zero), At });
const HitsOf = (All: Message[]) => All.filter(Each => Each.Kind === "Hit").map(Each => Each.Kind === "Hit" ? Math.round(Each.At) : -1);
const InOrderOnce = (Seen: number[], Count: number) => Seen.length === Count && Seen.every((Each, Index) => Each === Index);

test("TheMatchStartsOnTheRelayAndMovesToTheDirectLink", () => {
    const T = Seat(true);
    // Poses from the first instant: the first cross the relay, and none is held back for the upgrade.
    let DirectAt = Number.NaN, FirstPoseAt = Number.NaN;
    T.Run(1.0, Now => {
        T.Host.Send(Pose(Now));
        if (Number.isNaN(DirectAt) && T.Host.Path() === "direct" && T.Guest.Path() === "direct") DirectAt = Now;
        if (Number.isNaN(FirstPoseAt) && T.AtGuest.some(Each => Each.Kind === "Pose")) FirstPoseAt = Now;
    });
    const OnRelayBefore = T.HostRelay.Sent.filter(Each => Each.Kind === "Pose").length;
    const Lines = T.HostRelay.Sent.filter(Each => Each.Kind === "Signal").map(Each => Codec.Encode(Each).length);
    // From here every pose should go direct: 5 to 15 ms instead of 80 to 100.
    const Trips: number[] = [];
    let Seen = T.AtGuest.length;
    T.Run(2.0, Now => {
        for (; Seen < T.AtGuest.length; Seen++) { const Msg = T.AtGuest[Seen]; if (Msg.Kind === "Pose") Trips.push(Now - Msg.At); }
        T.Host.Send(Pose(Now));
    });
    const OnRelayAfter = T.HostRelay.Sent.filter(Each => Each.Kind === "Pose").length - OnRelayBefore;
    const Slowest = Math.max(...Trips.slice(40));
    const Offer = (T.Wire.Ends[1] as FakePeer).OfferSeen;
    Check(FirstPoseAt < 0.12 && DirectAt < 1.0 && OnRelayAfter === 0 && Slowest <= 0.015 + 2 * Tick && Offer === LongSdp && Math.max(...Lines) < 1024,
          `first pose arrived at ${F(FirstPoseAt * 1000, 0)} ms over the relay; both ends direct at ${F(DirectAt * 1000, 0)} ms. `
          + `Poses through the relay: ${OnRelayBefore} before, ${OnRelayAfter} after; the slowest pose then took ${F(Slowest * 1000, 0)} ms (the relay takes 80 to 100). `
          + `The ${LongSdp.length}-character offer crossed whole in ${Lines.length} signal lines, the longest ${Math.max(...Lines)} characters (the relay refuses 2048)`);
});

test("NothingThatMustArriveIsLostOrRepeatedAcrossEitherSwitch", () => {
    const T = Seat(true);
    // A stroke every 20 ms for 16 s, each way, while the direct link comes up, dies outright (4 s),
    // is offered again (2 offers in all), and goes silent for 3 s with its channels still open (9 s):
    // shorter than GiveUpAfter, so the same connection is picked up again when it is heard from.
    let Sent = 0, Due = 0;
    const Paths: string[] = [];
    T.Run(16, Now => {
        if (Now >= 4 && Now < 4 + Tick) T.Wire.Kill();
        T.Wire.Silent = Now >= 9 && Now < 12;
        if (Now >= Due) { Due += 0.02; T.Host.Send(Hit(Sent)); T.Guest.Send(Hit(Sent)); Sent++; }
        const Path = T.Guest.Path();
        if (Paths.length === 0 || !Paths[Paths.length - 1].startsWith(Path)) Paths.push(`${Path} from ${F(Now, 2)} s`);
    });
    T.Run(16.5);
    const ToGuest = HitsOf(T.AtGuest), ToHost = HitsOf(T.AtHost);
    Check(InOrderOnce(ToGuest, Sent) && InOrderOnce(ToHost, Sent) && Paths.length === 6 && T.Host.Offered() === 2,
          `${Sent} strokes sent each way; the guest was handed ${ToGuest.length} and the host ${ToHost.length}, each once and in order: ${InOrderOnce(ToGuest, Sent) && InOrderOnce(ToHost, Sent)}. `
          + `The guest's path: ${Paths.join(", ")}; the host made ${T.Host.Offered()} offers; the direct wire carried ${T.Wire.Carried} lines`);
});

test("ADirectLinkThatNeverConnectsLeavesTheMatchOnTheRelay", () => {
    const T = Seat(true);
    T.Wire.Connects = false;
    let Sent = 0;
    T.Run(WebRtcTransport.ConnectWithin + 4, Now => { if (Math.round(Now / Tick) % 4 === 0) { T.Host.Send(Hit(Sent)); T.Host.Send(Pose(Now)); Sent++; } });
    T.Run(WebRtcTransport.ConnectWithin + 4.5);
    const Poses = T.AtGuest.filter(Each => Each.Kind === "Pose").length;
    const Closed = T.Wire.Ends.every(Each => Each !== null && Each.Closed);
    Check(T.Host.Path() === "relay" && T.Guest.Path() === "relay" && T.Host.Offered() === 1 && Closed && InOrderOnce(HitsOf(T.AtGuest), Sent) && Poses === Sent,
          `after ${F(WebRtcTransport.ConnectWithin + 4.5, 1)} s: path ${T.Host.Path()}, ${T.Host.Offered()} offer made and its connection closed: ${Closed}; `
          + `${HitsOf(T.AtGuest).length} of ${Sent} strokes and ${Poses} of ${Sent} poses arrived over the relay`);
});

test("ADirectLinkThatGoesQuietMidMatchFallsBackWithinASecond", () => {
    const T = Seat(true);
    T.Run(1.0);
    // The wire goes silent at 2 s with its channels still open. Poses are sent every 15 ms throughout.
    let LastArrival = 0, Seen = 0, LongestGap = 0, RelayAt = Number.NaN, BackAt = Number.NaN, Due = 1.0;
    T.Run(14, Now => {
        T.Wire.Silent = Now >= 2 && Now < 5;
        if (Now >= Due) { Due += 0.015; T.Host.Send(Pose(Now)); }
        for (; Seen < T.AtGuest.length; Seen++) if (T.AtGuest[Seen].Kind === "Pose") { if (LastArrival > 0) LongestGap = Math.max(LongestGap, Now - LastArrival); LastArrival = Now; }
        if (Now > 2 && Number.isNaN(RelayAt) && T.Host.Path() === "relay") RelayAt = Now;
        if (!Number.isNaN(RelayAt) && Number.isNaN(BackAt) && T.Host.Path() === "direct") BackAt = Now;
    });
    // Silence is noticed DirectSilence after the last line heard; the poses then cross the relay (up to 100 ms).
    const Bound = WebRtcTransport.DirectSilence + 0.1 + 0.015 + 2 * Tick;
    Check(RelayAt - 2 <= WebRtcTransport.DirectSilence + 2 * Tick && LongestGap <= Bound && BackAt < 14 && T.Guest.Path() === "direct",
          `silent from 2.00 s: on the relay again at ${F(RelayAt, 2)} s; the longest the guest went without a pose was ${F(LongestGap * 1000, 0)} ms (bound ${F(Bound * 1000, 0)} ms); `
          + `direct again at ${F(BackAt, 2)} s, after the wire came back at 5.00 s`);
});

test("WithoutWebRtcTheMatchStillRunsNumberedOverTheRelay", () => {
    const T = Seat(false);
    let Sent = 0;
    T.Run(2, () => { T.Guest.Send(Hit(Sent++)); });
    T.Run(2.5);
    Check(InOrderOnce(HitsOf(T.AtHost), Sent) && T.Host.Path() === "relay" && T.Host.Offered() === 0 && !T.HostRelay.Sent.some(Each => Each.Kind === "Signal"),
          `${HitsOf(T.AtHost).length} of ${Sent} strokes arrived in order; path ${T.Host.Path()}, ${T.Host.Offered()} offers, no signal sent`);
});
