import { BallState } from "../engine/BallState";
import { Collisions } from "../engine/Collisions";
import { Flight } from "../engine/Flight";
import { BallSpec, RacketSpec, TableSpec } from "../engine/Specs";
import { Clamp, ToRadians } from "../engine/math/Numeric";
import { Vec3 } from "../engine/math/Vec3";
import { Aiming } from "./Aiming";
import { RacketPose } from "./control/RacketPose";
import { RacketAgent } from "./RacketAgent";

/**
 * The computer's racket. It stands behind its own end of the table (the far end, z < 0; wrap it in
 * Mirrored to play the near end) and, after a reaction time, moves at a capped speed to where it
 * foresees meeting the ball; when the ball arrives it swings forward through it: a real swing, so
 * the contact solver sees a moving racket. A ball placed wide enough or fast enough beats it. As
 * the ball comes it aims, as a player does: it foresees where the ball will meet its racket and
 * tries face angles through the engine's own contact and flight (Aiming) until one lands the
 * return on its target. So it answers spin by its effect, whatever the spin, and the stroke is
 * then played for real: nothing about the ball is set by hand.
 */
export class Opponent implements RacketAgent {
    /** Where it stands: a quarter of a metre behind its end line. */
    static readonly StandZ = -(TableSpec.HalfLength + 0.25);

    /** TUNED: the forward speed of its usual swing, m/s; a sweep over player shots found faster swings sent more long. */
    static readonly SwingSpeed = 2.0;

    /** TUNED: the swings it tries in turn, m/s: firmer only when the usual one cannot get a low or dead ball back. */
    private static readonly SwingSpeeds = [Opponent.SwingSpeed, 3.0, 4.5];

    /** Its grip, as it has always looked: the handle 45 degrees to its right. */
    static readonly Roll = ToRadians(45);

    /** It strikes toward the player. */
    private static readonly Toward = new Vec3(0, 0, 1);

    /** TUNED: where its returns land, in turn: left, right and middle of the player's half, at mid depth. */
    private static readonly Targets = [new Vec3(-0.35, 0, 0.85), new Vec3(0.35, 0, 0.85), new Vec3(0, 0, 0.85)];

    /** It aims when the ball is this close in front of it, m: soon enough to foresee a bounce on its side still to come. */
    private static readonly AimFrom = 0.8;

    /** Its face before it has aimed: toward the player, a little open. */
    private static readonly Ready = Aiming.Face(ToRadians(35), 0, Opponent.Toward);

    /** It starts the swing when the ball is this close in front of it. */
    private static readonly SwingFrom = 0.30;

    /** The swing reaches no further forward than this. */
    private static readonly SwingReach = 0.40;

    /** How fast it steps back to its stand afterwards, m/s. */
    private static readonly Recover = 1.5;

    /**
     * TUNED: how far in from its stand it steps to meet a short ball, m, and how fast, m/s. The
     * earlier version's opponent reached 0.55 m forward; this one reaches a little over the end
     * line too, since the player's planned shots land as short as a fifth of the half.
     */
    private static readonly StepInReach = 0.70;
    private static readonly StepIn = 3.0;

    /** It follows the ball only this far: out to the side, down toward the floor and up. */
    private static readonly MaxX = 2.5;
    private static readonly LowestY = -0.6;
    private static readonly HighestY = 1.6;

    /** The longest it looks ahead for the ball to reach it, s. */
    private static readonly LongestLook = 1.5;

    /** TUNED: how long after a ball turns toward it before it starts to move, s. */
    static readonly ReactionTime = 0.25;

    /** TUNED: the fastest its racket moves across and up or down, m/s. */
    static readonly MoveSpeed = 2.0;

    /** It looks again at where it will meet the ball every this many steps, as its read of the ball sharpens. */
    private static readonly LookEvery = 24;

    /** Where it holds its racket, across and up, while the ball is going away. */
    private static readonly ReadyX = 0;
    private static readonly ReadyY = 0.2;

    private Centre = new Vec3(0, 0.2, Opponent.StandZ);
    private Face = Opponent.Ready;
    private Swing = Opponent.SwingSpeed;
    private Aimed = false;
    private Placed = false;
    private NextTarget = 0;

    /** How long the ball has been coming toward it, s; and steps until it looks again. */
    private Coming = 0;
    private SinceLook = Opponent.LookEvery;

    /** Where it is moving its racket to, across (x) and up (y). */
    private ToX = Opponent.ReadyX;
    private ToY = Opponent.ReadyY;

    /** Where it waits for this ball: its stand, or stepped in to meet a short one. */
    private Home = Opponent.StandZ;

    /**
     * Moves for one step of Seconds: x and y toward where it will meet the ball, at MoveSpeed and
     * only after ReactionTime; z by its footwork and its swing. Picks where to meet each ball
     * coming its way, and aims once at it.
     */
    Follow(Ball: BallState, Seconds: number): void {
        const At = Ball.Position;
        let Z = this.Centre.Z;
        const Incoming = Ball.Velocity.Z < 0;
        if (!Incoming) {
            this.Aimed = this.Placed = false;
            this.Home = Opponent.StandZ;
            this.Coming = 0;
            this.SinceLook = Opponent.LookEvery;
            this.ToX = Opponent.ReadyX;
            this.ToY = Opponent.ReadyY;
        } else {
            this.Coming += Seconds;
            if (this.Coming >= Opponent.ReactionTime && ++this.SinceLook >= Opponent.LookEvery) {
                this.SinceLook = 0;
                const Meets = Opponent.Meeting(Ball, Z, this.Home, this.Swing, Seconds);
                if (Meets !== null) {
                    this.ToX = Clamp(Meets.Position.X, -Opponent.MaxX, Opponent.MaxX);
                    this.ToY = Clamp(Meets.Position.Y, Opponent.LowestY, Opponent.HighestY);
                }
            }
            if (!this.Placed) {
                this.Home = Opponent.HomeFor(Ball, Seconds);
                this.Placed = true;
            }
            if (!this.Aimed && At.Z > Z && At.Z - Z < Opponent.AimFrom) {
                this.Face = this.Aim(Ball, Z, this.Home, Opponent.Targets[this.NextTarget++ % Opponent.Targets.length], Seconds);
                this.Aimed = true;
            }
        }
        const Arriving = Incoming && At.Z > Z && At.Z - Z < Opponent.SwingFrom;
        if (Arriving) Z = Math.min(Z + this.Swing * Seconds, this.Home + Opponent.SwingReach);
        else Z = Opponent.Footwork(Z, this.Home, Seconds);
        const Across = new Vec3(this.Centre.X, this.Centre.Y, 0).MovedToward(new Vec3(this.ToX, this.ToY, 0), Opponent.MoveSpeed * Seconds);
        this.Centre = new Vec3(Across.X, Across.Y, Z);
    }

    /** One step from Z toward Home: in at StepIn, back at Recover. */
    private static Footwork(Z: number, Home: number, Seconds: number): number {
        return Home > Z ? Math.min(Z + Opponent.StepIn * Seconds, Home) : Math.max(Z - Opponent.Recover * Seconds, Home);
    }

    /**
     * Where to wait for Ball: where it stands highest after its bounce on this side, so a short
     * ball is met before it can bounce again; never behind the stand, nor in front of StepInReach.
     */
    private static HomeFor(Ball: BallState, Seconds: number): number {
        let Bounced = false;
        let PeakY = Number.NEGATIVE_INFINITY, PeakZ = Opponent.StandZ;
        for (let Looked = 0; Looked < Opponent.LongestLook; Looked += Seconds) {
            const Next = Collisions.Resolve(Ball, Flight.Step(Ball, Seconds), Seconds, []);
            Ball = Next.Ball;
            if (Next.Floor || Ball.Position.Z < Opponent.StandZ) break;
            if (Next.Table) {
                if (Bounced || Ball.Position.Z > 0) break;
                Bounced = true;
            }
            if (Bounced && Ball.Position.Y > PeakY) {
                PeakY = Ball.Position.Y;
                PeakZ = Ball.Position.Z;
            }
        }
        return Clamp(PeakZ, Opponent.StandZ, Opponent.StandZ + Opponent.StepInReach);
    }

    Pose(): RacketPose { return new RacketPose(this.Centre, this.Face, Opponent.Roll); }

    /**
     * The face that sends Ball, as it will be when it meets the racket now at RacketZ, to land on
     * Target, with the gentlest of its swings that gets it there. The racket meets the ball where it
     * has moved to, swinging only forward at the swing's speed.
     */
    private Aim(Ball: BallState, RacketZ: number, Home: number, Target: Vec3, Seconds: number): Vec3 {
        let Fallback: Vec3 | null = null;
        for (const Speed of Opponent.SwingSpeeds) {
            const Meeting = Opponent.Meeting(Ball, RacketZ, Home, Speed, Seconds);
            if (Meeting === null) continue;
            const Swing = new Vec3(0, 0, Speed);
            const Chosen = Aiming.FaceToward(Meeting, Swing, Target, Opponent.Toward, Seconds);
            if (Fallback === null) {
                Fallback = Chosen;
                this.Swing = Speed;
            }
            if (Aiming.Returns(Meeting, Chosen, Swing, Opponent.Toward, Seconds)) {
                this.Swing = Speed;
                return Chosen;
            }
        }
        return Fallback === null ? this.Face : Fallback;
    }

    /**
     * The ball as it reaches the face of a racket now at RacketZ that steps toward Home, then
     * swings at Speed, as Follow moves it; null if it never does.
     */
    private static Meeting(Ball: BallState, RacketZ: number, Home: number, Speed: number, Seconds: number): BallState | null {
        const Reach = BallSpec.Radius + RacketSpec.BladeThickness / 2;
        for (let Looked = 0; Looked < Opponent.LongestLook; Looked += Seconds) {
            const Gap = Ball.Position.Z - RacketZ;
            if (Gap <= Reach) return Ball;
            if (Ball.Velocity.Z >= 0) return null;
            RacketZ = Gap < Opponent.SwingFrom ? Math.min(RacketZ + Speed * Seconds, Home + Opponent.SwingReach) : Opponent.Footwork(RacketZ, Home, Seconds);
            Ball = Collisions.Resolve(Ball, Flight.Step(Ball, Seconds), Seconds, []).Ball;
        }
        return null;
    }
}
