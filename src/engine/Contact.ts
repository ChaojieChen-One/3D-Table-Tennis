import { Vec3 } from "./math/Vec3";
import { BallState } from "./BallState";
import { BallSpec } from "./Specs";
import { Surface } from "./Surface";

/**
 * One collision of the ball with a surface, solved as a single impulse. The normal part of the
 * relative velocity reverses, scaled by the surface's restitution. Friction acts against the slip
 * of the contact point (its speed across the surface, from both travel and spin): it stops the
 * slip, so the ball leaves rolling, or on rubber springs it back past stopping, so the slip
 * reverses; if the friction limit is reached first, the ball slides throughout. This is how a
 * bounce turns spin into kick, a brushing racket turns its speed into spin, and incoming spin
 * comes back reversed off a racket. Rubber also damps spin about its own normal.
 */

/** A hollow sphere: the share of a tangential impulse that goes into stopping the slip, 1 / (1 + m r^2 / I). */
const SlipShare = 1 / (1 + BallSpec.Mass * BallSpec.Radius * BallSpec.Radius / BallSpec.Inertia);

/**
 * The ball after striking a surface whose unit Normal points toward the ball and which moves at
 * SurfaceVelocity. The same instance comes back if the two are already separating.
 */
export function Bounce(Ball: BallState, Normal: Vec3, SurfaceVelocity: Vec3, Kind: Surface): BallState {
    const Relative = Ball.Velocity.Minus(SurfaceVelocity);
    const Closing = Relative.Dot(Normal);
    if (Closing >= 0) return Ball;

    const ToContact = Normal.Scale(-BallSpec.Radius);
    const Slip = Relative.Minus(Normal.Scale(Closing)).Plus(Ball.Spin.Cross(ToContact));
    const NormalImpulse = BallSpec.Mass * (1 + Kind.Restitution) * -Closing;

    let Friction = Vec3.Zero;
    const SlipSpeed = Slip.Length();
    if (SlipSpeed > 1e-12) {
        const Grip = BallSpec.Mass * SlipSpeed * SlipShare * (1 + Kind.SpringBackAt(SlipSpeed));
        const Size = Math.min(Grip, Kind.Friction * NormalImpulse);
        Friction = Slip.Scale(-Size / SlipSpeed);
    }

    const Velocity = Ball.Velocity.PlusScaled(Normal.Scale(NormalImpulse).Plus(Friction), 1 / BallSpec.Mass);
    // The normal impulse acts through the centre, so only friction turns the ball.
    let Spin = Ball.Spin.PlusScaled(ToContact.Cross(Friction), 1 / BallSpec.Inertia);
    // Only the spin about the normal is damped: damping all of it would erase a stroke's topspin.
    const Drill = Normal.Scale(Spin.Dot(Normal));
    Spin = Spin.Minus(Drill).PlusScaled(Drill, Kind.DrillDamping);
    return new BallState(Ball.Position, Velocity, Spin);
}

export const Contact = { Bounce } as const;
