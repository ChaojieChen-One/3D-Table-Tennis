import type { PeerLink, PeerSignal } from "./WebRtcTransport";

/**
 * The real direct connection: a browser's RTCPeerConnection with two data channels. It is found
 * on the global at run time, so this file loads anywhere (the Node tests have no WebRTC, and
 * Maker says so). Public STUN servers tell each machine its address as the internet sees it; that
 * is enough for most home networks. There is no TURN server, so two machines behind NATs that
 * cannot be crossed (symmetric ones, some mobile and office networks) never connect directly, and
 * WebRtcTransport keeps them on the relay.
 */
export class RtcPeer implements PeerLink {
    /** Google's public STUN servers: address discovery only, no traffic passes through them. */
    static readonly Servers = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];

    /** More than this waiting to go on the fast channel, bytes, and a new line is skipped: a pose that queues is already stale. */
    private static readonly MostQueued = 16 * 1024;

    OnSignal: (Signal: PeerSignal) => void = () => {};
    OnLine: (Line: string) => void = () => {};

    private Fast: RTCDataChannel | null = null;
    private Sure: RTCDataChannel | null = null;
    private Failed = false;

    /** Each step of the negotiation waits for the one before, so an answer or a candidate is never applied early. */
    private Steps: Promise<void> = Promise.resolve();

    private constructor(private readonly Peer: RTCPeerConnection) {
        Peer.onicecandidate = Event => { if (Event.candidate !== null) this.OnSignal({ Type: "ice", Candidate: Event.candidate.toJSON() }); };
        Peer.ondatachannel = Event => this.Adopt(Event.channel);
    }

    /** Makes direct connections, or null where the browser (or Node) has no RTCPeerConnection. */
    static Maker(): (() => PeerLink) | null {
        const Made = (globalThis as { RTCPeerConnection?: typeof RTCPeerConnection }).RTCPeerConnection;
        if (Made === undefined) return null;
        return () => new RtcPeer(new Made({ iceServers: RtcPeer.Servers }));
    }

    Offer(): void {
        this.Adopt(this.Peer.createDataChannel("fast", { ordered: false, maxRetransmits: 0 }));
        this.Adopt(this.Peer.createDataChannel("sure", { ordered: true }));
        this.Then(async () => {
            await this.Peer.setLocalDescription(await this.Peer.createOffer());
            this.OnSignal({ Type: "offer", Sdp: this.Peer.localDescription?.sdp ?? "" });
        });
    }

    Take(Signal: PeerSignal): void {
        this.Then(async () => {
            if (Signal.Type === "offer") {
                await this.Peer.setRemoteDescription({ type: "offer", sdp: Signal.Sdp });
                await this.Peer.setLocalDescription(await this.Peer.createAnswer());
                this.OnSignal({ Type: "answer", Sdp: this.Peer.localDescription?.sdp ?? "" });
            } else if (Signal.Type === "answer") {
                await this.Peer.setRemoteDescription({ type: "answer", sdp: Signal.Sdp });
            } else {
                // One candidate that cannot be used is no reason to give up on the rest.
                await this.Peer.addIceCandidate(Signal.Candidate as RTCIceCandidateInit).catch(() => {});
            }
        });
    }

    Open(): boolean { return this.Fast?.readyState === "open" && this.Sure?.readyState === "open"; }

    Dead(): boolean {
        const State = this.Peer.connectionState;
        return this.Failed || State === "failed" || State === "closed"
            || this.Fast?.readyState === "closed" || this.Sure?.readyState === "closed";
    }

    SendFast(Line: string): void {
        if (this.Fast === null || this.Fast.readyState !== "open" || this.Fast.bufferedAmount > RtcPeer.MostQueued) return;
        try { this.Fast.send(Line); } catch { /* closing: the transport will see it Dead */ }
    }

    SendSure(Line: string): void {
        if (this.Sure === null || this.Sure.readyState !== "open") return;
        try { this.Sure.send(Line); } catch { /* closing: the relay carries the same line */ }
    }

    Close(): void {
        this.Failed = true;
        try { this.Peer.close(); } catch { /* already gone */ }
    }

    private Adopt(Channel: RTCDataChannel): void {
        if (Channel.label === "fast") this.Fast = Channel; else this.Sure = Channel;
        Channel.onmessage = Event => this.OnLine(String(Event.data));
    }

    private Then(Step: () => Promise<void>): void {
        this.Steps = this.Steps.then(Step).catch(() => { this.Failed = true; });
    }
}
