import { test } from "vitest";
import { BallState } from "../../src/engine/BallState";
import { Collisions } from "../../src/engine/Collisions";
import { Contact } from "../../src/engine/Contact";
import { Flight } from "../../src/engine/Flight";
import { LaunchSolver } from "../../src/engine/LaunchSolver";
import { RacketSpec, TableSpec } from "../../src/engine/Specs";
import { SpinVector } from "../../src/engine/SpinVector";
import { Surface } from "../../src/engine/Surface";
import { Vec3 } from "../../src/engine/math/Vec3";
import { CursorFollower } from "../../src/game/control/CursorFollower";
import { RacketPose } from "../../src/game/control/RacketPose";
import { Swing } from "../../src/game/control/Swing";
import { Feeder } from "../../src/game/Feeder";
import { FixedClock } from "../../src/game/FixedClock";
import { ShotAssist } from "../../src/game/ShotAssist";
import { Check } from "../Measure";

const Forward = new Vec3(0, 0, -1), Right = new Vec3(1, 0, 0);
const Signed = (V: number, D: number) => (V >= 0 ? "+" : "") + V.toFixed(D);

/** A drill's feed, flown until it has bounced on the player's side and come back to z = 1.0. */
function Met(Drill: number): BallState {
    const Feed = new Feeder();
    let Ball = Feed.Next();
    for (let Each = 1; Each <= Drill; Each++) Ball = Feed.Next();
    let Bounced = false;
    while (!(Bounced && Ball.Position.Z >= 1.0)) {
        const Next = Collisions.Resolve(Ball, Flight.Step(Ball, FixedClock.Step), FixedClock.Step, []);
        Ball = Next.Ball;
        Bounced ||= Next.Table && Ball.Position.Z > 0;
    }
    return Ball;
}

/**
 * Where Ball comes down at the table's height after a mid-blade hit by a racket pushed forward
 * at 2 m/s and sideways at Across, with A/D held at Tilt; the face turns with the keys as
 * CursorFollower turns it.
 */
function Landing(Ball: BallState, Tilt: number, Across: number): Vec3 {
    const Normal = Forward.PlusScaled(Right, Tilt * CursorFollower.FaceTilt).Normalized();
    const Moving = new Vec3(Across, 0, -2);
    const Racket = new RacketPose(Ball.Position.PlusScaled(Normal, -RacketSpec.BladeThickness), Normal, 0);
    const Struck = Contact.Bounce(Ball, Normal, Swing.Read(Moving, Normal), Surface.Racket);
    return LaunchSolver.Landing(new ShotAssist().Shoot(Ball, Struck, Racket, Moving, Tilt), FixedClock.Step);
}

/** Where Ball comes down after a square, mid-blade hit by a racket pushed straight forward at Push, m/s. */
function Pushed(Ball: BallState, Push: number): Vec3 {
    const Moving = new Vec3(0, 0, -Push);
    const Racket = new RacketPose(Ball.Position.PlusScaled(Forward, -RacketSpec.BladeThickness), Forward, 0);
    const Shot = new ShotAssist().Shoot(Ball, Contact.Bounce(Ball, Forward, Swing.Read(Moving, Forward), Surface.Racket), Racket, Moving, 0);
    return LaunchSolver.Landing(Shot, FixedClock.Step);
}

/**
 * The owner's ask: the forward push is the power. For every drill, a harder push lands deeper
 * (1.5, 3 and 4.5 m/s in turn), an ordinary 3 m/s push lands on the computer's court, and the
 * racket's full 6 m/s carries past its end line (ITTF Law 2.7.1: out).
 */
test("APushIsThePowerAndTooMuchGoesLong", () => {
    let Measured = "";
    let AllRight = true;
    for (let Drill = 0; Drill < Feeder.Drills.length; Drill++) {
        const Ball = Met(Drill);
        const Soft = Pushed(Ball, 1.5).Z, Ordinary = Pushed(Ball, 3).Z, Firm = Pushed(Ball, 4.5).Z, Full = Pushed(Ball, 6).Z;
        AllRight &&= Soft > Ordinary && Ordinary > Firm && Ordinary < 0 && Ordinary > -TableSpec.HalfLength && Full < -TableSpec.HalfLength;
        Measured += `${Feeder.Drills[Drill].Name}: lands at z ${Signed(Soft, 2)}, ${Signed(Ordinary, 2)}, ${Signed(Firm, 2)}, ${Signed(Full, 2)}; `;
    }
    Check(AllRight, Measured);
});

/**
 * The owner's ask: swiping spins the ball. For every drill, met square and pushed at 2 m/s, a
 * sideways swipe of 2 and then 4 m/s puts more and more sidespin on it, the 4 m/s swipe at least
 * twice what the contact alone gives (which feels only a quarter of the swipe); and the ball
 * still comes down within a degree of the line it was aimed along, however it curves.
 */
test("ASwipeSpinsTheBall", () => {
    let Measured = "";
    let AllRight = true;
    for (let Drill = 0; Drill < Feeder.Drills.length; Drill++) {
        const Ball = Met(Drill);
        const Spin = [0, 0, 0];
        let Raw = 0, WorstMiss = 0;
        for (let Each = 0; Each < 3; Each++) {
            const Moving = new Vec3(2.0 * Each, 0, -2);
            const Racket = new RacketPose(Ball.Position.PlusScaled(Forward, -RacketSpec.BladeThickness), Forward, 0);
            const Struck = Contact.Bounce(Ball, Forward, Swing.Read(Moving, Forward), Surface.Racket);
            const Shots = new ShotAssist();
            const Shot = Shots.Shoot(Ball, Struck, Racket, Moving, 0);
            Spin[Each] = Math.abs(SpinVector.SideRevs(Shot.Spin));
            if (Each === 2) Raw = Math.abs(SpinVector.SideRevs(Struck.Spin));
            const Landed = ShotAssist.Heading(LaunchSolver.Landing(Shot, FixedClock.Step).Minus(Ball.Position));
            WorstMiss = Math.max(WorstMiss, Math.abs(Landed - Shots.Last()!.AimedDegrees));
        }
        AllRight &&= Spin[0] < Spin[1] && Spin[1] < Spin[2] && Spin[2] >= 2 * Raw && WorstMiss < 1;
        Measured += `${Feeder.Drills[Drill].Name}: sidespin ${Spin[0].toFixed(1)}, ${Spin[1].toFixed(1)}, ${Spin[2].toFixed(1)} rev/s `
                  + `(contact alone ${Raw.toFixed(1)}), off the line ${WorstMiss.toFixed(2)} deg; `;
    }
    Check(AllRight, Measured);
});

/**
 * The owner's ask: the ball goes where the player aims. For every drill, holding D sends the
 * return to the right of where it was struck and holding A to the left, landing within a
 * degree of the aimed line however its spin curves it; with neither held, between the two.
 */
test("TheBallGoesWhereTheyAim", () => {
    let Measured = "";
    let AllRight = true;
    for (let Drill = 0; Drill < Feeder.Drills.length; Drill++) {
        const Ball = Met(Drill);
        const From = Ball.Position;
        const Left = ShotAssist.Heading(Landing(Ball, -1, 0).Minus(From));
        const Straight = ShotAssist.Heading(Landing(Ball, 0, 0).Minus(From));
        const RightAim = ShotAssist.Heading(Landing(Ball, 1, 0).Minus(From));
        const Ok = Left < 0 && RightAim > 0 && Left < Straight && Straight < RightAim
                && Math.abs(Left + ShotAssist.KeyAim) < 1 && Math.abs(RightAim - ShotAssist.KeyAim) < 1;
        AllRight &&= Ok;
        Measured += `${Feeder.Drills[Drill].Name}: A ${Signed(Left, 1)}, none ${Signed(Straight, 1)}, D ${Signed(RightAim, 1)} deg; `;
    }
    Check(AllRight, Measured);
});

/**
 * And a shot can miss: aimed hard toward the side the ball is on, with the key held and the
 * racket swept that way at 4 m/s, no drill's return comes down on the computer's court (ITTF
 * Law 2.7.1): it lands past the sideline, or short of the net if the contact sent it there.
 */
test("AWideAimMisses", () => {
    let Measured = "";
    let AllOut = true;
    for (let Drill = 0; Drill < Feeder.Drills.length; Drill++) {
        const Ball = Met(Drill);
        const Side = Ball.Position.X >= 0 ? 1 : -1;
        const Down = Landing(Ball, Side, 4 * Side);
        AllOut &&= Math.abs(Down.X) > TableSpec.HalfWidth || Down.Z > 0 || Down.Z < -TableSpec.HalfLength;
        Measured += `${Feeder.Drills[Drill].Name}: lands at x ${Signed(Down.X, 2)} z ${Signed(Down.Z, 2)}; `;
    }
    Check(AllOut, Measured);
});
