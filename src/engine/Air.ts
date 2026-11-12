import { Vec3 } from "./math/Vec3";
import { BallSpec } from "./Specs";

/** What acts on the ball in flight: gravity, air drag, and the Magnus lift of a spinning ball. */
export const Gravity = new Vec3(0, -9.81, 0);

/** kg/m3: air at sea level and about 20 C. */
export const Density = 1.20;

/** A smooth sphere at the ball's Reynolds numbers (about 10^4 to 5x10^4) sits near 0.4 to 0.5. TUNED within that. */
export const DragCoefficient = 0.5;

/**
 * The lift coefficient follows the spin parameter r*w/v (the simplest model that grows with
 * spin and falls with speed) up to this ceiling. A simple model, TUNED later against play.
 */
export const MaxLiftCoefficient = 0.5;

/**
 * Spin lost per metre of flight: dw/dt = -k w |v|, so it falls with distance flown (James and
 * Haake, Engineering of Sport 7, 2008). As the earlier version of the game had it, TUNED: 1/240
 * gives the measured 5% a second at a typical 12 m/s rally speed.
 */
export const SpinDecayPerMetre = 1.0 / 240.0;

const HalfRhoA = 0.5 * Density * BallSpec.CrossSection;

/** The ball's acceleration at Velocity with Spin. Spin's own slow decay is Flight's, by SpinDecayPerMetre. */
export function Acceleration(Velocity: Vec3, Spin: Vec3): Vec3 {
    const Speed = Velocity.Length();
    const Drag = Velocity.Scale(-HalfRhoA * DragCoefficient * Speed);
    // Lift = 1/2 rho A v^2 C_L along (w x v), with C_L = r w / v: that is 1/2 rho A r (w x v).
    let Lift = Spin.Cross(Velocity).Scale(HalfRhoA * BallSpec.Radius);
    const Ceiling = HalfRhoA * MaxLiftCoefficient * Speed * Speed;
    const LiftSize = Lift.Length();
    if (LiftSize > Ceiling) Lift = Lift.Scale(Ceiling / LiftSize);
    return Gravity.Plus(Drag.Plus(Lift).Scale(1 / BallSpec.Mass));
}

export const Air = { Gravity, Density, DragCoefficient, MaxLiftCoefficient, SpinDecayPerMetre, Acceleration } as const;
