/** The scalar helpers every layer shares, so each exists exactly once. */

/** Value limited to [Low, High]; inverted bounds never throw. */
export function Clamp(Value: number, Low: number, High: number): number {
    return Value < Low ? Low : (Value > High ? High : Value);
}

/** Degrees to radians. */
export function ToRadians(Degrees: number): number {
    return Degrees * Math.PI / 180;
}

/** Radians to degrees. */
export function ToDegrees(Radians: number): number {
    return Radians * 180 / Math.PI;
}
