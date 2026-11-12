import { Codec } from "./Codec";
import { Message } from "./Message";

/**
 * How messages cross to the other machines. Send never blocks; Poll drains whatever has arrived
 * since the last call, oldest first, without blocking, so the game loop can call it once a frame.
 */
export interface Transport {
    Send(Msg: Message): void;
    Poll(): Message[];
    Connected(): boolean;
    Close(): void;
}

/**
 * Two transports joined in memory, for tests and for a same-page match: each line goes through the
 * Codec as it would on the wire, and arrives after Latency seconds (plus up to Jitter more), read
 * off the given clock.
 */
export class MemoryTransport implements Transport {
    private Peer: MemoryTransport | null = null;
    private readonly Inbox: { Due: number; Line: string }[] = [];
    private Open = true;

    private constructor(private readonly Now: () => number, private readonly Latency: number, private readonly Jitter: number,
                        private readonly Random: () => number) {}

    /** A joined pair. Now is the clock both read, in seconds. */
    static Pair(Now: () => number = () => performance.now() / 1000, Latency = 0, Jitter = 0,
                Random: () => number = Math.random): [MemoryTransport, MemoryTransport] {
        const A = new MemoryTransport(Now, Latency, Jitter, Random), B = new MemoryTransport(Now, Latency, Jitter, Random);
        A.Peer = B;
        B.Peer = A;
        return [A, B];
    }

    Send(Msg: Message): void {
        if (!this.Open || this.Peer === null || !this.Peer.Open) return;
        const Due = this.Now() + this.Latency + this.Jitter * this.Random();
        this.Peer.Inbox.push({ Due, Line: Codec.Encode(Msg) });
        // Jitter never reorders a stream's lines, as TCP or a WebSocket would not.
        const Box = this.Peer.Inbox;
        for (let At = Box.length - 1; At > 0 && Box[At - 1].Due > Box[At].Due; At--) Box[At].Due = Box[At - 1].Due;
    }

    Poll(): Message[] {
        const Now = this.Now();
        const Drained: Message[] = [];
        while (this.Inbox.length > 0 && this.Inbox[0].Due <= Now) Drained.push(Codec.Decode(this.Inbox.shift()!.Line));
        return Drained;
    }

    Connected(): boolean { return this.Open && this.Peer !== null && this.Peer.Open; }

    Close(): void { this.Open = false; }
}
