import { BallState } from "../engine/BallState";
import { Contact } from "../engine/Contact";
import { Flight } from "../engine/Flight";
import { LaunchSolver } from "../engine/LaunchSolver";
import { BallSpec, NetSpec, RacketSpec, TableSpec } from "../engine/Specs";
import { SpinVector } from "../engine/SpinVector";
import { Surface } from "../engine/Surface";
import { Clamp, ToDegrees, ToRadians } from "../engine/math/Numeric";
import { Vec3 } from "../engine/math/Vec3";
import { RacketPose } from "./control/RacketPose";
import { Swing } from "./control/Swing";

/** The last shot: the heading aimed for and the contact's own, degrees right of straight, its pace, m/s, and how cleanly it was struck (0 to 1). */
export interface Shot {
    readonly AimedDegrees: number;
    readonly PhysicalDegrees: number;
    readonly Pace: number;
    readonly Clean: number;
}

/**
 * The player's shot direction and power: the parts of the earlier version's ShotAssist the owner
 * kept. The direction follows the player's aim, the held A/D tilt and the sideways swipe, measured
 * from straight down the table. The power follows how fast the racket is pushed forward: the ball
 * leaves at a pace read from that push, on the arc that would land a ball of RefPace mid-court, so
 * a harder push flies faster and longer and too hard a one goes past the end line, while too soft
 * a one drops short or into the net. The spin is the contact's own. The earlier version's target
 * box, landing search and rescue are gone: nothing makes a shot land. The launch is turned so the
 * ball comes down on the aimed line even as its sidespin bends it. As there, a ball met near the
 * rim keeps more of the raw contact.
 */
export class ShotAssist {
    /**
     * TUNED: the pace of a ball leaving a still racket, m/s, and what each m/s of forward push
     * adds. A 3 m/s push makes RefPace; the racket's full 6 m/s goes long.
     */
    static readonly PaceAtRest = 4.7;
    static readonly PacePerPush = 0.8;

    /**
     * TUNED: the mid-court arc clears the net by at least this much, m; a flatter one is raised,
     * still landing mid-court, since the flat arc LaunchSolver finds for a floating ball clips the tape.
     */
    private static readonly NetMargin = 0.05;

    /** A raised arc rises by at most this much more, m/s, found to within 4/2^Halvings by halving; its forward speed likewise, up to FastestAcross. */
    private static readonly MostRaise = 4;
    private static readonly FastestAcross = 25;
    private static readonly Halvings = 12;
    private static readonly AcrossHalvings = 20;

    /** TUNED: the pace, m/s, whose arc lands mid-court; a faster ball on the same arc carries further. */
    static readonly RefPace = 7.1;

    /** Mid-court: where a RefPace ball lands, as a fraction of the computer's half from the net. */
    private static readonly RefDepthFrac = 0.62;

    /**
     * TUNED: degrees of heading for a fully held A or D. From the middle of the table a ball aimed
     * this far comes down near the sideline, so from either side a full tilt that way goes out.
     */
    static readonly KeyAim = 20;

    /** TUNED: degrees of heading per m/s of the racket's sideways motion; the racket's top speed swipes 18 degrees. */
    static readonly SwipeAim = 3.0;

    /** TUNED (earlier version): the most sidespin a swipe puts on the ball, rev/s. */
    static readonly MaxSidespin = 50;

    /** Straight down the table toward the computer, and the player's right. */
    private static readonly Ahead = new Vec3(0, 0, -1);
    private static readonly Right = new Vec3(1, 0, 0);

    /** No aim heads further across than this, degrees. */
    static readonly MostAim = 45;

    /** TUNED (earlier version): the clean core as a fraction of blade radius, and the slope from it to the rim. */
    private static readonly QualityCore = 0.58;
    private static readonly QualityFalloff = 0.50;

    /**
     * TUNED (earlier version): from QualityPaceFrom m/s of incoming pace, over QualityPaceSpan,
     * the core shrinks by up to QualityPaceLoss, never below QualityCoreMin.
     */
    private static readonly QualityPaceFrom = 6.0;
    private static readonly QualityPaceSpan = 12.0;
    private static readonly QualityPaceLoss = 0.15;
    private static readonly QualityCoreMin = 0.26;

    /** TUNED (earlier version): the share of the aim even a rim hit keeps. */
    private static readonly AssistFloor = 0.35;

    /** TUNED (earlier version): trial flights step at 4x the game's step, well inside a centimetre of landing. */
    private static readonly TrialStep = 1.0 / 120;

    /** Turns of the launch to bring a curving ball down on the aimed line, and when it is on it, degrees. */
    private static readonly Reaims = 4;
    private static readonly OnLine = 0.2;

    private LastShot: Shot | null = null;

    /** The last shot, or null before the first. */
    Last(): Shot | null { return this.LastShot; }

    /**
     * The ball leaving the player's racket. Incoming is the ball at the start of the step it was
     * struck in, Struck the engine's contact result, Racket the racket as it struck, Moving its
     * smoothed velocity (CursorFollower.Moving), m/s, and KeyTilt the held A/D, -1 (left) to 1.
     * A ball the contact sends back toward the player's own end is left as it is.
     */
    Shoot(Incoming: BallState, Struck: BallState, Racket: RacketPose, Moving: Vec3, KeyTilt: number): BallState {
        const Velocity = Struck.Velocity;
        if (Velocity.Z >= 0) return Struck;
        const Physical = ShotAssist.Heading(Velocity);
        const Aimed = Clamp(KeyTilt * ShotAssist.KeyAim + Moving.X * ShotAssist.SwipeAim, -ShotAssist.MostAim, ShotAssist.MostAim);
        const Clean = ShotAssist.ContactQuality(Incoming, Struck.Position, Racket);
        const Steer = ShotAssist.AssistFloor + (1 - ShotAssist.AssistFloor) * Clean;
        const Wanted = Physical + (Aimed - Physical) * Steer;

        // The power: the arc that lands a RefPace ball with this spin mid-court on the wanted line,
        // its rise kept and its forward speed scaled to the push's pace, so more pace carries further.
        const Pace = ShotAssist.PaceAtRest + ShotAssist.PacePerPush * Math.max(0, -Moving.Z);
        // The spin: the contact brushed by the racket's whole sideways motion. Swing cuts the swipe to
        // a quarter so that chasing the ball cannot throw it wide; here the direction is the aim's,
        // so the swipe can spin the ball in full.
        const Brush = Swing.Read(Moving, ShotAssist.Ahead).PlusScaled(ShotAssist.Right, Moving.X * (1 - Swing.SideShare));
        const Spun = Contact.Bounce(Incoming, Racket.Normal, Brush, Surface.Racket).Spin;
        const Top = SpinVector.TopRevs(Velocity, Spun), Side = Clamp(SpinVector.SideRevs(Spun), -ShotAssist.MaxSidespin, ShotAssist.MaxSidespin);
        const At = Struck.Position;
        const Depth = -ShotAssist.RefDepthFrac * TableSpec.HalfLength;
        const Target = new Vec3(At.X + Math.tan(ToRadians(Wanted)) * (At.Z - Depth), 0, Depth);
        const Arc = ShotAssist.Arc(At, LaunchSolver.AtTarget(At, Target, ShotAssist.RefPace, Top, Side, ShotAssist.TrialStep).Velocity, Target, Top, Side);
        const Planned = new Vec3(Arc.X, 0, Arc.Z).Scale(Pace / ShotAssist.RefPace).PlusScaled(Vec3.Up, Arc.Y);
        const Powered = new BallState(At, Vec3.Lerp(Velocity, Planned, Steer),
                                      Vec3.Lerp(Struck.Spin, SpinVector.Of(Planned, Top, Side), Steer));

        // Turned onto the wanted line, then on until the landing is on it: sidespin bends the flight,
        // so a curving ball sets off to one side of the line and comes back onto it.
        let Turn = Wanted - ShotAssist.Heading(Powered.Velocity);
        let Result = ShotAssist.Turned(Powered, Turn);
        for (let Pass = 0; Pass < ShotAssist.Reaims; Pass++) {
            const Flat = LaunchSolver.Landing(Result, ShotAssist.TrialStep).Minus(Struck.Position);
            if (Flat.Z >= 0) break;
            const Miss = Wanted - ShotAssist.Heading(Flat);
            if (Math.abs(Miss) < ShotAssist.OnLine) break;
            Turn += Miss;
            Result = ShotAssist.Turned(Powered, Turn);
        }
        this.LastShot = { AimedDegrees: Wanted, PhysicalDegrees: Physical, Pace: Result.Velocity.Length(), Clean };
        return Result;
    }

    /**
     * The mid-court arc from Contact: Solved (a launch landing on Target) if it clears the net by
     * NetMargin; otherwise the least higher rise that does, along the same heading, with the
     * forward speed that still lands it as far as Target.
     */
    private static Arc(At: Vec3, Solved: Vec3, Target: Vec3, Top: number, Side: number): Vec3 {
        const Heading = new Vec3(Solved.X, 0, Solved.Z).Normalized();
        const Reach = Target.Minus(At).Dot(Heading);
        if (ShotAssist.Clears(At, Solved, Top, Side)) return Solved;
        let Low = Solved.Y, High = Solved.Y + ShotAssist.MostRaise;
        for (let Halving = 0; Halving < ShotAssist.Halvings; Halving++) {
            const Middle = (Low + High) / 2;
            if (ShotAssist.Clears(At, ShotAssist.Launch(At, Heading, Middle, Reach, Top, Side), Top, Side)) High = Middle; else Low = Middle;
        }
        return ShotAssist.Launch(At, Heading, High, Reach, Top, Side);
    }

    /** The launch along Heading rising at Rise, m/s, whose forward speed carries it Reach along Heading before it comes down. */
    private static Launch(At: Vec3, Heading: Vec3, Rise: number, Reach: number, Top: number, Side: number): Vec3 {
        let Low = 0, High = ShotAssist.FastestAcross;
        for (let Halving = 0; Halving < ShotAssist.AcrossHalvings; Halving++) {
            const Middle = (Low + High) / 2;
            const Trial = Heading.Scale(Middle).PlusScaled(Vec3.Up, Rise);
            const Carried = LaunchSolver.Landing(new BallState(At, Trial, SpinVector.Of(Trial, Top, Side)), ShotAssist.TrialStep).Minus(At).Dot(Heading);
            if (Carried < Reach) Low = Middle; else High = Middle;
        }
        return Heading.Scale((Low + High) / 2).PlusScaled(Vec3.Up, Rise);
    }

    private static Clears(At: Vec3, Launch: Vec3, Top: number, Side: number): boolean {
        return ShotAssist.HeightAtNet(new BallState(At, Launch, SpinVector.Of(Launch, Top, Side))) >= NetSpec.Height + BallSpec.Radius + ShotAssist.NetMargin;
    }

    /** How high the ball's centre is as it flies over the net's line, m; below the table if it never gets there. */
    private static HeightAtNet(Ball: BallState): number {
        for (let Flown = 0; Flown < 3.0; Flown += ShotAssist.TrialStep) {
            const Next = Flight.Step(Ball, ShotAssist.TrialStep);
            const From = Ball.Position.Z, To = Next.Position.Z;
            if (From > 0 && To <= 0)
                return Ball.Position.Y + (Next.Position.Y - Ball.Position.Y) * From / (From - To);
            if (Next.Position.Y < 0) return -1;
            Ball = Next;
        }
        return -1;
    }

    /** Degrees right of straight down the table toward the computer (-Z), of a horizontal direction. */
    static Heading(Direction: Vec3): number { return ToDegrees(Math.atan2(Direction.X, -Direction.Z)); }

    /** Ball turned about the vertical by Degrees to the right, its spin with it, so topspin stays topspin. */
    private static Turned(Ball: BallState, Degrees: number): BallState {
        const Cos = Math.cos(ToRadians(Degrees)), Sin = Math.sin(ToRadians(Degrees));
        return new BallState(Ball.Position, ShotAssist.TurnedVec(Ball.Velocity, Cos, Sin), ShotAssist.TurnedVec(Ball.Spin, Cos, Sin));
    }

    private static TurnedVec(V: Vec3, Cos: number, Sin: number): Vec3 {
        return new Vec3(V.X * Cos - V.Z * Sin, V.Y, V.X * Sin + V.Z * Cos);
    }

    /** 1 mid-blade, falling to 0 at the rim, with a clean core that shrinks as the ball arrives faster. */
    static ContactQuality(Incoming: BallState, At: Vec3, Racket: RacketPose): number {
        const Normal = Racket.Normal;
        const Offset = At.Minus(Racket.Centre);
        const OffCentre = Math.min(1, Offset.Minus(Normal.Scale(Offset.Dot(Normal))).Length() / RacketSpec.BladeRadius);
        const PaceFraction = Clamp((Incoming.Velocity.Length() - ShotAssist.QualityPaceFrom) / ShotAssist.QualityPaceSpan, 0, 1);
        const Core = Math.max(ShotAssist.QualityCoreMin, ShotAssist.QualityCore - ShotAssist.QualityPaceLoss * PaceFraction);
        const Rim = Core + ShotAssist.QualityFalloff;
        return Clamp((Rim - OffCentre) / (Rim - Core), 0, 1);
    }
}
