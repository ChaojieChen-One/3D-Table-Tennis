import { BallState } from "../engine/BallState";
import { Clamp } from "../engine/math/Numeric";
import { Vec3 } from "../engine/math/Vec3";
import { CursorFollower } from "./control/CursorFollower";
import { RacketPose } from "./control/RacketPose";
import { RacketAgent } from "./RacketAgent";

/** One pose as the other machine sent it: At is the sender's own clock, real s. */
interface Snapshot {
    readonly At: number;
    readonly Pose: RacketPose;
}

/**
 * A racket in networked play driven by pose messages from another machine instead of by AI. It
 * never touches the ball itself; the engine's own Collisions never sees it (Rally leaves it out of
 * the swept rackets), because the other machine is the one that decides its own hits (hitter
 * authority) and sends the result as a Hit message, applied through Rally.ApplyRemoteHit.
 *
 * It plays the other machine's poses back by snapshot interpolation. Each pose carries the time
 * it was true on the sender's clock; this racket shows the sender's time (now - Offset - Delay),
 * interpolated between the two poses either side of it:
 *
 *   - Offset is the gap between the two clocks plus the quickest trip seen lately (the smallest
 *     "arrived - sent" of the last OffsetWindow), so one late packet never moves the timeline.
 *   - Delay is the playout delay: one pose interval, so the pose after the shown time has had time
 *     to arrive, plus how much later than the quickest the recent poses have come (the jitter).
 *     It grows at once when poses turn uneven and shrinks as they calm, never past MostDelay.
 *   - If the poses run dry, the racket carries on along its last velocity for MostAhead, then holds.
 *
 * Everything here runs on real time (Advance), not game time: a slow-motion match still shows the
 * other player's hand as it is. All of it is deterministic: the only clock is the one Advance counts.
 */
export class RemoteRacket implements RacketAgent {
    /** The pose interval assumed before two poses have been seen, s: NetSession sends 60 a second. */
    private static readonly ExpectedInterval = 1.0 / 60;

    /** The measured pose interval is trusted only between these, s (120 to 15 poses a second). */
    private static readonly ShortestInterval = 1.0 / 120;
    private static readonly LongestInterval = 1.0 / 15;

    /** TUNED: the playout delay is never less than this many pose intervals: 1 to bracket, and half to spare. */
    private static readonly CalmIntervals = 1.5;

    /** The most the playout delay may be, real s: beyond it a late pose is extrapolated rather than waited for. */
    static readonly MostDelay = 0.100;

    /** The longest the racket is carried along its last velocity with no newer pose, real s; then it holds. */
    static readonly MostAhead = 0.050;

    /** TUNED: the clock offset is the quickest trip of this long, real s: long enough to span a burst of late packets. */
    private static readonly OffsetWindow = 5.0;

    /** TUNED: the measured jitter forgets a late packet with this time constant, real s. */
    private static readonly JitterMemory = 2.0;

    /**
     * TUNED: the shown time is steered toward where it should be by running this much faster or
     * slower than real time (a share of it), so a change of delay is a slight change of pace, not a jump.
     */
    static readonly Steer = 0.15;

    /** TUNED: the share of the shown time's error made up each real second, 1/s: a small error is steered out gently, well under Steer. */
    private static readonly SteerGain = 4.0;

    /** Further off than this, real s, the shown time jumps: the link was replaced or stalled. */
    private static readonly Resync = 0.25;

    /**
     * The shown racket never moves faster than this, m per real s: twice the fastest a player's
     * racket tracks, so ordinary play is shown exactly, and a jump in the data (a stall ending, a
     * resync) arrives as a quick carry instead.
     */
    private static readonly CarrySpeed = 2 * CursorFollower.TrackSpeed;

    private Shown: RacketPose;
    private readonly Buffer: Snapshot[] = [];

    /** This machine's own real clock, s, counted by Advance. */
    private Now = 0;

    /** Recent "arrived - sent" samples in arrival order, kept as a rising run so the first is the window's smallest. */
    private readonly Trips: { When: number; Trip: number }[] = [];

    /** How much later than the quickest the recent poses have come, real s: quick to rise, slow to fall. */
    private Spread = 0;
    private SpreadAt = 0;

    private Interval = RemoteRacket.ExpectedInterval;

    /** The sender's time being shown, or NaN before the first pose. */
    private Playing = Number.NaN;

    private Received = 0;

    constructor(RestingAt: Vec3) { this.Shown = new RacketPose(RestingAt, new Vec3(0, 0, 1), 0); }

    /**
     * The other machine's racket as it was at At on its own clock (real s), in this machine's
     * frame (already mirrored by the caller). A pose no newer than the newest held is dropped: on
     * an unordered link an old one can arrive late, and it has nothing left to say.
     */
    Receive(Pose: RacketPose, At: number): void {
        const Newest = this.Buffer.length > 0 ? this.Buffer[this.Buffer.length - 1] : null;
        if (Newest !== null && At <= Newest.At) return;
        this.Received++;

        const Trip = this.Now - At;
        while (this.Trips.length > 0 && this.Trips[this.Trips.length - 1].Trip >= Trip) this.Trips.pop();
        this.Trips.push({ When: this.Now, Trip });
        while (this.Trips[0].When < this.Now - RemoteRacket.OffsetWindow) this.Trips.shift();

        const Late = Trip - this.Trips[0].Trip;
        const Faded = this.Spread * Math.exp(-(this.Now - this.SpreadAt) / RemoteRacket.JitterMemory);
        this.Spread = Math.max(Late, Faded);
        this.SpreadAt = this.Now;

        if (Newest !== null) {
            const Gap = At - Newest.At;
            if (Gap <= RemoteRacket.LongestInterval)
                this.Interval = Clamp(this.Interval + 0.1 * (Gap - this.Interval), RemoteRacket.ShortestInterval, RemoteRacket.LongestInterval);
        }
        this.Buffer.push({ At, Pose });
    }

    /** RealSeconds of real time pass: the shown time moves on, and the racket with it. Called once a frame, before Receive. */
    Advance(RealSeconds: number): void {
        this.Now += RealSeconds;
        if (this.Buffer.length === 0) return;

        const Wanted = this.Now - this.Trips[0].Trip - this.Delay();
        if (Number.isNaN(this.Playing) || Math.abs(Wanted - this.Playing - RealSeconds) > RemoteRacket.Resync) {
            this.Playing = Wanted;
        } else {
            const Off = Wanted - (this.Playing + RealSeconds);
            const Most = RemoteRacket.Steer * RealSeconds;
            this.Playing += RealSeconds + Clamp(Off * RemoteRacket.SteerGain * RealSeconds, -Most, Most);
        }

        const Target = this.Sample(this.Playing);
        const Distance = Target.Centre.Minus(this.Shown.Centre).Length();
        const Share = Distance <= RemoteRacket.CarrySpeed * RealSeconds ? 1 : RemoteRacket.CarrySpeed * RealSeconds / Distance;
        this.Shown = Share >= 1 ? Target : RemoteRacket.Blend(this.Shown, Target, Share);
    }

    /** Game steps move nothing: the racket is shown on real time, once a frame, by Advance. */
    Follow(_Ball: BallState, _Seconds: number): void {}

    Pose(): RacketPose { return this.Shown; }

    /** The playout delay now, real s. */
    Delay(): number {
        const Faded = this.Spread * Math.exp(-(this.Now - this.SpreadAt) / RemoteRacket.JitterMemory);
        const Spare = Math.max((RemoteRacket.CalmIntervals - 1) * this.Interval, Faded);
        return Math.min(RemoteRacket.MostDelay, this.Interval + Spare);
    }

    /** How many poses have been taken (not dropped as stale), for measuring the pose rate. */
    PosesReceived(): number { return this.Received; }

    /** The racket at sender time T: between the two poses either side, or a little beyond the newest. */
    private Sample(T: number): RacketPose {
        const All = this.Buffer;
        // Nothing older than the pose before T is needed again.
        while (All.length > 2 && All[1].At <= T) All.shift();
        const First = All[0];
        if (All.length === 1 || T <= First.At) return First.Pose;
        const Next = All[1];
        const Span = Next.At - First.At;
        if (T <= Next.At) return RemoteRacket.Blend(First.Pose, Next.Pose, (T - First.At) / Span);
        // Dry: carry on along the last velocity, unless the two poses are too far apart to give one.
        if (Span > RemoteRacket.LongestInterval * 2) return Next.Pose;
        const Ahead = Math.min(T - Next.At, RemoteRacket.MostAhead);
        const Velocity = Next.Pose.Centre.Minus(First.Pose.Centre).Scale(1 / Span);
        return new RacketPose(Next.Pose.Centre.PlusScaled(Velocity, Ahead), Next.Pose.Normal, Next.Pose.Roll);
    }

    private static Blend(From: RacketPose, To: RacketPose, Share: number): RacketPose {
        const Normal = Vec3.Lerp(From.Normal, To.Normal, Share);
        return new RacketPose(Vec3.Lerp(From.Centre, To.Centre, Share),
                              Normal.Length() > 1e-9 ? Normal.Normalized() : To.Normal,
                              From.Roll + (To.Roll - From.Roll) * Share);
    }
}
