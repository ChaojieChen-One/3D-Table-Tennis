import { test } from "vitest";
import { Vec3 } from "../../src/engine/math/Vec3";
import { BallState } from "../../src/engine/BallState";
import { Air } from "../../src/engine/Air";
import { Flight } from "../../src/engine/Flight";
import { BallSpec } from "../../src/engine/Specs";
import { SpinVector } from "../../src/engine/SpinVector";
import { Check, F } from "../Measure";

/** The ball in the air: drag slows it as the drag law says, and spin bends its path the right way. */
const Step = 1.0 / 480;

/** With drag alone, horizontal speed falls as v0 / (1 + k v0 t), k = rho Cd A / 2m; gravity barely couples in over a quarter second. */
test("DragSlowsTheBallAsTheDragLawSays", () => {
    let Ball = new BallState(new Vec3(0, 1, 0), new Vec3(0, 0, -20), Vec3.Zero);
    for (let Each = 0; Each < 120; Each++) Ball = Flight.Step(Ball, Step);
    const K = Air.Density * Air.DragCoefficient * BallSpec.CrossSection / (2 * BallSpec.Mass);
    const Expected = 20 / (1 + K * 20 * 0.25);
    const Got = -Ball.Velocity.Z;
    Check(Math.abs(Got - Expected) / Expected < 0.05, `${F(Got, 2)} m/s after 0.25 s, the drag law gives ${F(Expected, 2)}`);
});

/** For a ball flying toward -z, topspin turns about -x. Topspin pulls the ball down sooner, backspin holds it up. */
test("TopspinDipsAndBackspinFloats", () => {
    const Top = Carry(new Vec3(-300, 0, 0)), Flat = Carry(Vec3.Zero), Back = Carry(new Vec3(300, 0, 0));
    Check(Top < Flat && Flat < Back,
          `carry before falling to the table: topspin ${F(Top, 2)} m, none ${F(Flat, 2)} m, backspin ${F(Back, 2)} m`);
});

/** James and Haake (2008) measured a rally ball losing about 5% of its spin a second at a typical 12 m/s. */
test("SpinFadesAsMeasuredInFlight", () => {
    let Ball = new BallState(new Vec3(0, 1, 0), new Vec3(0, 0, -12), SpinVector.Of(new Vec3(0, 0, -1), 50, 0));
    const Start = Ball.Spin.Length();
    for (let Each = 0; Each < 48; Each++) Ball = Flight.Step(Ball, Step);   // a tenth of a second, near 12 m/s throughout
    const PerSecond = 1 - Math.pow(Ball.Spin.Length() / Start, 10);
    Check(PerSecond > 0.04 && PerSecond < 0.06, `spin falls ${F(PerSecond * 100, 1)}% a second at 12 m/s`);
});

function Carry(Spin: Vec3): number {
    let Ball = new BallState(new Vec3(0, 0.3, 0), new Vec3(0, 1, -8), Spin);
    while (Ball.Position.Y > 0) Ball = Flight.Step(Ball, Step);
    return -Ball.Position.Z;
}
