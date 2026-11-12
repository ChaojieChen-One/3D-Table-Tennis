import { expect, test } from "vitest";
import { FixedClock } from "../../src/game/FixedClock";

/** The physics clock: frame times in, whole fixed steps out. */

test("ASecondOfFramesIsASecondOfSteps", () => {
    for (const Rate of [30, 60, 144, 165]) {
        const Clock = new FixedClock();
        let Steps = 0;
        for (let Frame = 0; Frame < Rate; Frame++) Steps += Clock.Advance(1.0 / Rate);
        // Rounding may leave the last step banked, never more.
        expect(Math.abs(Steps - FixedClock.StepsPerSecond) <= 1,
               `${Rate} Hz: ${Steps} steps in one second, expected ${FixedClock.StepsPerSecond}`).toBe(true);
    }
});

test("AStallIsSkippedNotReplayedAllAtOnce", () => {
    for (const Stall of [5.0, Number.POSITIVE_INFINITY]) {
        const Steps = new FixedClock().Advance(Stall);
        expect(Steps <= FixedClock.StepsPerSecond / 2, `a ${Stall} s stall ran ${Steps} steps in one frame`).toBe(true);
    }
});

test("AlphaSitsBetweenTheLastStepAndTheNext", () => {
    const Clock = new FixedClock();
    for (let Frame = 0; Frame < 200; Frame++) {
        Clock.Advance(0.0071);
        const Alpha = Clock.Alpha();
        expect(Alpha >= 0 && Alpha < 1, `frame ${Frame}: alpha ${Alpha.toFixed(6)}`).toBe(true);
    }
});

test("ABrokenFrameTimeRunsNoSteps", () => {
    const Clock = new FixedClock();
    expect(Clock.Advance(Number.NaN)).toBe(0);
    expect(Clock.Advance(-1)).toBe(0);
    expect(Clock.Advance(0)).toBe(0);
});
