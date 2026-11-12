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
 * Serving (2.6) is not judged yet; there are no serves. Doubles' order of play (2.8.3) is not
 * judged yet either: any racket of an end may strike for it.
 */
export class Referee {
    /**
     * Touches by one end this close together are one stroke: the Laws fault only a deliberate
     * double hit (2.10.1.6), and a racket can meet a ball twice in a single swing.
     */
    private static readonly OneStroke = 0.06;

    /** A safeguard, not a law: this long after the last stroke with nothing decided, the rally ends as a let. */
    static readonly LongestWait = 4.0;

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
    }

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
        if (Step.Racket >= 0) Now = this.Struck(this.SideOf(Step.Racket), At);
        const Court = SideAt(At.Z);
        if (Now === null && Step.Table && Court !== null) Now = this.Bounced(Court);
        if (Now === null && Step.Floor) Now = this.Missed("it touched the floor");
        if (Now === null && Gone) Now = this.Missed("it left play");
        if (Now === null && this.SinceStroke > Referee.LongestWait) Now = new Point(null, "no stroke for " + Referee.LongestWait + " s");
        this.Decided = Now;
        return Now;
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
