import { Air } from "../engine/Air";
import { BallState } from "../engine/BallState";
import { CollisionResult, Collisions } from "../engine/Collisions";
import { Flight } from "../engine/Flight";
import { RacketSweep } from "../engine/RacketSweep";
import { BallSpec, RacketSpec, TableSpec } from "../engine/Specs";
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
import { ServeAssist } from "./ServeAssist";
import { Serves } from "./Serves";
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

/** A remote stroke's jump of the ball, m: from where this machine had it to where the stroke put it. */
export interface Correction {
    readonly From: Vec3;
    readonly To: Vec3;
    readonly Serial: number;
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
 * referees: it alone puts each ball in play and calls each point; the other machines follow.
 *
 * A point starts one of two ways. With serving off (the default, and the drills) the ball is fed:
 * from the Feeder in practice, toward a random end in a match. With serving on (SetServing, the
 * owner's design in the Java edition's docs/HANDOFF.md) it is served under [ITTF] 2.6, by the end
 * the Scoreboard says: the ball rests in the server's free hand, just in front of their racket and
 * behind their end line; this machine's player tosses it with Toss (a double-click) and strikes it
 * as it falls with their ordinary swing, the lift raising their racket to it; the computer tosses
 * the same toss after ServeDelay and strikes one of its Serves. The player's struck serve is read
 * by ShotAssist.Serve and its first bounce held on their own court by ServeAssist, unless the shot
 * assist is off. Networked, the host says whose serve it is, the server's own machine tosses and
 * strikes (hitter authority), and the others follow its toss and its hit.
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
     * Where a server's free hand holds the ball, from their racket: HandAhead toward the net, m,
     * but never nearer the end line than HandBehindLine, and HandHeight above the playing surface
     * ([ITTF] 2.6.4: above the surface and behind the end line until it is struck). TUNED: straight
     * ahead of the racket, so a push forward meets the falling ball.
     */
    static readonly HandAhead = 0.30;
    static readonly HandBehindLine = 0.08;
    static readonly HandHeight = 0.25;

    /**
     * TUNED: how far the toss rises, m: straight up, without spin, and well over the 16 cm of
     * [ITTF] 2.6.2. It is in the air about 0.6 s, and falls through the lift's reach no faster
     * than the lift follows.
     */
    static readonly TossRise = 0.50;

    /** TUNED: how long the computer holds the ball before it tosses, s: time to see whose serve it is. */
    static readonly ServeDelay = 0.8;

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
    private OnServe: (Server: Side) => void = () => {};
    private OnToss: (Tossed: BallState) => void = () => {};

    /** Whether points start with a service rather than a feed. */
    private ServingOn = false;

    /** Whose serve the rally in progress, or about to start, is; null with no serve (feeds, or before the first). */
    private ServerNow: Side | null = null;

    /** The end whose free hand holds the ball, waiting to toss it; null otherwise. */
    private InHand: Side | null = null;

    /** How long until the computer tosses the ball it holds, s. */
    private TossIn = 0;

    /** Whether the match's first server has been drawn ([ITTF] 2.13.1), and which of its Serves the computer plays next. */
    private Drawn = false;
    private NextServe = 0;

    /** Networked: the point is called, and nothing more counts until the host puts the next ball in play. */
    private Closed = false;

    /** The host's call held for RemoteGrace in case the other player's stroke is still on its way, and how long it has left. */
    private Pending: Point | null = null;
    private PendingFor = 0;
    private Corrected: Correction | null = null;

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

    /**
     * Whether each point starts with a service (true) or a feed (false, as a new Rally starts: the
     * drills in practice, a ball toward a random end in a match). Takes effect with the next ball.
     * Networked, the host's setting is the match's.
     */
    SetServing(On: boolean): void { this.ServingOn = On; }

    /** Whether points start with a service. */
    Serving(): boolean { return this.ServingOn; }

    /** Whose serve it is: the end serving the rally in progress or about to start; null while balls are fed, and before the first serve. */
    Server(): Side | null { return this.ServerNow; }

    /** This machine's player holds the ball and has yet to toss it: a double-click (Toss) serves. */
    AwaitingToss(): boolean { return this.Held && this.InHand === "Near"; }

    /** The computer or the other player holds the ball and is about to toss it. */
    AwaitingTheirToss(): boolean { return this.Held && this.InHand === "Far"; }

    /** A service is under way: the ball has been tossed, and has not yet bounced on the receiver's court or been faulted. */
    ServiceInFlight(): boolean { return !this.Held && this.Umpire.InService(); }

    /** The name of the computer's last or coming serve, as UpcomingDrill names a feed. */
    ComputerServe(): string { return Serves.Presets[this.NextServe % Serves.Presets.length].Name; }

    /**
     * The player's double-click: tosses the ball they hold straight up by TossRise, to be struck as
     * it falls ([ITTF] 2.6.2, 2.6.3). True if a ball was tossed; false when it is not theirs to toss.
     */
    Toss(): boolean {
        if (!this.AwaitingToss()) return false;
        this.Throw("Near");
        if (this.IsNetworked) this.OnToss(this.Ball);
        return true;
    }

    /** Networked, on the host: told whose serve each rally is. */
    SetOnServe(Listener: (Server: Side) => void): void { this.OnServe = Listener; }

    /** Networked: told the ball as this machine's player tosses it, to share with the other machines. */
    SetOnToss(Listener: (Tossed: BallState) => void): void { this.OnToss = Listener; }

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
        // The lift meets a ball that has bounced on the player's side, and their own toss once it is falling.
        const TossFalling = this.Umpire.ServeTossedBy() === "Near" && !this.Umpire.Over() && this.Ball.Velocity.Y < 0;
        const Lifting = this.AutoLift && !this.Held && (this.Umpire.Awaiting("Near") || TossFalling);
        this.Player.LiftToward(Lifting ? this.Ball.Position.Y : ReachEnvelope.HitY);
        this.AimPlayer(Seconds);
        this.Player.Advance(Seconds);
        const PlayerTo = this.Player.Pose();

        if (this.Held) {
            for (const Each of this.Seats) Each.Agent.Follow(this.Ball, Seconds);
            if (this.InHand !== null) {
                // The ball rides in the server's free hand; the computer tosses it after ServeDelay.
                this.Ball = new BallState(this.HandOf(this.InHand), Vec3.Zero, Vec3.Zero);
                if (this.InHand === "Far" && this.ComputerAt("Far") >= 0 && (this.TossIn -= Seconds) <= 0) this.Throw("Far");
            }
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
        const Tossed = this.Umpire.Over() ? null : this.Umpire.ServeTossedBy();
        if (this.Shots !== null && Result.Racket === Rally.PlayerRacket) {
            // The player's stroke is read by ShotAssist; their service by its Serve, its first bounce then held on their own court.
            const Struck = Tossed === "Near"
                ? ServeAssist.Correct(this.Shots.Serve(this.Ball, Result.Ball, PlayerTo, this.Player.Moving(), this.Player.RightTilt()), "Near", Seconds)
                : this.Shots.Shoot(this.Ball, Result.Ball, PlayerTo, this.Player.Moving(), this.Player.RightTilt());
            Result = { ...Result, Ball: Struck };
        }
        // The computer's service: as its toss falls back to the height it left the hand at, the ball leaves its racket as the serve it chose.
        const Computer = this.ComputerAt("Far");
        if (Tossed === "Far" && Computer >= 0 && Result.Racket < 0 && Result.Ball.Velocity.Y < 0 && Result.Ball.Position.Y <= Rally.HandHeight) {
            const From = this.HandOf("Far");
            Result = { Ball: Serves.Launch(this.NextServe, From), Table: false, Net: false, Floor: false, Racket: Computer };
            this.Seats[Computer - 1].Agent.Served?.();
        }
        this.LastResult = Result;
        this.Ball = Result.Ball;
        if (this.IsNetworked && !this.Closed && Result.Racket === Rally.PlayerRacket) this.OnLocalHit(this.Ball);

        this.Rule(Result, Seconds);
        this.CountDown(Seconds);
    }

    /** One step's ball before the Referee: a point decided is awarded, or, where the other player's stroke may still be coming, held. */
    private Rule(Result: CollisionResult, Seconds: number): void {
        if (!Number.isNaN(this.FeedIn) || this.Closed) return;
        if (this.Pending !== null) {
            this.PendingFor -= Seconds;
            if (this.PendingFor <= 0) this.Award(this.Pending);
            return;
        }
        const Decided = this.Umpire.Judge(Result, this.Gone(), Seconds);
        // Off the host, the local Referee only keeps Awaiting true for the lift and aim help; the host's calls count.
        if (Decided === null || !this.Referees) return;
        const TheirReturnMayBeComing = this.IsNetworked && Decided.Winner === "Near";
        if (TheirReturnMayBeComing) {
            this.Pending = Decided;
            this.PendingFor = Rally.RemoteGrace;
        } else {
            this.Award(Decided);
        }
    }

    /** The engine index of the first racket at End that this machine plays for the computer (swept); -1 if a person plays there. */
    private ComputerAt(End: Side): number {
        const Index = this.Seats.findIndex(Each => Each.Side === End && Each.Swept);
        return Index < 0 ? -1 : Index + 1;
    }

    /** Where End's server holds the ball: HandAhead of their racket toward the net, behind their end line, HandHeight up. */
    private HandOf(End: Side): Vec3 {
        const Seat = this.Seats.find(Each => Each.Side === End);
        const Racket = End === "Near" || Seat === undefined ? this.Player.Pose().Centre : Seat.Agent.Pose().Centre;
        const Line = TableSpec.HalfLength + Rally.HandBehindLine;
        const Z = End === "Near" ? Math.max(Racket.Z - Rally.HandAhead, Line) : Math.min(Racket.Z + Rally.HandAhead, -Line);
        return new Vec3(Racket.X, Rally.HandHeight, Z);
    }

    /** By's toss: the ball leaves their hand straight up, without spin, fast enough to rise TossRise under gravity alone. */
    private Throw(By: Side): void {
        const Up = Math.sqrt(2 * -Air.Gravity.Y * Rally.TossRise);
        this.Ball = new BallState(this.HandOf(By), new Vec3(0, Up, 0), Vec3.Zero);
        this.Held = false;
        this.InHand = null;
        this.FeedIn = Number.NaN;
        this.Umpire.BeginServe(By, this.Ball);
    }

    /**
     * The next rally is Server's to serve: the ball goes to their hand. This machine's player
     * tosses when they choose (there is no time limit); the computer after ServeDelay.
     */
    private Ready(Server: Side): void {
        this.Closed = false;
        this.Pending = null;
        this.ServerNow = Server;
        this.InHand = Server;
        this.Held = true;
        this.FeedIn = Number.NaN;
        this.TossIn = Rally.ServeDelay;
        this.Ball = new BallState(this.HandOf(Server), Vec3.Zero, Vec3.Zero);
        if (Server === "Far" && this.ComputerAt("Far") >= 0) {
            // Which of its serves is drawn now and solved while the ball is still in its hand.
            this.NextServe = Math.min(Serves.Presets.length - 1, Math.floor(this.Coin() * Serves.Presets.length));
            Serves.Launch(this.NextServe, this.HandOf("Far"));
        }
    }

    /** Before a served rally: the board moves on, the first server of a new match is drawn by lot ([ITTF] 2.13.1), and the board says whose serve it is. */
    private NextServer(): Side {
        const NewMatch = !this.Drawn || this.Board.Now().MatchWinner !== null;
        this.Board.Next();
        if (NewMatch) this.Board.SetFirstServer(this.Coin() < 0.5 ? "Near" : "Far");
        this.Drawn = true;
        return this.Board.Server();
    }

    /**
     * Starts the next point at once; after a finished game or match, the next one starts from
     * love-all. With serving on, the ball goes to the server's hand (networked, the host says whose
     * serve it is). With it off, a new ball is sent: the next drill in practice, or, networked, the
     * host's warm-up feed toward a random end, as the other end's stroke. Off the host, this does
     * nothing (the host's Serve or Spawn arrives instead).
     */
    FeedNow(): void {
        if (this.IsNetworked && !this.Referees) return;
        if (this.ServingOn) {
            const Server = this.NextServer();
            this.Ready(Server);
            if (this.IsNetworked) this.OnServe(Server);
            return;
        }
        this.ServerNow = null;
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
        this.ServerNow = null;
        this.Spawn(Spawned, Striker);
    }

    /** Networked, off the host: the host says the next rally is Server's to serve, already in this machine's frame. */
    ApplyServe(Server: Side): void {
        this.Board.Next();
        this.Ready(Server);
    }

    /**
     * Networked: another player's toss, already in this machine's frame, flown forward by CatchUp
     * (up to MostCatchUp) as a remote stroke is. Only the end holding the ball can toss it.
     */
    ApplyRemoteToss(Tossed: BallState, CatchUp: number, By: Side = "Far"): void {
        if (this.Closed || !this.Held || this.InHand !== By) return;
        this.Ball = Tossed;
        this.Held = false;
        this.InHand = null;
        this.FeedIn = Number.NaN;
        this.Umpire.BeginServe(By, Tossed);
        const Seconds = FixedClock.Step;
        for (let Flown = Seconds / 2; Flown < Math.min(CatchUp, Rally.MostCatchUp); Flown += Seconds)
            this.Ball = Collisions.Resolve(this.Ball, Flight.Step(this.Ball, Seconds), Seconds, []).Ball;
    }

    /**
     * Networked: another player's stroke, already in this machine's frame, flown forward by CatchUp
     * (up to MostCatchUp) to make up for its trip here. By is the end they play for (the far end in
     * singles). Overturns a call the host is still holding; once a point is called, a late stroke
     * changes nothing.
     *
     * A stroke by the end whose toss is in the air (or, should the toss not have arrived, still in
     * their hand) is their service: their own machine judged the toss and the strike, and from here
     * the Referee judges it as a struck service. Its catch-up is flown before the Referee, since a
     * serve's first bounce, on the server's own court, can fall within it.
     */
    ApplyRemoteHit(Struck: BallState, CatchUp: number, By: Side = "Far"): void {
        if (this.Closed) return;
        this.Pending = null;
        const Seconds = FixedClock.Step;
        const Service = this.Umpire.ServeTossedBy() === By || (this.Held && this.InHand === By);
        if (Service) {
            this.Ball = Struck;
            this.Held = false;
            this.InHand = null;
            this.FeedIn = Number.NaN;
            this.Umpire.BeginServed(By);
            for (let Flown = Seconds / 2; Flown < Math.min(CatchUp, Rally.MostCatchUp); Flown += Seconds) {
                const Next = Collisions.Resolve(this.Ball, Flight.Step(this.Ball, Seconds), Seconds, []);
                this.Ball = Next.Ball;
                this.Rule(Next, Seconds);
            }
            return;
        }
        let Now = Struck;
        for (let Flown = Seconds / 2; Flown < Math.min(CatchUp, Rally.MostCatchUp); Flown += Seconds)
            Now = Collisions.Resolve(Now, Flight.Step(Now, Seconds), Seconds, []).Ball;
        this.Corrected = { From: this.Ball.Position, To: Now.Position, Serial: (this.Corrected?.Serial ?? 0) + 1 };
        this.Launch(Now, By);
    }

    /**
     * Networked: where the last remote stroke moved the ball, or null before the first. Until a
     * stroke arrives this machine's ball flies on past the other player's racket; the stroke then
     * puts it on its true path at once, From where it was drawn To where it now is. The rally keeps
     * the true ball; whoever draws it can ease across the gap, and Serial tells one correction from the next.
     */
    LastCorrection(): Correction | null { return this.Corrected; }

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
        this.InHand = null;
        this.FeedIn = Number.NaN;
        this.Umpire.Begin(Striker);
    }

    /** Holds the ball still at Point with no feed coming, for drills, tests and screenshots. */
    Hold(At: Vec3): void {
        this.Ball = new BallState(At, Vec3.Zero, Vec3.Zero);
        this.Held = true;
        this.InHand = null;
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
