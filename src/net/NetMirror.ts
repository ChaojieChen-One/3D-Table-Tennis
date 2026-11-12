import { BallState } from "../engine/BallState";
import { Vec3 } from "../engine/math/Vec3";
import { RacketPose } from "../game/control/RacketPose";
import { HalfTurnBall, HalfTurnPose, HalfTurnVec } from "../game/RacketAgent";

/**
 * Mirrors x and z, in this one place on the wire: so each player sees themselves at +Z. A sender
 * always sends its own local frame exactly as it is; the receiver flips it before applying it to
 * its own rally, where the sender plays the far end. This is a half turn about the vertical, not a
 * reflection, so position, velocity and spin (an axial vector) all flip the same way,
 * (x, y, z) -> (-x, y, -z). The game's own half turn (RacketAgent) is the same one.
 */
export const NetMirror = {
    Vec: (V: Vec3): Vec3 => HalfTurnVec(V),
    Ball: (Ball: BallState): BallState => HalfTurnBall(Ball),
    Pose: (Pose: RacketPose): RacketPose => HalfTurnPose(Pose),
} as const;
