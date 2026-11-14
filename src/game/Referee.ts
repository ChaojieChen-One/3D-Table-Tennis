import { BallState } from "../engine/BallState";
import { CollisionResult } from "../engine/Collisions";
import { TableSpec } from "../engine/Specs";
import { Vec3 } from "../engine/math/Vec3";
import { Other, PracticeNames, Side, SideAt, SideNames } from "./Side";

/**
 * How a rally ended: the point's Winner, or null for a let (no point); and why. The reason is kept
 * as a template with {Near} and {Far} in place of the ends' names, so each machine (or a mirrored
 * one, whose Near is the other's Far) can say it with its own names.
 */
export class Point {
    constructor(readonly Winner: Side | null, readonly Template: string) {}

    /** The reason with the ends named. */
    Reason(Names: SideNames = PracticeNames): string {
        return this.Template.replaceAll("{Near}", Names.Near).replaceAll("{Far}", Names.Far);
    }

    /** The same call seen from the other end of the table: the winner and the names swapped. */
    Mirrored(): Point {
        const Swapped = this.Template.replaceAll("{Near}", "\u0000").replaceAll("{Far}", "{Near}").replaceAll("\u0000", "{Far}");
        return new Point(this.Winner === null ? null : Other(this.Winner), Swapped);
    }

    Describe(Names: SideNames = PracticeNames): string {
        return (this.Winner === null ? "let" : "point to " + Names[this.Winner]) + ": " + this.Reason(Names);
    }

    toString(): string { return this.Describe(); }
}

/** {Near} or {Far}: the placeholder a template names Of by. */
function N(Of: Side): string { return "{" + Of + "}"; }

/**
 * Judges a rally under the ITTF Laws of Table Tennis (2.7, a good return; 2.10, a point) and says
 * the moment a point is decided, so no rally runs on past it. The near court is z > 0 and the far
 * court z < 0. A rally's first ball is the striker's stroke: a feed counts as the feeder's end.
 * Doubles' order of play (2.8.3) is not judged yet: any racket of an end may strike for it.
 *
 * A rally that starts with a service (BeginServe) is judged under 2.6 first. The toss must rise at
 * least LeastToss after leaving the palm and touch nothing before it is struck (2.6.2); the server
 * strikes it as it falls, so that it touches their own court first and then the receiver's
 * (2.6.3), from above the playing surface and behind their end line (2.6.4). A service that fails
 * any of these is the receiver's point (2.10.1.1). One that touches the net assembly and is
 * otherwise good, or is obstructed by the receiver after touching it, is a let (2.9.1.1). Once it
 * has bounced on the receiver's court it is an ordinary stroke of the rally. Not judged: the open
 * palm and the stationary hand (2.6.1), the toss's angle and spin (2.6.2) and hiding the ball
 * (2.6.5), which the game's own toss cannot get wrong.
 */
export class Referee {
    /**
     * Touches by one end this close together are one stroke: the Laws fault only a deliberate
     * double hit (2.10.1.6), and a racket can meet a ball twice in a single swing.
     */
    private static readonly OneStroke = 0.06;

    /** A safeguard, not a law: this long after the last stroke with nothing decided, the rally ends as a let. */
    static readonly LongestWait = 4.0;

    /** [ITTF] 2.6.2: the least the tossed ball must rise after leaving the palm, m. */
    static readonly LeastToss = 0.16;

    /** Where a service has got to: none in progress, tossed and not yet struck, or struck and not yet on the receiver's court. */
    private Service: "None" | "Tossed" | "Struck" = "None";
    private Server: Side = "Far";

    /** The toss: the height it left the palm at and the highest it has been, m, and whether it was falling as the last step ended. */
    private TossedFrom = 0;
    private TossPeak = 0;
    private Falling = false;

    /** The struck service: whether it has touched the server's own court, and the net assembly. */
    private OwnCourt = false;
    private NetTouched = false;

    private Striker: Side = "Far";
    private Bounces = 0;          // on the receiver's court since the last stroke
    private SinceStroke = 0;
    private Decided: Point | null = null;

    /** SideOf tells which end the engine's racket Index belongs to. */
    constructor(private readonly SideOf: (Index: number) => Side = Index => Index === 0 ? "Near" : "Far") {}

    /** A new rally whose first ball was struck by FirstStriker. */
    Begin(FirstStriker: Side): void {
        this.Striker = FirstStriker;
        this.Bounces = 0;
        this.SinceStroke = 0;
        this.Decided = null;
        this.Service = "None";
    }

    /** A new rally that starts with Server's service: Tossed is the ball as it leaves their palm. */
    BeginServe(Server: Side, Tossed: BallState): void {
        this.Begin(Server);
        this.Service = "Tossed";
        this.Server = Server;
        this.TossedFrom = this.TossPeak = Tossed.Position.Y;
        this.Falling = Tossed.Velocity.Y < 0;
        this.OwnCourt = this.NetTouched = false;
    }

    /**
     * A new rally whose service Server has already struck, on their own machine (hitter authority):
     * the toss and the strike are theirs to have judged, and what the ball does next is judged here.
     */
    BeginServed(Server: Side): void {
        this.Begin(Server);
        this.Service = "Struck";
        this.Server = Server;
        this.OwnCourt = this.NetTouched = false;
    }

    /** The server whose toss is in the air and not yet struck, whether or not it has since been faulted; null otherwise. */
    ServeTossedBy(): Side | null { return this.Service === "Tossed" ? this.Server : null; }

    /** A service is still being made: tossed or struck, and not yet good, a let or a fault. */
    InService(): boolean { return this.Decided === null && this.Service !== "None"; }

    Over(): boolean { return this.Decided !== null; }

    /** Receiver has a ball to return: the rally is live, the other end struck it, and it has bounced once on Receiver's court. */
    Awaiting(Receiver: Side): boolean { return this.Decided === null && this.Striker === Other(Receiver) && this.Bounces === 1; }

    /**
     * One physics step: what the ball struck, whether it has come to rest or left the hall (Gone),
     * and the step's length. Returns the point at the step it is decided; null before and after.
     */
    Judge(Step: CollisionResult, Gone: boolean, Seconds: number): Point | null {
        if (this.Decided !== null) return null;
        this.SinceStroke += Seconds;
        const At = Step.Ball.Position;

        let Now: Point | null = null;
        const Court = SideAt(At.Z);
        if (this.Service === "Tossed") {
            Now = this.JudgeToss(Step);   // a toss is all but still at its top: only what it touches ends it
        } else if (this.Service === "Struck") {
            Now = this.JudgeService(Step, Court, Gone);
        } else {
            if (Step.Racket >= 0) Now = this.Struck(this.SideOf(Step.Racket), At);
            if (Now === null && Step.Table && Court !== null) Now = this.Bounced(Court);
            if (Now === null && Step.Floor) Now = this.Missed("it touched the floor");
            if (Now === null && Gone) Now = this.Missed("it left play");
        }
        if (Now === null && this.SinceStroke > Referee.LongestWait) Now = new Point(null, "no stroke for " + Referee.LongestWait + " s");
        this.Decided = Now;
        return Now;
    }

    /** A fault in service: [ITTF] 2.10.1.1, the receiver's point. Law is the service law broken. */
    private Fault(Law: string, How: string): Point {
        return new Point(Other(this.Server), Law + ": " + N(this.Server) + "'s service was a fault (2.10.1.1); " + How);
    }

    /** The toss in the air: it must touch nothing until the server strikes it, falling, having risen LeastToss. */
    private JudgeToss(Step: CollisionResult): Point | null {
        const At = Step.Ball.Position;
        const WasFalling = this.Falling;
        this.Falling = Step.Ball.Velocity.Y < 0;
        // The receiver's racket has no business with a toss behind the server's end line; it is not judged.
        if (Step.Racket >= 0 && this.SideOf(Step.Racket) === this.Server) {
            const Rose = this.TossPeak - this.TossedFrom;
            if (!WasFalling) return this.Fault("2.6.3", "the ball was struck before it was falling");
            if (Rose < Referee.LeastToss - 1e-9)
                return this.Fault("2.6.2", "the toss rose " + (Rose * 100).toFixed(0) + " cm, less than " + (Referee.LeastToss * 100).toFixed(0) + " cm");
            const Behind = this.Server === "Near" ? At.Z > TableSpec.HalfLength : At.Z < -TableSpec.HalfLength;
            if (!Behind || At.Y <= 0)
                return this.Fault("2.6.4", "the ball was struck " + (Behind ? "below the playing surface" : "in front of the end line"));
            this.Service = "Struck";
            this.SinceStroke = 0;
            return null;
        }
        this.TossPeak = Math.max(this.TossPeak, At.Y);
        if (Step.Table) return this.Fault("2.6.2", "the toss touched the table before it was struck");
        if (Step.Floor) return this.Fault("2.6.2", "the toss was not struck before it touched the floor");
        return null;
    }

    /** The struck service: the server's court first, then over the net to the receiver's, when it becomes a stroke of the rally. */
    private JudgeService(Step: CollisionResult, Court: Side | null, Gone: boolean): Point | null {
        const Server = this.Server, Receiver = Other(Server);
        if (Step.Net) this.NetTouched = true;
        if (Step.Racket >= 0) {
            const By = this.SideOf(Step.Racket);
            if (By === Server)
                return this.SinceStroke < Referee.OneStroke ? null
                    : new Point(Receiver, "2.10.1.6: " + N(Server) + " struck the ball twice in succession");
            if (this.NetTouched) return new Point(null, "2.9.1.1: " + N(Server) + "'s service touched the net and " + N(Receiver) + " obstructed it");
            return Referee.OverCourt(By, Step.Ball.Position)
                ? new Point(Server, "2.10.1.5: " + N(By) + " obstructed the ball over their own court")
                : this.Fault("2.6.3", "it passed " + N(Receiver) + "'s court without touching it");
        }
        if (Step.Table && Court !== null) {
            if (Court === Server) {
                if (this.OwnCourt) return this.Fault("2.6.3", "it bounced twice on their own court");
                this.OwnCourt = true;
                return null;
            }
            if (!this.OwnCourt) return this.Fault("2.6.3", "it did not touch their own court first");
            if (this.NetTouched) return new Point(null, "2.9.1.1: " + N(Server) + "'s service touched the net");
            // A good service: from here it is the server's stroke, bounced once on the receiver's court.
            this.Service = "None";
            this.Striker = Server;
            this.Bounces = 1;
            return null;
        }
        if (Step.Floor) return this.Fault("2.6.3", "it missed " + N(Receiver) + "'s court and touched the floor");
        if (Gone) return this.Fault("2.6.3", "it missed " + N(Receiver) + "'s court");
        return null;
    }

    private Struck(By: Side, At: Vec3): Point | null {
        if (By === this.Striker) {
            if (this.SinceStroke < Referee.OneStroke) return null;
            return new Point(Other(By), "2.10.1.6: " + N(By) + " struck the ball twice in succession");
        }
        if (this.Bounces === 0) {
            return Referee.OverCourt(By, At)
                ? new Point(Other(By), "2.10.1.5: " + N(By) + " obstructed the ball over their own court")
                : new Point(By, "2.10.1.4: the ball passed " + N(By) + "'s court without touching it");
        }
        this.Striker = By;
        this.Bounces = 0;
        this.SinceStroke = 0;
        return null;
    }

    private Bounced(Court: Side): Point | null {
        if (Court === this.Striker) return new Point(Other(this.Striker), "2.7.1: " + N(this.Striker) + "'s return touched their own court");
        this.Bounces++;
        if (this.Bounces >= 2) return new Point(this.Striker, "2.10.1.2: the ball bounced twice on " + N(Court) + "'s court");
        return null;
    }

    /** The ball is finished: if it reached the receiver's court they failed to return it, otherwise the stroke missed. */
    private Missed(How: string): Point {
        const Receiver = Other(this.Striker);
        return this.Bounces >= 1
            ? new Point(this.Striker, "2.10.1.2: " + N(Receiver) + " did not return the ball before " + How)
            : new Point(Receiver, "2.10.1.3: " + N(this.Striker) + "'s stroke missed the court; " + How);
    }

    private static OverCourt(Owner: Side, At: Vec3): boolean {
        const OnTheirHalf = Owner === "Near" ? At.Z > 0 : At.Z < 0;
        return OnTheirHalf && Math.abs(At.X) <= TableSpec.HalfWidth && Math.abs(At.Z) <= TableSpec.HalfLength;
    }
}
