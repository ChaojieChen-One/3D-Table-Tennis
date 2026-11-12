import { test } from "vitest";
import { Vec3 } from "../../src/engine/math/Vec3";
import { BallState } from "../../src/engine/BallState";
import { Contact } from "../../src/engine/Contact";
import { Surface } from "../../src/engine/Surface";
import { Check, F } from "../Measure";

/**
 * One contact: rubber springs its grip back, so a spinning ball meeting a still racket square on
 * leaves spinning the other way, as on a real bat; a hard table only stops the slip, so the spin
 * falls toward rolling but never reverses.
 */

/** Straight down onto the surface, no travel along it: all the slip is the spin's. */
const Spinning = new BallState(Vec3.Zero, new Vec3(0, -5, 0), new Vec3(300, 0, 0));

test("IncomingSpinComesBackReversedOffRubber", () => {
    const Off = Contact.Bounce(Spinning, Vec3.Up, Vec3.Zero, Surface.Racket);
    const Ratio = Off.Spin.X / Spinning.Spin.X;
    Check(Ratio < 0, `spin left the rubber at ${F(Ratio, 2)} of what arrived`);
});

test("ATableSlowsSpinWithoutReversingIt", () => {
    const Off = Contact.Bounce(Spinning, Vec3.Up, Vec3.Zero, Surface.Table);
    const Ratio = Off.Spin.X / Spinning.Spin.X;
    Check(Ratio >= 0 && Ratio < 1, `spin left the table at ${F(Ratio, 2)} of what arrived`);
});

/** Sidespin about a racket's own normal is damped to the 0.805 the fitted rubber keeps. */
test("RubberDampsSpinAboutItsNormal", () => {
    const Drilling = new BallState(Vec3.Zero, new Vec3(0, -5, 0), new Vec3(0, 300, 0));
    const Kept = Contact.Bounce(Drilling, Vec3.Up, Vec3.Zero, Surface.Racket).Spin.Y / 300;
    Check(Math.abs(Kept - Surface.Racket.DrillDamping) < 1e-9, `kept ${F(Kept, 3)} of the spin about the normal`);
});
