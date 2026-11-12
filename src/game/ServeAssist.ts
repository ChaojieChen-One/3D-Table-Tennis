import { BallState } from "../engine/BallState";
import { LaunchSolver } from "../engine/LaunchSolver";
import { TableSpec } from "../engine/Specs";
import { Vec3 } from "../engine/math/Vec3";
import { Side } from "./Side";

/**
 * The serve assist (docs/3d-table-tennis-serve-online-spec.md in the Java edition, "Serve
 * assist"): on contact, if the served ball's first bounce would land outside the server's own half
 * (a margin short of the end line and the net), the forward speed and spin are kept and only the
 * vertical angle is bisected, with Flight itself, until bounce 1 lands inside the zone. Strength is
 * 100%: every serve that touches the racket is corrected this way. After that the assist is off:
 * whether the ball then carries on over the net depends on the server's own power alone, so a weak
 * serve still faults. Serving itself is not built yet; this waits for it.
 */

/** [spec]: about 5 cm short of each edge of the zone, m. */
const Margin = 0.05;

/** Generous enough to carry the landing to either edge of the zone from any realistic contact, m/s. */
const MaxVertical = 12;

/** 28 halvings of a 24 m/s band put the landing within a micrometre. */
const Halvings = 28;

/** Struck as it left the server's racket, corrected so bounce 1 lands in Server's own half. */
export function Correct(Struck: BallState, Server: Side, Seconds: number): BallState {
    const V = Struck.Velocity;
    if (Math.hypot(V.X, V.Z) < 1e-9) return Struck;   // no horizontal travel to place within the zone

    const Low = Server === "Near" ? Margin : -(TableSpec.HalfLength - Margin);
    const High = Server === "Near" ? TableSpec.HalfLength - Margin : -Margin;
    const Near = Math.min(Low, High), Far = Math.max(Low, High);
    if (InZone(LaunchSolver.Landing(Struck, Seconds).Z, Near, Far)) return Struck;

    const Target = (Near + Far) / 2;
    let VyLow = -MaxVertical, VyHigh = MaxVertical;
    const Increasing = LandedZ(Struck, VyHigh, Seconds) >= LandedZ(Struck, VyLow, Seconds);
    for (let Halving = 0; Halving < Halvings; Halving++) {
        const Middle = (VyLow + VyHigh) / 2;
        const Below = LandedZ(Struck, Middle, Seconds) < Target;
        if (Below === Increasing) VyLow = Middle; else VyHigh = Middle;
    }
    const Corrected = new Vec3(V.X, (VyLow + VyHigh) / 2, V.Z);
    return new BallState(Struck.Position, Corrected, Struck.Spin);
}

function InZone(Z: number, Near: number, Far: number): boolean { return Z >= Near && Z <= Far; }

function LandedZ(Struck: BallState, Vy: number, Seconds: number): number {
    const V = Struck.Velocity;
    return LaunchSolver.Landing(new BallState(Struck.Position, new Vec3(V.X, Vy, V.Z), Struck.Spin), Seconds).Z;
}

export const ServeAssist = { Correct } as const;
