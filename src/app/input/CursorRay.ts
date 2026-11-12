import * as THREE from "three";
import { Vec3 } from "../../engine/math/Vec3";

/**
 * Where the cursor's ray meets a HORIZONTAL plane at a given height. Geometry only: no clamping
 * (the reach envelope owns that) and no ball. Because the height is a parameter, cursor X maps to
 * world X and cursor Y to world Z, each monotonically, from any camera angle.
 */

/**
 * TUNED: how far a ray that never meets the plane is walked out, metres. Keeps the mapping
 * continuous past the horizon; 30 m made lateral aim near-binary there, 6 m still out-runs ZFar.
 */
const Horizon = 6.0;

/**
 * The point at exactly PlaneY under the cursor, X and Z unclamped, or Fallback if the ray
 * degenerates. Cursor is in normalised device coordinates (-1 to 1, +y up). Independent of the
 * racket's position, which would be a loop with gain.
 */
export function OnPlane(Camera: THREE.PerspectiveCamera, CursorX: number, CursorY: number, PlaneY: number, Fallback: Vec3): Vec3 {
    const Through = new THREE.Vector3(CursorX, CursorY, 0.5).unproject(Camera);
    const From = Camera.position;
    const Eye = new Vec3(From.x, From.y, From.z);
    const Direction = new Vec3(Through.x - From.x, Through.y - From.y, Through.z - From.z);
    if (!Eye.IsFinite() || !Direction.IsFinite()) return Fallback;

    const Along = DistanceAlongRay(Eye, Direction, PlaneY);
    if (Number.isNaN(Along)) return Fallback;
    const Hit = Eye.PlusScaled(Direction, Along);
    if (!Hit.IsFinite()) return Fallback;
    return new Vec3(Hit.X, PlaneY, Hit.Z);   // height from the plane, never from the ray
}

/**
 * Where a descending ray meets the plane, capped at the horizon; a level or rising ray, or a
 * plane above the eye, walks out to the horizon so the racket never freezes. NaN if vertical.
 */
export function DistanceAlongRay(Eye: Vec3, Direction: Vec3, PlaneY: number): number {
    const Horizontal = Math.hypot(Direction.X, Direction.Z);
    const HasHeading = Horizontal > 1e-9;
    if (Direction.Y < -1e-9) {
        const Along = (PlaneY - Eye.Y) / Direction.Y;
        if (Along <= 0) return HasHeading ? Horizon / Horizontal : Number.NaN;
        return HasHeading ? Math.min(Along, Horizon / Horizontal) : Along;
    }
    return HasHeading ? Horizon / Horizontal : Number.NaN;
}
