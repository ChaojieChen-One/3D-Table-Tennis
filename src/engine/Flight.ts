import { Air } from "./Air";
import { BallState } from "./BallState";

/**
 * Free flight between contacts: one fourth-order Runge-Kutta step of position and velocity under
 * Air. Spin decays by the distance flown, exactly: w falls by exp(-k d) over a step of length d,
 * so its axis never moves.
 */
export function Step(Ball: BallState, Seconds: number): BallState {
    const P = Ball.Position, V = Ball.Velocity, W = Ball.Spin;
    const A1 = Air.Acceleration(V, W);
    const V2 = V.PlusScaled(A1, Seconds / 2);
    const A2 = Air.Acceleration(V2, W);
    const V3 = V.PlusScaled(A2, Seconds / 2);
    const A3 = Air.Acceleration(V3, W);
    const V4 = V.PlusScaled(A3, Seconds);
    const A4 = Air.Acceleration(V4, W);
    const Moved = V.Plus(V2.Scale(2)).Plus(V3.Scale(2)).Plus(V4);
    const Sped = A1.Plus(A2.Scale(2)).Plus(A3.Scale(2)).Plus(A4);
    const Travel = Moved.Scale(Seconds / 6);
    const Spun = W.Scale(Math.exp(-Air.SpinDecayPerMetre * Travel.Length()));
    return new BallState(P.Plus(Travel), V.PlusScaled(Sped, Seconds / 6), Spun);
}

export const Flight = { Step } as const;
