import { Vec3 } from "./math/Vec3";

/** The ball: where it is (m), how fast it moves (m/s), and how it spins (angular velocity, rad/s, right-handed). */
export class BallState {
    constructor(readonly Position: Vec3, readonly Velocity: Vec3, readonly Spin: Vec3) {}

    /** Partway from one state to the next, for drawing between physics steps. */
    static Between(From: BallState, To: BallState, Fraction: number): BallState {
        return new BallState(Vec3.Lerp(From.Position, To.Position, Fraction),
                             Vec3.Lerp(From.Velocity, To.Velocity, Fraction),
                             Vec3.Lerp(From.Spin, To.Spin, Fraction));
    }

    At(NewPosition: Vec3): BallState { return new BallState(NewPosition, this.Velocity, this.Spin); }
}
