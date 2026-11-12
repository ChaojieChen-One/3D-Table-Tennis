import { expect } from "vitest";

/**
 * The project's testing rule: each test prints the number it measured, and passes that same
 * string as the assertion's message, so a failure says what was measured.
 */
export function Check(Passed: boolean, Measured: string): void {
    console.log(Measured);
    expect(Passed, Measured).toBe(true);
}

/** printf-style %.Nf for the measured strings. */
export function F(Value: number, Digits: number): string {
    return Value.toFixed(Digits);
}
