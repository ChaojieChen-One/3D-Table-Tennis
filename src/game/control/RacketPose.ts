import { Vec3 } from "../../engine/math/Vec3";

/**
 * Where a racket is, which way its hitting face points (a unit normal), and its roll about that
 * normal: the handle's angle from straight down toward the holder's right, radians. A round blade
 * hits the same at any roll, so Roll is only how it is held.
 */
export class RacketPose {
    constructor(readonly Centre: Vec3, readonly Normal: Vec3, readonly Roll: number) {}

    /** Partway from one pose to the next, for drawing between physics steps. */
    static Between(From: RacketPose, To: RacketPose, Fraction: number): RacketPose {
        return new RacketPose(Vec3.Lerp(From.Centre, To.Centre, Fraction),
                              Vec3.Lerp(From.Normal, To.Normal, Fraction).Normalized(),
                              From.Roll + (To.Roll - From.Roll) * Fraction);
    }
}
