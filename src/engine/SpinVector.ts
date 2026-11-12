import { Vec3 } from "./math/Vec3";

/**
 * Spin as a player describes it: revolutions per second of topspin and sidespin, relative to the
 * way the ball is heading across the table. Topspin turns the top of the ball forward; backspin is
 * negative topspin. Positive sidespin turns the ball about +Y, which Magnus (w x v) curves to the
 * striker's left.
 */

/** The angular velocity, rad/s, of TopRevs and SideRevs for a ball heading along Heading; zero for a vertical heading. */
export function Of(Heading: Vec3, TopRevs: number, SideRevs: number): Vec3 {
    const Forward = new Vec3(Heading.X, 0, Heading.Z).Normalized();
    if (Forward.IsZero()) return Vec3.Zero;
    return TopAxis(Forward).Scale(TopRevs * 2 * Math.PI).Plus(Vec3.Up.Scale(SideRevs * 2 * Math.PI));
}

/** The topspin of a ball moving at Velocity with Spin, rev/s; negative is backspin. */
export function TopRevs(Velocity: Vec3, Spin: Vec3): number {
    const Forward = new Vec3(Velocity.X, 0, Velocity.Z).Normalized();
    return Forward.IsZero() ? 0 : Spin.Dot(TopAxis(Forward)) / (2 * Math.PI);
}

/** The sidespin of Spin, rev/s, about +Y. */
export function SideRevs(Spin: Vec3): number { return Spin.Y / (2 * Math.PI); }

/** Heading -Z, topspin turns about -X: the top of the ball then moves along -Z, forward. */
function TopAxis(Forward: Vec3): Vec3 { return Vec3.Up.Cross(Forward); }

export const SpinVector = { Of, TopRevs, SideRevs } as const;
