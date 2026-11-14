import { expect, test } from "vitest";
import { BallState } from "../../src/engine/BallState";
import { Clamp, ToRadians } from "../../src/engine/math/Numeric";
import { Vec3 } from "../../src/engine/math/Vec3";
import { CursorFollower } from "../../src/game/control/CursorFollower";
import { RacketPose } from "../../src/game/control/RacketPose";
import { ReachEnvelope } from "../../src/game/control/ReachEnvelope";
import { FixedClock } from "../../src/game/FixedClock";
import { Opponent } from "../../src/game/Opponent";
import { Rally } from "../../src/game/Rally";
import { RemoteRacket } from "../../src/game/RemoteRacket";
import { NetMirror } from "../../src/net/NetMirror";
import { NetSession } from "../../src/net/NetSession";
import { MemoryTransport, Transport } from "../../src/net/Transport";
import { Check, F } from "../Measure";

/**
 * How the other player's racket looks on this machine. A hand moves along a known path on one
 * machine and its poses cross a wire with latency and jitter; every check compares what is shown
 * with that path itself: its own largest move per frame (smoothness) and where it truly is now
 * (lateness). Both machines draw 60 frames a real second, at the match's game speed of 0.5.
 */
const Frame = 1.0 / 60;
const GameSpeed = 0.5;

/** A seeded generator, so every run draws the same jitter. */
function Seeded(Seed: number): () => number {
    let State = Seed >>> 0;
    return () => {
        State = (State + 0x6D2B79F5) >>> 0;
        let T = State;
        T = Math.imul(T ^ (T >>> 15), T | 1);
        T ^= T + Math.imul(T ^ (T >>> 7), T | 61);
        return ((T ^ (T >>> 14)) >>> 0) / 4294967296;
    };
}

/** The hand's true path at real time T, s: a 0.3 m sweep once a second, peaking near 1.9 m/s. */
const TruePath = (T: number) => new Vec3(0.3 * Math.sin(2 * Math.PI * T), 0.25, -1.6 + 0.1 * Math.sin(2 * Math.PI * 0.7 * T));

/** The racket as it was before snapshot interpolation: eased toward the latest pose at a capped speed, on game steps. */
class EasedRacket {
    private static readonly CatchUpSpeed = 12.0;
    private static readonly RollSpeed = ToRadians(720);
    private Centre: Vec3;
    private TargetCentre: Vec3;
    private Normal = new Vec3(0, 0, 1);
    private TargetNormal = this.Normal;
    private Roll = 0;
    private TargetRoll = 0;

    constructor(RestingAt: Vec3) { this.Centre = this.TargetCentre = RestingAt; }

    Receive(Pose: RacketPose): void {
        this.TargetCentre = Pose.Centre;
        this.TargetNormal = Pose.Normal;
        this.TargetRoll = Pose.Roll;
    }

    Follow(Seconds: number): void {
        this.Centre = this.Centre.MovedToward(this.TargetCentre, EasedRacket.CatchUpSpeed * Seconds);
        this.Normal = Vec3.Lerp(this.Normal, this.TargetNormal, Math.min(1, EasedRacket.CatchUpSpeed * Seconds)).Normalized();
        this.Roll += Clamp(this.TargetRoll - this.Roll, -EasedRacket.RollSpeed * Seconds, EasedRacket.RollSpeed * Seconds);
    }

    Pose(): RacketPose { return new RacketPose(this.Centre, this.Normal, this.Roll); }
}

interface Shown {
    /** The largest move between two frames, m. */
    readonly MostMove: number;
    /** The largest change of that move from one frame to the next, m: what the eye reads as a stutter. */
    readonly MostJerk: number;
    /** The mean distance from where the hand truly is at that moment, m, and the same as time behind, s. */
    readonly MeanOff: number;
    readonly Behind: number;
}

/** The true path's own figures at 60 frames a second: what a perfect, undelayed display would measure. */
function PathItself(): { MostMove: number; MostJerk: number; MeanSpeed: number } {
    let MostMove = 0, MostJerk = 0, Travelled = 0;
    let Last: Vec3 | null = null;
    for (let K = 0; K < 600; K++) {
        const Move = TruePath((K + 1) * Frame).Minus(TruePath(K * Frame));
        MostMove = Math.max(MostMove, Move.Length());
        if (Last !== null) MostJerk = Math.max(MostJerk, Move.Minus(Last).Length());
        Travelled += Move.Length();
        Last = Move;
    }
    return { MostMove, MostJerk, MeanSpeed: Travelled / 10 };
}

/**
 * Sends the hand's poses every PoseEvery real s over a wire of Latency (+ up to Jitter), and
 * watches the racket Old or new show them for 10 s after a 2 s settle. The receiver's frames fall
 * 7 ms after the sender's, and the two machines' clocks differ by 12.345 s.
 */
function Watch(Old: boolean, PoseEvery: number, Latency: number, Jitter: number): Shown {
    let Now = 0;
    const [Out, In] = MemoryTransport.Pair(() => Now, Latency, Jitter, Seeded(7));
    const Rest = TruePath(0);
    const Eased = new EasedRacket(Rest), Played = new RemoteRacket(Rest);
    let SincePose = PoseEvery, MostMove = 0, MostJerk = 0, Off = 0, Counted = 0;
    let Last: Vec3 | null = null, LastMove: Vec3 | null = null;
    for (let K = 0; K < 12 * 60; K++) {
        Now = K * Frame;
        SincePose += Frame;
        if (SincePose >= PoseEvery * 0.9) {
            SincePose = Math.max(0, SincePose - PoseEvery);
            Out.Send({ Kind: "Pose", Centre: TruePath(Now), Normal: new Vec3(0, 0, 1), Roll: 0, At: Now + 12.345 });
        }
        Now = K * Frame + 0.007;
        if (!Old) Played.Advance(Frame);
        for (const Msg of In.Poll()) {
            if (Msg.Kind !== "Pose") continue;
            const Pose = new RacketPose(Msg.Centre, Msg.Normal, Msg.Roll);
            if (Old) Eased.Receive(Pose); else Played.Receive(Pose, Msg.At);
        }
        // The old racket moved on game steps: 480 a game second, so 4 a frame at half speed.
        if (Old) for (let Steps = 0; Steps < Frame * GameSpeed / FixedClock.Step - 0.5; Steps++) Eased.Follow(FixedClock.Step);
        const At = (Old ? Eased.Pose() : Played.Pose()).Centre;
        if (K >= 2 * 60 && Last !== null) {
            const Move = At.Minus(Last);
            MostMove = Math.max(MostMove, Move.Length());
            if (LastMove !== null) MostJerk = Math.max(MostJerk, Move.Minus(LastMove).Length());
            LastMove = Move;
            Off += At.Minus(TruePath(Now)).Length();
            Counted++;
        }
        Last = At;
    }
    return { MostMove, MostJerk, MeanOff: Off / Counted, Behind: Off / Counted / PathItself().MeanSpeed };
}

const Mm = (Metres: number) => F(Metres * 1000, 1) + " mm";
const Ms = (Seconds: number) => F(Seconds * 1000, 0) + " ms";

test("ARemoteRacketMovesAsSmoothlyAsTheHandItShowsOnAJitteryLink", () => {
    // 80 ms +- 30 ms each way: every trip between 50 and 110 ms.
    const Path = PathItself();
    const Was = Watch(true, 1.0 / 15, 0.05, 0.06);        // as it was: 30 poses a game second is 15 a real one
    const WasAtSixty = Watch(true, Frame, 0.05, 0.06);    // the old easing given today's pose rate
    const Is = Watch(false, Frame, 0.05, 0.06);
    // Played back at real pace, steered by at most Steer either way, the shown racket can move no
    // more than (1 + Steer) of the hand's own largest move, and its move can change between frames
    // by no more than the hand's own change plus a full swing of the steer.
    const MoveBound = (1 + RemoteRacket.Steer) * Path.MostMove;
    const JerkBound = Path.MostJerk + 2 * RemoteRacket.Steer * Path.MostMove;
    Check(Is.MostMove <= MoveBound && Is.MostJerk <= JerkBound,
          `the hand itself: most move ${Mm(Path.MostMove)} a frame, most change of move ${Mm(Path.MostJerk)}. `
          + `Shown at 80 ms +- 30 ms: most move ${Mm(Is.MostMove)} (bound ${Mm(MoveBound)}), most change ${Mm(Is.MostJerk)} (bound ${Mm(JerkBound)}). `
          + `Before, at 15 poses a real s: most move ${Mm(Was.MostMove)}, most change ${Mm(Was.MostJerk)}; `
          + `before, given 60 poses a s: most move ${Mm(WasAtSixty.MostMove)}, most change ${Mm(WasAtSixty.MostJerk)}`);
});

test("ARemoteRacketIsNoLaterThanTheSlowestTripPlusItsCappedDelay", () => {
    const Was = Watch(true, 1.0 / 15, 0.05, 0.06);
    const Is = Watch(false, Frame, 0.05, 0.06);
    const Calm = Watch(false, Frame, 0.02, 0);
    // Jittery: never further behind than the slowest trip (110 ms) plus the delay's cap. Calm
    // (20 ms, no jitter): the trip, the frame the pose waited for, and one and a half pose intervals.
    const JitteryBound = 0.11 + RemoteRacket.MostDelay, CalmBound = 0.02 + Frame + 1.5 * Frame;
    Check(Is.Behind <= JitteryBound && Calm.Behind <= CalmBound,
          `80 ms +- 30 ms: shown ${Mm(Is.MeanOff)} from the true hand on average, ${Ms(Is.Behind)} behind (bound ${Ms(JitteryBound)}); `
          + `before: ${Mm(Was.MeanOff)}, ${Ms(Was.Behind)} behind. `
          + `Calm 20 ms link: ${Mm(Calm.MeanOff)}, ${Ms(Calm.Behind)} behind (bound ${Ms(CalmBound)})`);
});

test("ThePlayoutDelayGrowsWithJitterAndShrinksWhenTheLinkCalms", () => {
    const Racket = new RemoteRacket(Vec3.Zero);
    const Random = Seeded(3);
    const Pose = new RacketPose(Vec3.Zero, new Vec3(0, 0, 1), 0);
    // Poses sent every frame; each is handed over after its own trip, at the first frame on or after it lands.
    const Run = (Seconds: number, Jitter: number, From: number) => {
        const Landing: { Due: number; At: number }[] = [];
        for (let K = 0; K < Seconds * 60; K++) {
            const T = From + K * Frame;
            Landing.push({ Due: Math.max(T + 0.03 + Jitter * Random(), Landing.length > 0 ? Landing[Landing.length - 1].Due : 0), At: T });
            Racket.Advance(Frame);
            while (Landing.length > 0 && Landing[0].Due <= T) Racket.Receive(Pose, Landing.shift()!.At);
        }
        return Racket.Delay();
    };
    const Calm = Run(3, 0, 0), Jittery = Run(3, 0.04, 3), Worse = Run(3, 0.5, 6), Settled = Run(15, 0, 9);
    // Calm: one and a half pose intervals (25 ms), as the frames here line up with the sends.
    // 40 ms of jitter: a pose interval plus about that. Half a second of it: the 100 ms cap.
    Check(Math.abs(Calm - 1.5 * Frame) < 0.002 && Jittery > Frame + 0.03 && Jittery < Frame + 0.045
          && Worse === RemoteRacket.MostDelay && Settled < 1.5 * Frame + 0.002,
          `playout delay: calm ${Ms(Calm)}, with 40 ms jitter ${Ms(Jittery)}, with 500 ms jitter ${Ms(Worse)} (cap ${Ms(RemoteRacket.MostDelay)}), 15 s after it calms ${Ms(Settled)}`);
});

test("AStalePoseIsDroppedByItsTimestamp", () => {
    const Racket = new RemoteRacket(Vec3.Zero);
    const At = (X: number) => new RacketPose(new Vec3(X, 0, 0), new Vec3(0, 0, 1), 0);
    Racket.Advance(Frame);
    Racket.Receive(At(0.1), 1.0);
    Racket.Receive(At(0.2), 1.5);      // too long after the first to read a velocity from: the racket will rest on it
    Racket.Receive(At(-5), 1.05);      // sent before the last one, arrived after: out of order
    Racket.Receive(At(-5), 1.5);       // the same pose twice, as two paths would deliver it
    let Furthest = 0;
    for (let K = 0; K < 60; K++) { Racket.Advance(Frame); Furthest = Math.min(Furthest, Racket.Pose().Centre.X); }
    Check(Racket.PosesReceived() === 2 && Furthest >= 0 && Math.abs(Racket.Pose().Centre.X - 0.2) < 1e-9,
          `4 poses sent, ${Racket.PosesReceived()} kept; the racket never went left of x = ${F(Furthest, 3)} and rests at x = ${F(Racket.Pose().Centre.X, 3)}`);
});

test("ADryBufferCarriesOnBrieflyThenHolds", () => {
    // A hand moving at 1.2 m/s along x, then silence: the racket may run on for MostAhead (50 ms), 60 mm, and no further.
    const Racket = new RemoteRacket(Vec3.Zero);
    const Speed = 1.2;
    let Last = 0;
    for (let K = 0; K < 60; K++) {
        Racket.Advance(Frame);
        Last = K * Frame * Speed;
        Racket.Receive(new RacketPose(new Vec3(Last, 0, 0), new Vec3(0, 0, 1), 0), K * Frame);
    }
    const Beyond: number[] = [];
    for (let K = 0; K < 30; K++) { Racket.Advance(Frame); Beyond.push(Racket.Pose().Centre.X - Last); }
    const Furthest = Math.max(...Beyond), Rest = Beyond[Beyond.length - 1];
    const Still = Math.abs(Beyond[Beyond.length - 1] - Beyond[Beyond.length - 10]);
    Check(Furthest > 0.5 * Speed * RemoteRacket.MostAhead && Furthest <= Speed * RemoteRacket.MostAhead + 1e-9 && Still < 1e-12,
          `after the last pose the racket ran on ${Mm(Furthest)} (the most allowed is ${Mm(Speed * RemoteRacket.MostAhead)}) and holds at ${Mm(Rest)}`);
});

/** One machine's end of a match, pumped a frame at a time at the match's game speed. */
class End {
    readonly Hand = new CursorFollower(ReachEnvelope.Neutral);
    readonly Remote = new RemoteRacket(new Vec3(0, 0.2, Opponent.StandZ));
    readonly Game = new Rally(this.Hand, this.Remote, true);
    readonly Session: NetSession;

    constructor(Link: Transport, Host: boolean) {
        this.Hand.AimAt(new Vec3(2.0, 0, 1.6));
        this.Session = new NetSession(Link, this.Hand, this.Remote, this.Game, Host);
    }
}

test("PosesAndPingsRunOnRealTimeWhateverTheGameSpeed", () => {
    // Ten real seconds at game speed 0.5, at a 60 Hz display and at a 144 Hz one: 60 poses a real second either way.
    const Rates = [60, 144].map(Hz => {
        let Now = 0;
        const [HostLink, JoinLink] = MemoryTransport.Pair(() => Now, 0, 0);
        const Host = new End(HostLink, true), Joined = new End(JoinLink, false);
        let Pings = 0;
        for (let K = 0; K < 10 * Hz; K++) {
            Now += 1 / Hz;
            Host.Session.Pump(GameSpeed / Hz, 1 / Hz);
            for (const Msg of JoinLink.Poll()) {
                if (Msg.Kind === "Ping") Pings++;
                if (Msg.Kind === "Pose") Joined.Remote.Receive(NetMirror.Pose(new RacketPose(Msg.Centre, Msg.Normal, Msg.Roll)), Msg.At);
            }
        }
        return { Hz, Poses: Joined.Remote.PosesReceived() / 10, Pings: Pings / 10 };
    });
    Check(Rates.every(Each => Math.abs(Each.Poses - 60) <= 1 && Math.abs(Each.Pings - 2) <= 0.2),
          Rates.map(Each => `at ${Each.Hz} frames a s: ${F(Each.Poses, 1)} poses and ${F(Each.Pings, 1)} pings a real second`).join("; ")
          + " (before: 15 poses and 0.5 pings a real second at game speed 0.5)");
});

test("TheCatchUpIsTheOneWayTripInGameSeconds", () => {
    // 40 ms each way in real time, at game speed 0.5: a stroke's trip is 40 ms real, so 20 ms of game time.
    // Each leg also waits for the next 60 Hz frame, so the round trip reads between 80 ms and 80 ms + 2 frames.
    let Now = 0;
    const [HostLink, JoinLink] = MemoryTransport.Pair(() => Now, 0.04, 0);
    const Host = new End(HostLink, true), Joined = new End(JoinLink, false);
    for (let K = 0; K < 5 * 60; K++) {
        Now += Frame;
        Host.Session.Pump(GameSpeed * Frame, Frame);
        Joined.Session.Pump(GameSpeed * Frame, Frame);
    }
    const Trip = Host.Session.RoundTrip(), CatchUp = Host.Session.CatchUp();
    Check(Trip >= 0.08 - 1e-9 && Trip <= 0.08 + 2 * Frame + 1e-9 && Math.abs(CatchUp - Trip / 2 * GameSpeed) < 1e-12
          && CatchUp >= 0.02 - 1e-9 && CatchUp <= 0.02 + Frame * GameSpeed + 1e-9,
          `round trip ${F(Trip * 1000, 1)} ms real (jitter ${F(Host.Session.Jitter() * 1000, 1)} ms), path ${Host.Session.Path()}: `
          + `a remote stroke is flown on ${F(CatchUp * 1000, 1)} ms of game time (the true trip is 20 ms of game time plus the frame's wait)`);

    // And the stroke really is flown that far: struck moving at 5 m/s with nothing in its way, it lands CatchUp further on.
    const Struck = new BallState(new Vec3(0, 0.4, 1.2), new Vec3(0, 0.5, -5), Vec3.Zero);
    JoinLink.Send({ Kind: "Hit", Ball: Struck, At: 0 });
    for (let K = 0; K < 4; K++) { Now += Frame; Host.Session.Pump(0, 0); }
    const Flown = Host.Game.View().Ball.Position.Minus(NetMirror.Ball(Struck).Position).Length();
    const Expected = Struck.Velocity.Length() * CatchUp;
    expect(Host.Game.LastCorrection(), "no correction recorded").not.toBeNull();
    Check(Math.abs(Flown - Expected) < 5 * FixedClock.Step * Struck.Velocity.Length(),
          `the stroke arrived flown ${Mm(Flown)} on; ${F(CatchUp * 1000, 1)} ms at ${F(Struck.Velocity.Length(), 2)} m/s is ${Mm(Expected)}`);
});
