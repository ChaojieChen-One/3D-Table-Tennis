import * as THREE from "three";
import { CursorFollower } from "../../game/control/CursorFollower";
import { ReachEnvelope } from "../../game/control/ReachEnvelope";
import { CameraRig } from "../camera/CameraRig";
import { OnPlane } from "./CursorRay";
import { FaceKeys } from "./FaceKeys";

/**
 * The mouse and the face keys drive the player's racket. The cursor aims on the hitting plane; a
 * left-button drag belongs to the camera instead. Only a cursor that moved re-aims, so orbiting or
 * zooming under a still mouse leaves the racket where it is.
 */
export class RacketControl {
    private readonly Keys = new FaceKeys();

    constructor(private readonly Hand: CursorFollower, private readonly Camera: THREE.PerspectiveCamera) {}

    Attach(Surface: HTMLElement): void {
        Surface.addEventListener("pointermove", Event => {
            if (CameraRig.IsOrbiting(Event)) return;
            const Box = Surface.getBoundingClientRect();
            if (Box.width <= 0 || Box.height <= 0) return;
            const X = ((Event.clientX - Box.left) / Box.width) * 2 - 1;
            const Y = -(((Event.clientY - Box.top) / Box.height) * 2 - 1);
            // The fallback is only for a degenerate ray; it keeps the racket where it is.
            this.Hand.AimAt(OnPlane(this.Camera, X, Y, ReachEnvelope.HitY, this.Hand.Pose().Centre));
        });
    }

    /** True if the key was a face key, which the caller should then leave alone. */
    KeyPressed(Code: string): boolean {
        const Mine = this.Keys.Press(Code);
        if (Mine) this.Tilt();
        return Mine;
    }

    KeyReleased(Code: string): boolean {
        const Mine = this.Keys.Release(Code);
        if (Mine) this.Tilt();
        return Mine;
    }

    ReleaseAll(): void {
        this.Keys.ReleaseAll();
        this.Tilt();
    }

    private Tilt(): void { this.Hand.SetFaceTilt(this.Keys.Up(), this.Keys.Right()); }
}
