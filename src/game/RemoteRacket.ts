import { BallState } from "../engine/BallState";
import { Clamp, ToRadians } from "../engine/math/Numeric";
import { Vec3 } from "../engine/math/Vec3";
import { RacketPose } from "./control/RacketPose";
import { RacketAgent } from "./RacketAgent";

/**
 * A racket in networked play driven by pose messages from another machine instead of by AI. It
 * never touches the ball itself; the engine's own Collisions never sees it (Rally leaves it out of
 * the swept rackets), because the other machine is the one that decides its own hits (hitter
 * authority) and sends the result as a Hit message, applied through Rally.ApplyRemoteHit. Receive
 * only moves where it is heading; it still eases toward that target at a capped speed, so a late
 * or jittery packet does not make it jump.
 */
export class RemoteRacket implements RacketAgent {
    /** TUNED: capped so a lost or late packet still arrives as a carry, not a jump; well above any real swing's travel per step. */
    private static readonly CatchUpSpeed = 12.0;

    private static readonly RollSpeed = ToRadians(720);

    private Centre: Vec3;
    private TargetCentre: Vec3;
    private Normal: Vec3 = new Vec3(0, 0, 1);
    private TargetNormal: Vec3 = this.Normal;
    private Roll = 0;
    private TargetRoll = 0;

    constructor(RestingAt: Vec3) { this.Centre = this.TargetCentre = RestingAt; }

    /** The other machine's own racket, in this machine's frame (already mirrored by the caller). */
    Receive(Pose: RacketPose): void {
        this.TargetCentre = Pose.Centre;
        this.TargetNormal = Pose.Normal;
        this.TargetRoll = Pose.Roll;
    }

    Follow(_Ball: BallState, Seconds: number): void {
        this.Centre = this.Centre.MovedToward(this.TargetCentre, RemoteRacket.CatchUpSpeed * Seconds);
        this.Normal = Vec3.Lerp(this.Normal, this.TargetNormal, Math.min(1, RemoteRacket.CatchUpSpeed * Seconds)).Normalized();
        this.Roll += Clamp(this.TargetRoll - this.Roll, -RemoteRacket.RollSpeed * Seconds, RemoteRacket.RollSpeed * Seconds);
    }

    Pose(): RacketPose { return new RacketPose(this.Centre, this.Normal, this.Roll); }
}
