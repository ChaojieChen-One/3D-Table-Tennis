import { BallState } from "../engine/BallState";
import { Vec3 } from "../engine/math/Vec3";
import { RacketPose } from "./control/RacketPose";

/**
 * Whatever drives a racket in a Rally other than this machine's own player: the computer
 * (Opponent), or a human player's own racket relayed over the network (RemoteRacket). Rally talks
 * to any of them the same way, so it never needs to know which, nor how many there are.
 */
export interface RacketAgent {
    /** One step of Seconds: Ball is the ball as the step began, for whatever following it does. */
    Follow(Ball: BallState, Seconds: number): void;

    Pose(): RacketPose;
}

/** The other end's view: a half turn about the vertical, so (x, y, z) -> (-x, y, -z). */
export function HalfTurnVec(V: Vec3): Vec3 { return new Vec3(-V.X, V.Y, -V.Z); }

/** The other end's view of Ball, for position, velocity and spin alike. */
export function HalfTurnBall(Ball: BallState): BallState {
    return new BallState(HalfTurnVec(Ball.Position), HalfTurnVec(Ball.Velocity), HalfTurnVec(Ball.Spin));
}

/**
 * The other end's view of a racket: its centre and face turned, and its roll mirrored, as the
 * Java edition's NetMirror turned it, so the far racket's handle is drawn on its holder's side.
 */
export function HalfTurnPose(Pose: RacketPose): RacketPose {
    return new RacketPose(HalfTurnVec(Pose.Centre), HalfTurnVec(Pose.Normal), -Pose.Roll);
}

/**
 * An agent written for the far end (the computer always is) playing at the near end instead: it
 * sees the ball half turned, and its racket is half turned back. So the same computer can partner
 * the player in doubles, or play a computer-against-computer rally.
 */
export class Mirrored implements RacketAgent {
    constructor(private readonly Inner: RacketAgent) {}

    Follow(Ball: BallState, Seconds: number): void { this.Inner.Follow(HalfTurnBall(Ball), Seconds); }

    Pose(): RacketPose { return HalfTurnPose(this.Inner.Pose()); }
}
