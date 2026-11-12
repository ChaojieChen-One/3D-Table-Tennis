import { BallState } from "../engine/BallState";
import { CollisionResult, Collisions } from "../engine/Collisions";
import { Flight } from "../engine/Flight";
import { RacketSweep } from "../engine/RacketSweep";
import { BallSpec, RacketSpec } from "../engine/Specs";
import { Clamp } from "../engine/math/Numeric";
import { Vec3 } from "../engine/math/Vec3";
import { Aiming } from "./Aiming";
import { CursorFollower } from "./control/CursorFollower";
import { RacketPose } from "./control/RacketPose";
import { ReachEnvelope } from "./control/ReachEnvelope";
import { Swing } from "./control/Swing";
import { Feeder } from "./Feeder";
import { FixedClock } from "./FixedClock";
import { Opponent } from "./Opponent";
import { HalfTurnBall, RacketAgent } from "./RacketAgent";
import { RallyView } from "./RallyView";
import { Point, Referee } from "./Referee";
import { Score, Scoreboard } from "./Scoreboard";
import { Shot, ShotAssist } from "./ShotAssist";
import { Other, Side } from "./Side";

/**
 * A racket at the table other than this machine's own player: which end it plays for, what drives
 * it, and whether this machine's engine sweeps it. The computer is swept here; a remote player is
 * not, because their own machine decides their hits (hitter authority).
 */
export interface Seat {
    readonly Side: Side;
    readonly Agent: RacketAgent;
    readonly Swept: boolean;
}

/**
 * One ball in play, advanced on the fixed clock. Each step this machine's player's racket follows
 * the cursor (and, once the ball has bounced on their side, rises to its height), the ball flies,
 * every other seat follows the ball, and the engine resolves whatever the ball struck. The Referee
 * ends the rally the moment the ITTF Laws decide the point, and the next ball is fed after a pause.
 * Each point is counted on the Scoreboard: games to 11, a match best of five.
 *
 * The local player always plays the near end (z > 0). Every other racket is a Seat, so singles has
 * one (the computer, or a remote player), and doubles or a computer partner would have three: the
 * rally itself never assumes how many.
 *
 * Networked, the remote seats are never swept: each machine decides its own player's hits and
 * shares them (hitter authority), so the others' strokes arrive through ApplyRemoteHit. The host
 * referees: it alone puts each ball in play, from a random end while there are no serves, and
 * calls each point; the other machines follow.
 */
export class Rally {
    /** Index of each racket in the engine's results: this machine's player, then the seats in order. */
    static readonly PlayerRacket = 0;
    static readonly OpponentRacket = 1;

    /** TUNED: how long a dead ball lies before the next feed, and the wait before the first. */
    static readonly FeedDelay = 1.0;

    /** Beyond these the ball has left the hall, m. */
    private static readonly FarX = 4;
    private static readonly FarZ = 6;

    /** Slower than this, m/s, the ball has come to rest. */
    private static readonly AtRest = 0.05;

    /**
     * TUNED: how long the host holds a point it has won on a ball the other player had to return,
     * game s. Their stroke reaches the host one way trip late, and the host's ball, which no racket
     * stopped, has flown on toward the floor meanwhile; a stroke that arrives within this overturns
     * the call. About two round trips at a laggy 150 ms, at the 0.5 game speed.
     */
    static readonly RemoteGrace = 0.15;

    /** The most a remote stroke is flown forward to make up for its one way trip, game s; anything later is shown as it was struck. */
    static readonly MostCatchUp = 0.25;

    /** TUNED: how long a won game or match stands on the board before the next ball, s. */
    static readonly GameOverDelay = 3.0;

    /**
     * TUNED: the aim help's default strength, 0 (off) to 1. The third hitting help: as a ball that
     * has bounced on the player's side comes within AimFrom, their untouched face turns this far
     * toward the face Aiming finds for the swing they are making, so a push lands in the far half
     * whatever the spin. The face keys still tilt it from there; the contact stays physical.
     * Off by default: the shot's power now sets its depth, and the face the help turns changes the
     * contact's spin, which made the same push land at different depths on different drills.
     */
    static readonly DefaultAimHelp = 0;

    /** TUNED: the aim help's strength when switched on without one, as it was tuned with the contact left physical. */
    static readonly TunedAimHelp = 0.8;

    /**
     * The aim help looks this far ahead of the player's racket, m, and aims again every AimEvery
     * steps; within AimClose, every AimEveryClose, as its foresight sharpens.
     */
    private static readonly AimFrom = 0.8;
    private static readonly AimClose = 0.3;
    private static readonly AimEvery = 12;
    private static readonly AimEveryClose = 3;

    /** The player's strokes go toward the far end, landing straight down the line at mid depth. */
    private static readonly PlayerToward = new Vec3(0, 0, -1);
    private static readonly AimDepth = -0.85;
    private static readonly AimMostAcross = 0.45;

    /** TUNED: the forward swing the aim help expects at least, m/s: what an ordinary push reads as through Swing. */
    private static readonly ExpectedPush = 1.6;

    private readonly Seats: readonly Seat[];
    private readonly Feed = new Feeder();
    private readonly Umpire: Referee;
    private readonly Board = new Scoreboard();

    /** Networked only: whether this machine calls the points (the host), or takes them from the host. */
    private Referees = true;
    private OnLocalHit: (Struck: BallState) => void = () => {};
    private OnSpawn: (Spawned: BallState, Striker: Side) => void = () => {};
    private OnPoint: (Called: Point) => void = () => {};

    /** Networked: the point is called, and nothing more counts until the host puts the next ball in play. */
    private Closed = false;

    /** The host's call held for RemoteGrace in case the other player's stroke is still on its way, and how long it has left. */
    private Pending: Point | null = null;
    private PendingFor = 0;

    private Last: Point | null = null;
    private Ball: BallState = new BallState(Feeder.Hold, Vec3.Zero, Vec3.Zero);
    private Held = true;
    private FeedIn = Rally.FeedDelay;
    private LastResult: CollisionResult = { Ball: this.Ball, Table: false, Net: false, Floor: false, Racket: -1 };

    /**
     * The first hitting help, on unless switched off: once the ball has bounced on the player's
     * side, their racket rises to its height. Only before the bounce would meeting it be an
     * obstruction, so the lift waits for it. The rise is part of the swing.
     */
    private AutoLift = true;

    /**
     * The player's shot direction (ShotAssist, the part of the earlier version's shot model the
     * owner kept), on unless switched off: each stroke heads the way the player aims, its pace,
     * height and spin left to the contact. Off, the player's contact is the engine's alone.
     */
    private Shots: ShotAssist | null = new ShotAssist();

    private AimHelp = Rally.DefaultAimHelp;
    private SinceAim = Rally.AimEvery;

    /**
     * The local player against Others: by default the computer at the far end. Pass one agent for
     * singles (it plays the far end, swept unless Networked), or the seats in full for anything else.
     */
    constructor(private readonly Player: CursorFollower,
                Others: RacketAgent | readonly Seat[] = new Opponent(),
                private readonly IsNetworked = false,
                private readonly Coin: () => number = Math.random) {
        this.Seats = Array.isArray(Others)
            ? (Others as readonly Seat[])
            : [{ Side: "Far", Agent: Others as RacketAgent, Swept: !IsNetworked }];
        this.Umpire = new Referee(Index => Index === Rally.PlayerRacket ? "Near" : this.Seats[Index - 1].Side);
    }

    /** Networked: true on the host, which calls the points and puts each ball in play; false on a machine that joined. */
    SetReferee(Calls: boolean): void { this.Referees = Calls; }

    /** Networked: told the ball as the local player struck it, to share with the other machines. */
    SetOnLocalHit(Listener: (Struck: BallState) => void): void { this.OnLocalHit = Listener; }

    /** Networked, on the host: told each ball it puts in play and whose stroke it counts as. */
    SetOnSpawn(Listener: (Spawned: BallState, Striker: Side) => void): void { this.OnSpawn = Listener; }

    /** Networked, on the host: told each point it calls. */
    SetOnPoint(Listener: (Called: Point) => void): void { this.OnPoint = Listener; }

    SetAutoLift(On: boolean): void { this.AutoLift = On; }

    SetShotAssist(On: boolean): void { this.Shots = On ? new ShotAssist() : null; }

    /** The player's last aimed shot, or null with none yet. */
    LastShot(): Shot | null { return this.Shots === null ? null : this.Shots.Last(); }

    /** The aim help's strength, 0 (off) to 1. */
    SetAimHelp(Strength: number): void { this.AimHelp = Math.max(0, Math.min(1, Strength)); }

    /** The rackets other than this machine's player, in their engine order (index 1 onward). */
    AllSeats(): readonly Seat[] { return this.Seats; }

    /** One step of FixedClock.Step. */
    Step(): void {
        const Seconds = FixedClock.Step;
        const PlayerFrom = this.Player.Pose().Centre;
        const Lifting = this.AutoLift && !this.Held && this.Umpire.Awaiting("Near");
        this.Player.LiftToward(Lifting ? this.Ball.Position.Y : ReachEnvelope.HitY);
        this.AimPlayer(Seconds);
        this.Player.Advance(Seconds);
        const PlayerTo = this.Player.Pose();

        if (this.Held) {
            for (const Each of this.Seats) Each.Agent.Follow(this.Ball, Seconds);
            this.CountDown(Seconds);
            return;
        }

        const Flown = Flight.Step(this.Ball, Seconds);

        // The engine sweeps this machine's player and every swept seat; RacketOf maps its results
        // back to the rally's own racket indices, which the Referee knows the ends of.
        const Sweeps: RacketSweep[] = [new RacketSweep(PlayerFrom, PlayerTo.Centre, PlayerTo.Normal, this.Player.SwingVelocity())];
        const RacketOf: number[] = [Rally.PlayerRacket];
        this.Seats.forEach((Each, Index) => {
            const From = Each.Agent.Pose().Centre;
            Each.Agent.Follow(Flown, Seconds);
            if (!Each.Swept) return;
            const To = Each.Agent.Pose();
            Sweeps.push(new RacketSweep(From, To.Centre, To.Normal));
            RacketOf.push(Index + 1);
        });

        const Resolved = Collisions.Resolve(this.Ball, Flown, Seconds, Sweeps);
        let Result: CollisionResult = { ...Resolved, Racket: Resolved.Racket < 0 ? -1 : RacketOf[Resolved.Racket] };
        if (this.Shots !== null && Result.Racket === Rally.PlayerRacket)
            Result = { ...Result, Ball: this.Shots.Shoot(this.Ball, Result.Ball, PlayerTo, this.Player.Moving(), this.Player.RightTilt()) };
        this.LastResult = Result;
        this.Ball = Result.Ball;
        if (this.IsNetworked && !this.Closed && Result.Racket === Rally.PlayerRacket) this.OnLocalHit(this.Ball);

        if (Number.isNaN(this.FeedIn) && !this.Closed) {
            if (this.Pending !== null) {
                this.PendingFor -= Seconds;
                if (this.PendingFor <= 0) this.Award(this.Pending);
            } else {
                const Decided = this.Umpire.Judge(Result, this.Gone(), Seconds);
                // Off the host, the local Referee only keeps Awaiting true for the lift and aim help; the host's calls count.
                if (Decided !== null && this.Referees) {
                    const TheirReturnMayBeComing = this.IsNetworked && Decided.Winner === "Near";
                    if (TheirReturnMayBeComing) {
                        this.Pending = Decided;
                        this.PendingFor = Rally.RemoteGrace;
                    } else {
                        this.Award(Decided);
                    }
                }
            }
        }
        this.CountDown(Seconds);
    }

    /**
     * Sends a new ball at once; after a finished game or match, the next one starts from love-all.
     * Networked, the host sends the warm-up feed toward a random end, as the other end's stroke,
     * while there are no serves; off the host, this does nothing (the host's Spawn arrives instead).
     */
    FeedNow(): void {
        if (!this.IsNetworked) {
            this.Board.Next();
            this.Launch(this.Feed.Next(), "Far");
            return;
        }
        if (!this.Referees) return;
        this.Board.Next();
        const Receiver: Side = this.Coin() < 0.5 ? "Near" : "Far";
        const Spawned = Receiver === "Near" ? Feeder.WarmUp() : HalfTurnBall(Feeder.WarmUp());
        this.Spawn(Spawned, Other(Receiver));
        this.OnSpawn(Spawned, Other(Receiver));
    }

    /** Networked, off the host: the ball the host has just put in play, already in this machine's frame. */
    ApplySpawn(Spawned: BallState, Striker: Side): void {
        this.Board.Next();
        this.Spawn(Spawned, Striker);
    }

    /**
     * Networked: another player's stroke, already in this machine's frame, flown forward by CatchUp
     * (up to MostCatchUp) to make up for its trip here. By is the end they play for (the far end in
     * singles). Overturns a call the host is still holding; once a point is called, a late stroke
     * changes nothing.
     */
    ApplyRemoteHit(Struck: BallState, CatchUp: number, By: Side = "Far"): void {
        if (this.Closed) return;
        this.Pending = null;
        const Seconds = FixedClock.Step;
        let Now = Struck;
        for (let Flown = Seconds / 2; Flown < Math.min(CatchUp, Rally.MostCatchUp); Flown += Seconds)
            Now = Collisions.Resolve(Now, Flight.Step(Now, Seconds), Seconds, []).Ball;
        this.Launch(Now, By);
    }

    /** Networked, off the host: the point the host has called, already in this machine's frame. */
    ApplyRemotePoint(Called: Point): void {
        if (!this.Closed) this.Award(Called);
    }

    /** Whether this rally is against other machines' players rather than the computer. */
    Networked(): boolean { return this.IsNetworked; }

    private Spawn(Spawned: BallState, Striker: Side): void {
        this.Closed = false;
        this.Pending = null;
        this.Launch(Spawned, Striker);
    }

    /**
     * Counts Called and, unless off the host, waits to feed the next ball. Networked, the point is
     * closed until the next ball, and the host shares its call.
     */
    private Award(Called: Point): void {
        this.Pending = null;
        this.Last = Called;
        this.Board.Award(Called.Winner);
        if (this.IsNetworked) {
            this.Closed = true;
            if (this.Referees) this.OnPoint(Called);
        }
        this.FeedIn = this.IsNetworked && !this.Referees ? Number.NaN
            : this.Board.Now().GameWinner === null ? Rally.FeedDelay : Rally.GameOverDelay;
    }

    /** The score: points and games by end, and who has just won a game or the match. */
    Score(): Score { return this.Board.Now(); }

    /** Puts Ball in play as it is, as a stroke by Striker, for drills and tests. */
    Launch(Ball: BallState, Striker: Side): void {
        this.Ball = Ball;
        this.Held = false;
        this.FeedIn = Number.NaN;
        this.Umpire.Begin(Striker);
    }

    /** Holds the ball still at Point with no feed coming, for drills, tests and screenshots. */
    Hold(At: Vec3): void {
        this.Ball = new BallState(At, Vec3.Zero, Vec3.Zero);
        this.Held = true;
        this.FeedIn = Number.NaN;
    }

    View(): RallyView {
        const Rackets: RacketPose[] = [this.Player.Pose()];
        for (const Each of this.Seats) Rackets.push(Each.Agent.Pose());
        return new RallyView(this.Ball, Rackets);
    }

    /** What the last step's ball struck. */
    LastStep(): CollisionResult { return this.LastResult; }

    /** How the last finished rally ended, or null before the first. */
    LastPoint(): Point | null { return this.Last; }

    /** Which drill the next practice feed will be. */
    UpcomingDrill(): string { return this.Feed.Upcoming().Name; }

    /**
     * The aim help, once a step: while a ball that has bounced on the player's side comes within
     * AimFrom of their racket, the face is aimed again every AimEvery steps for the swing being
     * made now; once the ball is theirs no longer, the face is given back.
     */
    private AimPlayer(Seconds: number): void {
        const Theirs = this.AimHelp > 0 && !this.Held && this.Umpire.Awaiting("Near");
        if (!Theirs) {
            this.Player.AimFace(null, 0);
            this.SinceAim = Rally.AimEvery;
            return;
        }
        const Gap = this.Player.Pose().Centre.Z - this.Ball.Position.Z;
        const Every = Gap < Rally.AimClose ? Rally.AimEveryClose : Rally.AimEvery;
        if (this.Ball.Velocity.Z <= 0 || Gap < 0 || Gap > Rally.AimFrom || ++this.SinceAim < Every) return;
        this.SinceAim = 0;
        const Ahead = this.PlayerMeeting(Seconds);
        if (Ahead === null) return;
        const Target = new Vec3(Clamp(Ahead.Ball.Position.X, -Rally.AimMostAcross, Rally.AimMostAcross), 0, Rally.AimDepth);
        this.Player.AimFace(Aiming.FaceToward(Ahead.Ball, Ahead.Swing, Target, Rally.PlayerToward, Seconds), this.AimHelp);
    }

    /**
     * The player's racket carried forward as CursorFollower carries it, toward the cursor's aim at
     * its top speed with its motion smoothed the same way, until the ball reaches it; null if the
     * ball never does. The swing it will meet the ball with is read from that motion, forward never
     * less than ExpectedPush (a player waiting for the ball pushes as it arrives, and a face aimed
     * for a still racket would send that push long), up and down what the lift will be doing.
     */
    private PlayerMeeting(Seconds: number): { Ball: BallState; Swing: Vec3 } | null {
        const Reach = BallSpec.Radius + RacketSpec.BladeThickness / 2;
        let Racket = this.Player.Pose().Centre;
        const Aim = this.Player.Target();
        let Moving = this.Player.Moving();
        const Smoothing = 1 - Math.exp(-Seconds / Swing.Smoothing);
        let Coming = this.Ball;
        for (let Looked = 0; Looked < 1.5; Looked += Seconds) {
            if (Racket.Z - Coming.Position.Z <= Reach) {
                const Read = Swing.Read(new Vec3(Moving.X, 0, Moving.Z), Rally.PlayerToward);
                const Forward = Read.Dot(Rally.PlayerToward), Height = Coming.Position.Y;
                const Lifted = this.AutoLift && Height >= ReachEnvelope.HitY && Height <= ReachEnvelope.HighestLift;
                const Rising = Lifted ? Clamp(Coming.Velocity.Y, -CursorFollower.LiftSpeed, CursorFollower.LiftSpeed) : 0;
                const Met = Read.PlusScaled(Rally.PlayerToward, Math.max(Forward, Rally.ExpectedPush) - Forward).PlusScaled(Vec3.Up, Rising);
                return { Ball: Coming, Swing: Met };
            }
            if (Coming.Velocity.Z <= 0) return null;
            const Level = new Vec3(Racket.X, Aim.Y, Racket.Z);
            const Next = Level.MovedToward(Aim, CursorFollower.TrackSpeed * Seconds);
            Moving = Vec3.Lerp(Moving, Next.Minus(Level).Scale(1 / Seconds), Smoothing);
            Racket = new Vec3(Next.X, Racket.Y, Next.Z);
            Coming = Collisions.Resolve(Coming, Flight.Step(Coming, Seconds), Seconds, []).Ball;
        }
        return null;
    }

    /** The ball has left the hall or come to rest: nothing more can happen to it. */
    private Gone(): boolean {
        const P = this.Ball.Position;
        return Math.abs(P.X) > Rally.FarX || Math.abs(P.Z) > Rally.FarZ || this.Ball.Velocity.Length() < Rally.AtRest;
    }

    private CountDown(Seconds: number): void {
        if (Number.isNaN(this.FeedIn)) return;
        this.FeedIn -= Seconds;
        if (this.FeedIn <= 0) this.FeedNow();
    }
}
