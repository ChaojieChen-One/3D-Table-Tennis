import { BallState } from "../engine/BallState";
import { SpinVector } from "../engine/SpinVector";

/** The ball's spin in the words a player uses, as the player sees it: which way it turns, how hard, and which way it curves. */

/** Below this, rev/s, a spin is not worth naming. */
const Negligible = 1.0;

export function Describe(Ball: BallState): string {
    const Velocity = Ball.Velocity, Spin = Ball.Spin;
    const Top = SpinVector.TopRevs(Velocity, Spin), Side = SpinVector.SideRevs(Spin);
    const NoTop = Math.abs(Top) < Negligible, NoSide = Math.abs(Side) < Negligible;
    if (NoTop && NoSide) return "SPIN   none";
    let Line = "SPIN   ";
    if (!NoTop) Line += `${Top > 0 ? "topspin" : "backspin"} ${Math.abs(Top).toFixed(0)} rev/s`;
    if (!NoSide) {
        if (!NoTop) Line += "   ·   ";
        // Magnus pushes along w x v; the player faces -z, so +x is their right.
        const Right = Spin.Cross(Velocity).X > 0;
        Line += `sidespin ${Math.abs(Side).toFixed(0)} rev/s, curving ${Right ? "right" : "left"}`;
    }
    return Line;
}

export const SpinLine = { Describe } as const;
