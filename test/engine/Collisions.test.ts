import { test } from "vitest";
import { Vec3 } from "../../src/engine/math/Vec3";
import { BallState } from "../../src/engine/BallState";
import { Collisions } from "../../src/engine/Collisions";
import { Flight } from "../../src/engine/Flight";
import { RacketSweep } from "../../src/engine/RacketSweep";
import { BallSpec, RacketSpec } from "../../src/engine/Specs";
import { Surface } from "../../src/engine/Surface";
import { Check, F } from "../Measure";

/** Bounces off the table, the rackets and the net. */
const Step = 1.0 / 480;
const R = BallSpec.Radius;

/** [ITTF] Laws of Table Tennis 2.1: dropped from 30 cm, a standard ball bounces about 23 cm. Air drag takes a little off. */
test("TheTablePassesTheDropTest", () => {
    let Ball = new BallState(new Vec3(0.3, 0.30 + R, 0.5), Vec3.Zero, Vec3.Zero);
    let Bounced = false;
    let Highest = 0;
    for (let Each = 0; Each < 480 * 2; Each++) {
        const Next = Collisions.Resolve(Ball, Flight.Step(Ball, Step), Step, []);
        Ball = Next.Ball;
        Bounced ||= Next.Table;
        if (Bounced) Highest = Math.max(Highest, Ball.Position.Y - R);
        if (Bounced && Ball.Velocity.Y < 0) break;
    }
    Check(Highest > 0.20 && Highest < 0.235, `bounced ${F(Highest * 100, 1)} cm from a 30 cm drop`);
});

/** A ball skidding forward onto the table is gripped at the bottom: it leaves slower, turning forward (about +x for travel toward +z). */
test("ASkiddingBallPicksUpForwardSpinFromTheTable", () => {
    const Ball = new BallState(new Vec3(0, R + 0.001, 0.5), new Vec3(0, -2, 5), Vec3.Zero);
    const After = Collisions.Resolve(Ball, Flight.Step(Ball, Step), Step, []).Ball;
    Check(After.Spin.X > 0 && After.Velocity.Z < 5 && After.Velocity.Y > 0,
          `after the bounce: velocity ${After.Velocity}, spin ${After.Spin} rad/s`);
});

/** A still racket squarely met returns the ball at the racket's restitution, measured across the contact itself. */
test("AStillRacketReturnsTheBallAtItsRestitution", () => {
    const Still = new RacketSweep(new Vec3(0, 0.5, -1.5), new Vec3(0, 0.5, -1.5), new Vec3(0, 0, 1));
    let Ball = new BallState(new Vec3(0, 0.5, -1.2), new Vec3(0, 0, -5), Vec3.Zero);
    for (let Each = 0; Each < 480; Each++) {
        const Flown = Flight.Step(Ball, Step);
        const Next = Collisions.Resolve(Ball, Flown, Step, [Still]);
        if (Next.Racket === 0) {
            const Ratio = Next.Ball.Velocity.Z / -Flown.Velocity.Z;
            Check(Math.abs(Surface.Racket.Restitution - Ratio) <= 1e-9, `left at ${F(Ratio, 3)} of its arrival speed`);
            return;
        }
        Ball = Next.Ball;
    }
    throw new Error("the ball never reached the racket");
});

/**
 * The player's stroke: the ball comes toward the player (+z), the racket faces the opponent (-z)
 * and swings forward and up. The ball goes back toward the opponent with topspin, which for
 * travel toward -z turns about -x.
 */
test("BrushingUpThroughTheBallMakesTopspin", () => {
    const Swing = new Vec3(0, 4, -3);
    const Start = new Vec3(0, 0.2, 1.8);
    const Stroke = new RacketSweep(Start, Start.PlusScaled(Swing, Step), new Vec3(0, 0, -1));
    const Ball = new BallState(Start.Plus(new Vec3(0, 0, -R - RacketSpec.BladeThickness / 2 - 0.005)), new Vec3(0, 0, 4), Vec3.Zero);
    const Hit = Collisions.Resolve(Ball, Flight.Step(Ball, Step), Step, [Stroke]);
    const V = Hit.Ball.Velocity, W = Hit.Ball.Spin;
    Check(Hit.Racket === 0 && V.Z < 0 && W.X < 0,
          `racket ${Hit.Racket}: velocity ${V}, spin ${W} rad/s (${F(W.Length() / (2 * Math.PI), 0)} rev/s)`);
});

/** At 25 m/s the ball covers 5 cm a step, more than the blade is thick: it must still be caught. */
test("AFastBallCannotPassThroughTheRacket", () => {
    const Still = new RacketSweep(new Vec3(0, 0.5, 1.6), new Vec3(0, 0.5, 1.6), new Vec3(0, 0, -1));
    for (let Offset = 0; Offset < 0.06; Offset += 0.007) {
        const Ball = Fly(new BallState(new Vec3(0, 0.5, 1.2 + Offset), new Vec3(0, 0, 25), Vec3.Zero), Still, 0.05);
        Check(Ball.Velocity.Z < 0 && Ball.Position.Z < 1.6,
              `starting ${F(Offset, 3)} m further on, the ball ended at z = ${F(Ball.Position.Z, 3)} moving ${Ball.Velocity}`);
    }
});

test("ABallPastTheBladesEdgeMissesIt", () => {
    const Still = new RacketSweep(new Vec3(0, 0.5, -1.5), new Vec3(0, 0.5, -1.5), new Vec3(0, 0, 1));
    const Ball = Fly(new BallState(new Vec3(RacketSpec.BladeRadius + 0.01, 0.5, -1.2), new Vec3(0, 0, -5), Vec3.Zero), Still, 0.1);
    Check(Ball.Position.Z < -1.5, `ended at z = ${F(Ball.Position.Z, 2)}`);
});

test("ALowBallIsStoppedByTheNet", () => {
    let Ball = new BallState(new Vec3(0, 0.08, 0.3), new Vec3(0, 0, -5), Vec3.Zero);
    let Furthest = Ball.Position.Z;
    let Struck = false;
    for (let Each = 0; Each < 240; Each++) {
        const Next = Collisions.Resolve(Ball, Flight.Step(Ball, Step), Step, []);
        Struck ||= Next.Net;
        Ball = Next.Ball;
        Furthest = Math.min(Furthest, Ball.Position.Z);
    }
    Check(Struck && Furthest > 0, `net struck: ${Struck}; got as far as z = ${F(Furthest, 3)}`);
});

function Fly(Ball: BallState, Racket: RacketSweep, Seconds: number): BallState {
    for (let Each = 0; Each < Seconds * 480; Each++) {
        Ball = Collisions.Resolve(Ball, Flight.Step(Ball, Step), Step, [Racket]).Ball;
    }
    return Ball;
}
