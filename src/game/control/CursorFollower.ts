import { Clamp, ToRadians } from "../../engine/math/Numeric";
import { Vec3 } from "../../engine/math/Vec3";
import { PlayerGrip } from "./PlayerGrip";
import { RacketPose } from "./RacketPose";
import { ReachEnvelope } from "./ReachEnvelope";
import { Swing } from "./Swing";

/**
 * The player's racket: carried toward the cursor's aim, its face tilted by the held face keys, its
 * hold rolled to suit the reach, and lifted when the rally asks. It takes no ball: the cursor owns
 * where it goes across and along the table, and only the rally's lift (LiftToward) moves it up and
 * down. Advanced once per physics step, never per frame.
 */
export class CursorFollower {
    /**
     * TUNED: the racket's top speed, m/s. Slow enough that it visibly travels to the cursor rather
     * than jumping there; a real swing reaches 17.8 m/s, so hitting may want more once it exists.
     */
    static readonly TrackSpeed = 6.0;

    /** Square to the table, facing the opponent: the untouched face from the default player camera. */
    static readonly Square = new Vec3(0, 0, -1);

    /**
     * TUNED: a held face key tilts the face 45 degrees (1 against the forward 1), raised from 31
     * at the player's request so the tilt reads clearly from the camera.
     */
    static readonly FaceTilt = 1.0;

    /** TUNED: reaches a new face angle in ~1/8 s; a snapped face would read as enormous spin. */
    private static readonly FaceTau = 0.04;

    /** TUNED: the aim help turns the face faster, so its last corrections before contact still arrive. */
    private static readonly AimTau = 0.01;

    /**
     * TUNED: the fastest the hand rolls the racket, radians per second. Changing sides over the
     * table (about 110 degrees) takes about a quarter of a second, seen as a turn, not a snap.
     */
    static readonly RollSpeed = ToRadians(450);

    /**
     * TUNED: the lift's top speed, m/s. Faster than a fed ball rises after its bounce (about
     * 2.5 m/s), so the racket keeps pace with it; the lift is part of the swing the ball meets.
     */
    static readonly LiftSpeed = 4.0;

    private TargetAt: Vec3;
    private Centre: Vec3;
    private Normal: Vec3 = CursorFollower.Square;
    private LiftTo: number = ReachEnvelope.HitY;

    /** The racket's velocity, smoothed over Swing.Smoothing, m/s. */
    private MovingNow: Vec3 = Vec3.Zero;

    /** The aim help's face and how far the untouched face turns to it; null when it is not helping. */
    private Aimed: Vec3 | null = null;
    private AimStrength = 0;
    private UpTilt = 0;
    private RightTiltNow = 0;
    private Roll: number;

    /** Where the player stands and the way they face (horizontal, unit); until told, on the centre line facing the opponent. */
    private Body: Vec3 = Vec3.Zero;
    private Facing: Vec3 = CursorFollower.Square;

    constructor(RestingAt: Vec3) {
        this.TargetAt = this.Centre = ReachEnvelope.Clamp(RestingAt);
        this.Roll = PlayerGrip.Lean(this.Centre, this.Body, this.Facing);
    }

    /**
     * Footwork is the camera: the player stands at BodyAt looking along Looking. The untouched face
     * points the way they look, and the hold leans from their line. Only Looking's horizontal part
     * counts; a look straight down keeps the last facing.
     */
    SetStance(BodyAt: Vec3 | null, Looking: Vec3 | null): void {
        if (BodyAt == null || Looking == null || !BodyAt.IsFinite() || !Looking.IsFinite()) return;
        const Level = new Vec3(Looking.X, 0, Looking.Z).Normalized();
        if (Level.IsZero()) return;
        this.Body = BodyAt;
        this.Facing = Level;
    }

    /** Where the cursor points; held to the reach envelope here, so no caller can forget to. */
    AimAt(Point: Vec3 | null): void {
        this.TargetAt = ReachEnvelope.Clamp(Point);
    }

    /**
     * The height the racket rises toward, held between its resting HitY and HighestLift, so the
     * lift only ever adds reach. HitY (or anything below it) lets the racket settle back to rest.
     */
    LiftToward(Height: number): void {
        this.LiftTo = Number.isFinite(Height) ? Clamp(Height, ReachEnvelope.HitY, ReachEnvelope.HighestLift) : ReachEnvelope.HitY;
    }

    /**
     * The face keys, each axis in [-1, 1]: Up +1 turns the face up (open), -1 down (closed); Right
     * +1 turns it toward the player's right, -1 left, both relative to the way the player faces.
     * Held, not accumulated.
     */
    SetFaceTilt(Up: number, Right: number): void {
        this.UpTilt = Clamp(Up, -1, 1);
        this.RightTiltNow = Clamp(Right, -1, 1);
    }

    /**
     * Carry the racket across toward the aim at TrackSpeed and up or down toward the lift at
     * LiftSpeed, ease the face toward the held tilt, and roll the hold toward the one that suits
     * where the racket now is, at no more than RollSpeed.
     */
    Advance(Seconds: number): void {
        const Across = new Vec3(this.Centre.X, this.TargetAt.Y, this.Centre.Z).MovedToward(this.TargetAt, CursorFollower.TrackSpeed * Seconds);
        const Height = this.Centre.Y + Clamp(this.LiftTo - this.Centre.Y, -CursorFollower.LiftSpeed * Seconds, CursorFollower.LiftSpeed * Seconds);
        const Was = this.Centre;
        this.Centre = new Vec3(Across.X, Height, Across.Z);
        if (Seconds > 0) this.MovingNow = Vec3.Lerp(this.MovingNow, this.Centre.Minus(Was).Scale(1 / Seconds), 1 - Math.exp(-Seconds / Swing.Smoothing));
        const Right = this.Facing.Cross(Vec3.Up).Normalized();
        const Base = this.Aimed === null ? this.Facing : Vec3.Lerp(this.Facing, this.Aimed, this.AimStrength).Normalized();
        const Desired = Base.PlusScaled(Right, this.RightTiltNow * CursorFollower.FaceTilt)
                            .PlusScaled(Vec3.Up, this.UpTilt * CursorFollower.FaceTilt).Normalized();
        const Easing = 1 - Math.exp(-Seconds / (this.Aimed === null ? CursorFollower.FaceTau : CursorFollower.AimTau));
        this.Normal = Vec3.Lerp(this.Normal, Desired, Easing).Normalized();
        const Turn = PlayerGrip.Lean(this.Centre, this.Body, this.Facing) - this.Roll;
        this.Roll += Clamp(Turn, -CursorFollower.RollSpeed * Seconds, CursorFollower.RollSpeed * Seconds);
    }

    Pose(): RacketPose { return new RacketPose(this.Centre, this.Normal, this.Roll); }

    /**
     * The aim help's face: the untouched face turns toward Normal by Strength (0 to 1), and the
     * face keys still tilt it from there. A null Normal, or no strength, gives the face back.
     */
    AimFace(Normal: Vec3 | null, Strength: number): void {
        const Off = Normal === null || !Normal.IsFinite() || !(Strength > 0);
        this.Aimed = Off ? null : Normal.Normalized();
        this.AimStrength = Off ? 0 : Clamp(Strength, 0, 1);
    }

    /** Where the cursor has the racket heading, on the hitting plane. */
    Target(): Vec3 { return this.TargetAt; }

    /** The held A/D, -1 (left) to 1 (right): where the player is aiming, for ShotAssist. */
    RightTilt(): number { return this.RightTiltNow; }

    /** The racket's velocity as smoothed for its swing, m/s, unread. */
    Moving(): Vec3 { return this.MovingNow; }

    /** The velocity a ball meets on this racket: its smoothed motion, read as a stroke by Swing. */
    SwingVelocity(): Vec3 { return Swing.Read(this.MovingNow, this.Facing); }
}
