import * as THREE from "three";
import { TableSpec } from "../../engine/Specs";
import { Clamp, ToDegrees, ToRadians } from "../../engine/math/Numeric";
import { Vec3 } from "../../engine/math/Vec3";
import { ReachEnvelope } from "../../game/control/ReachEnvelope";

/** The named views, as the 1 to 8 keys and the buttons pick them. */
export const ViewNames = ["player", "courtside", "overhead", "reverse", "left", "right", "hall", "racket"] as const;
export type ViewName = typeof ViewNames[number];

/**
 * An orbiting camera about a pivot. It starts behind the near end; left drag orbits and scroll
 * zooms. From the player's view it follows the rally, as the earlier version's rally-cam did. It
 * never chases the ball. Instead it cuts between two poses by which way the ball is going: wide
 * while the ball comes toward the player, so it can be read early, and closer and lower once it
 * heads away. It also pans a little to keep the ball and the far half in line. Any manual camera
 * input, or another view, leaves the follow; the player view (Reset) and F bring it back.
 *
 * Yaw is in degrees, positive swinging the camera round to the player's left (the Java edition's
 * sign, kept so its views carry over); pitch raises it.
 */
export class CameraRig {
    /** Behind the player: yaw and pitch in degrees, distance and pivot height in metres. */
    private static readonly StartYaw = 0;
    private static readonly StartPitch = 20;
    private static readonly StartDistance = 4.5;
    private static readonly StartHeight = -0.24;

    /**
     * TUNED: the follow's pose while the ball heads away, pitch in degrees and distance in metres:
     * closer and lower than the player view, as the earlier rally-cam closed in after the player's
     * shot. Not so close that the near part of the racket's reach leaves the screen, since the
     * cursor aims through this camera.
     */
    private static readonly AwayPitch = 15;
    private static readonly AwayDistance = 4.0;

    /** (Earlier version) the cut's time constant, s: it reads as a cut, not a drift, without snapping the table sideways. */
    private static readonly CutTau = 0.12;

    /** (Earlier version) the pan's time constant, s, slower than the cut. */
    private static readonly PanTau = 0.35;

    /** TUNED: the widest pan, degrees. This camera is the player's stance, so a pan turns their racket's face as far. */
    private static readonly MostPan = 12;

    /** The pan keeps the camera, the ball and the middle of the far half in line; it never moves toward the ball. */
    private static readonly FarHalfZ = -TableSpec.Length / 4;

    /** The line is measured over at least this much of the table's length, m, so a ball near the far half pans gently. */
    private static readonly ShortestLine = 1.0;

    /** Slower along the table than this, m/s, the ball's direction is left as it was read. */
    private static readonly Drifting = 0.3;

    private static readonly MinPitch = -12;
    private static readonly MaxPitch = 89;
    private static readonly MinDistance = 0.75;
    private static readonly MaxDistance = 12.0;
    private static readonly OrbitDegreesPerPixel = 0.3;
    private static readonly ZoomIn = 0.92;
    private static readonly ZoomOut = 1.087;

    /** The Java edition's lens: 35 degrees vertically, clipped from 5 cm to 33 m. */
    readonly Camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.05, 40);

    private Pivot = new Vec3(0, CameraRig.StartHeight, 0);
    private Yaw = CameraRig.StartYaw;
    private Pitch = CameraRig.StartPitch;
    private Distance = CameraRig.StartDistance;

    /** Following the rally; and whether the ball was last read as coming toward the player. */
    private Following = true;
    private Coming = true;

    constructor() { this.Pose(); }

    /** Where the camera is. Footwork is the camera: this is where the player stands. */
    Eye(): Vec3 { const P = this.Camera.position; return new Vec3(P.x, P.y, P.z); }

    /** The way the camera looks. */
    Looking(): Vec3 { return this.Pivot.Minus(this.Eye()).Normalized(); }

    /** The player view, following the rally. */
    Reset(): void {
        this.SetView(CameraRig.StartYaw, CameraRig.StartPitch, CameraRig.StartDistance);
        this.Following = true;
    }

    IsFollowing(): boolean { return this.Following; }

    SetFollowing(On: boolean): void { this.Following = On; }

    /** F: the follow on or off; turned on, it takes over from wherever the camera is. */
    ToggleFollow(): void {
        if (this.Following) this.Following = false;
        else this.Reset();
    }

    /**
     * Once per frame, on real time (a view, not physics): while following, ease toward the pose for
     * the way the ball is going, and pan toward it.
     */
    Follow(RealSeconds: number, Ball: Vec3, BallVelocity: Vec3): void {
        if (!this.Following || !Ball.IsFinite() || !BallVelocity.IsFinite()) return;
        const Seconds = Math.max(1e-3, RealSeconds);
        if (Math.abs(BallVelocity.Z) > CameraRig.Drifting) this.Coming = BallVelocity.Z > 0;
        const Cut = 1 - Math.exp(-Seconds / CameraRig.CutTau), Pan = 1 - Math.exp(-Seconds / CameraRig.PanTau);
        this.Pitch += ((this.Coming ? CameraRig.StartPitch : CameraRig.AwayPitch) - this.Pitch) * Cut;
        this.Distance += ((this.Coming ? CameraRig.StartDistance : CameraRig.AwayDistance) - this.Distance) * Cut;
        this.Yaw += (CameraRig.PanYaw(Ball) - this.Yaw) * Pan;
        this.Pose();
    }

    /** The yaw that lines the camera up with the ball and the middle of the far half: toward the ball's side. */
    private static PanYaw(Ball: Vec3): number {
        return Clamp(-ToDegrees(Math.atan2(Ball.X, Math.max(Ball.Z - CameraRig.FarHalfZ, CameraRig.ShortestLine))), -CameraRig.MostPan, CameraRig.MostPan);
    }

    /** Shared by keyboard, buttons and the URL, so every view is reproducible. */
    View(Name: string): void {
        this.Following = false;
        switch (Name) {
            case "courtside": this.SetView(-29, 22, 5.2); break;
            case "overhead": this.SetView(0, 72, 6.4); break;
            case "reverse": this.SetView(180, 8, 8.5); break;
            case "left": this.SetView(90, 8, 7.8); break;
            case "right": this.SetView(-90, 8, 7.8); break;
            case "hall": this.SetView(-23, 6, 10.5); break;
            case "racket":
                // At the player's racket where it rests, before the mouse moves it.
                this.SetView(12, 5, 0.62);
                this.Pivot = new Vec3(ReachEnvelope.Neutral.X, ReachEnvelope.Neutral.Y - 0.05, ReachEnvelope.Neutral.Z);
                this.Pose();
                break;
            default: this.Reset();
        }
    }

    SetView(NewYaw: number, NewPitch: number, NewDistance: number): void {
        this.Pivot = new Vec3(0, CameraRig.StartHeight, 0);
        this.Yaw = NewYaw;
        this.Pitch = Clamp(NewPitch, CameraRig.MinPitch, CameraRig.MaxPitch);
        this.Distance = Clamp(NewDistance, CameraRig.MinDistance, CameraRig.MaxDistance);
        this.Pose();
    }

    /** Left drag orbits, the wheel zooms; either leaves the follow. */
    Attach(Surface: HTMLElement): void {
        let Dragging = false, LastX = 0, LastY = 0;
        Surface.addEventListener("pointerdown", Event => {
            if (Event.button !== 0) return;
            Dragging = true;
            LastX = Event.clientX;
            LastY = Event.clientY;
            Surface.setPointerCapture(Event.pointerId);
        });
        Surface.addEventListener("pointermove", Event => {
            if (!Dragging) return;
            const Dx = Event.clientX - LastX, Dy = Event.clientY - LastY;
            LastX = Event.clientX;
            LastY = Event.clientY;
            this.Following = false;
            this.Yaw -= Dx * CameraRig.OrbitDegreesPerPixel;
            this.Pitch = Clamp(this.Pitch + Dy * CameraRig.OrbitDegreesPerPixel, CameraRig.MinPitch, CameraRig.MaxPitch);
            this.Pose();
        });
        const Stop = () => { Dragging = false; };
        Surface.addEventListener("pointerup", Stop);
        Surface.addEventListener("pointercancel", Stop);
        Surface.addEventListener("wheel", Event => {
            Event.preventDefault();
            this.Following = false;
            this.Distance = Clamp(this.Distance * (Event.deltaY < 0 ? CameraRig.ZoomIn : CameraRig.ZoomOut), CameraRig.MinDistance, CameraRig.MaxDistance);
            this.Pose();
        }, { passive: false });
    }

    /** Whether a left drag is under way: the racket leaves the cursor alone while the camera has it. */
    static IsOrbiting(Event: PointerEvent): boolean { return (Event.buttons & 1) !== 0; }

    private Pose(): void {
        const Turn = ToRadians(-this.Yaw), Rise = ToRadians(this.Pitch);
        const P = this.Pivot;
        this.Camera.position.set(P.X + this.Distance * Math.cos(Rise) * Math.sin(Turn),
                                 P.Y + this.Distance * Math.sin(Rise),
                                 P.Z + this.Distance * Math.cos(Rise) * Math.cos(Turn));
        this.Camera.up.set(0, 1, 0);
        this.Camera.lookAt(P.X, P.Y, P.Z);
        this.Camera.updateMatrixWorld();
    }
}
