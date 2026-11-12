import { expect, test } from "vitest";
import { TableSpec } from "../../../src/engine/Specs";
import { ToDegrees } from "../../../src/engine/math/Numeric";
import { Vec3 } from "../../../src/engine/math/Vec3";
import { CursorFollower } from "../../../src/game/control/CursorFollower";
import { PlayerGrip } from "../../../src/game/control/PlayerGrip";
import { ReachEnvelope } from "../../../src/game/control/ReachEnvelope";
import { Swing } from "../../../src/game/control/Swing";
import { FixedClock } from "../../../src/game/FixedClock";
import { Check, F } from "../../Measure";

const Near = (A: number, B: number, Within: number) => Math.abs(A - B) <= Within;
function Degrees(A: Vec3, B: Vec3): number {
    return ToDegrees(Math.acos(Math.max(-1, Math.min(1, A.Normalized().Dot(B.Normalized())))));
}

// ---- CursorFollower: the player's racket follows the cursor at a speed a person can carry it, and tilts on the keys.

const Start = new Vec3(0, ReachEnvelope.HitY, 1.6);

test("AFlickOfTheMouseCannotOutrunACarriedRacket", () => {
    const Hand = new CursorFollower(Start);
    // A metre sideways between two frames; the eight steps of one 60 Hz frame consume it.
    Hand.AimAt(Start.Plus(new Vec3(1.0, 0, 0)));
    let Fastest = 0;
    let Before = Hand.Pose().Centre;
    for (let Step = 0; Step < 8; Step++) {
        Hand.Advance(FixedClock.Step);
        const After = Hand.Pose().Centre;
        Fastest = Math.max(Fastest, After.Minus(Before).Length() / FixedClock.Step);
        Before = After;
    }
    Check(Fastest <= CursorFollower.TrackSpeed * 1.001, `peak racket speed ${F(Fastest, 2)} m/s against the ${F(CursorFollower.TrackSpeed, 1)} m/s limit`);
    // The limit is only worth having if it sits below a real swing.
    Check(CursorFollower.TrackSpeed < 17.8, `${F(CursorFollower.TrackSpeed, 1)} m/s tracking against a measured 17.8 m/s swing`);
});

test("TheRacketArrivesWhereTheCursorPoints", () => {
    const Hand = new CursorFollower(Start);
    const Aim = new Vec3(-0.4, ReachEnvelope.HitY, 1.1);
    Hand.AimAt(Aim);
    for (let Step = 0; Step < FixedClock.StepsPerSecond / 4; Step++) Hand.Advance(FixedClock.Step);
    const Miss = Hand.Pose().Centre.Minus(Aim).Length();
    Check(Miss < 1e-9, `${F(Miss, 4)} m from the aim after a quarter second`);
});

test("AnAimOffThePlaneIsHeldToIt", () => {
    const Hand = new CursorFollower(Start);
    Hand.AimAt(new Vec3(5, 2, -3));
    for (let Step = 0; Step < FixedClock.StepsPerSecond; Step++) Hand.Advance(FixedClock.Step);
    const At = Hand.Pose().Centre;
    expect(Near(At.Y, ReachEnvelope.HitY, 1e-12), "height").toBe(true);
    expect(Near(At.X, ReachEnvelope.MaxX, 1e-12), "sideways reach").toBe(true);
    expect(Near(At.Z, ReachEnvelope.ZNear, 1e-12), "reach up the table").toBe(true);
});

test("UntouchedTheFaceIsSquareToTheTable", () => {
    const Hand = new CursorFollower(Start);
    for (let Step = 0; Step < FixedClock.StepsPerSecond / 2; Step++) Hand.Advance(FixedClock.Step);
    const Off = Degrees(Hand.Pose().Normal, CursorFollower.Square);
    Check(Off < 1e-6, `${F(Off, 2)} deg off square`);
});

/** W turns the face down, S up, A left and D right (README, Controls), each 45 degrees, and letting go squares it. */
test("EachFaceKeyTiltsItsOwnWayAndLettingGoSquaresIt", () => {
    let Measured = "";
    let AllRight = true;
    for (const Each of [{ Key: "W", Up: -1, Right: 0 }, { Key: "S", Up: 1, Right: 0 }, { Key: "A", Up: 0, Right: -1 }, { Key: "D", Up: 0, Right: 1 }]) {
        const Hand = new CursorFollower(Start);
        Hand.SetFaceTilt(Each.Up, Each.Right);
        for (let Step = 0; Step < FixedClock.StepsPerSecond / 2; Step++) Hand.Advance(FixedClock.Step);
        const Held = Hand.Pose().Normal;
        Hand.SetFaceTilt(0, 0);
        for (let Step = 0; Step < FixedClock.StepsPerSecond / 2; Step++) Hand.Advance(FixedClock.Step);
        const Released = Hand.Pose().Normal;

        const RightWay = Each.Up > 0 ? Held.Y > 0 : Each.Up < 0 ? Held.Y < 0 : Each.Right > 0 ? Held.X > 0 : Held.X < 0;
        const Turned = Degrees(Held, CursorFollower.Square), Back = Degrees(Released, CursorFollower.Square);
        AllRight &&= RightWay && Turned >= 40 && Turned <= 50 && Back < 0.5;
        Measured += `${Each.Key} ${F(Turned, 1)} deg ${RightWay ? "the right way" : "THE WRONG WAY"}, ${F(Back, 2)} deg after release; `;
    }
    Check(AllRight, Measured);
});

/** A snapped face would read as enormous spin once hitting arrives; it eases over about 1/8 s. */
test("TheFaceTurnsOverAnEighthOfASecondNotInOneStep", () => {
    const Hand = new CursorFollower(Start);
    Hand.SetFaceTilt(1, 0);
    Hand.Advance(FixedClock.Step);
    const FirstStep = Degrees(Hand.Pose().Normal, CursorFollower.Square);
    for (let Step = 1; Step < FixedClock.StepsPerSecond / 8; Step++) Hand.Advance(FixedClock.Step);
    const EighthSecond = Degrees(Hand.Pose().Normal, CursorFollower.Square);
    const Full = ToDegrees(Math.atan(CursorFollower.FaceTilt));
    Check(FirstStep < Full / 10 && EighthSecond > Full * 0.85,
          `${F(FirstStep, 2)} deg after one step, ${F(EighthSecond, 1)} deg after 1/8 s, of ${F(Full, 1)} deg`);
});

/** Crossing the centre line over the table, the racket turns over to the other side rather than snapping. */
test("ChangingSidesOverTheTableTurnsTheRacketAcross", () => {
    const Left = new Vec3(-0.3, ReachEnvelope.HitY, 1.0), Right = new Vec3(0.3, ReachEnvelope.HitY, 1.0);
    const Hand = new CursorFollower(Left);
    Hand.AimAt(Right);
    const Began = Hand.Pose().Roll;
    let Previous = Began, Biggest = 0;
    let Steps = 0;
    while (Math.abs(Hand.Pose().Roll - PlayerGrip.Lean(Right, Vec3.Zero, CursorFollower.Square)) > 1e-9 && Steps < FixedClock.StepsPerSecond) {
        Hand.Advance(FixedClock.Step);
        Steps++;
        Biggest = Math.max(Biggest, Math.abs(Hand.Pose().Roll - Previous));
        Previous = Hand.Pose().Roll;
    }
    const Seconds = Steps * FixedClock.Step;
    const Measured = `${F(ToDegrees(Began), 0)} -> ${F(ToDegrees(Previous), 0)} deg in ${F(Seconds, 3)} s, at most ${F(ToDegrees(Biggest), 2)} deg per step`;
    Check(Began > 0 && Previous < 0, "leans left, then right: " + Measured);
    Check(Biggest <= CursorFollower.RollSpeed * FixedClock.Step + 1e-12, "no faster than RollSpeed: " + Measured);
    Check(Seconds >= 0.15 && Seconds < 0.5, "a turn you can see, and over quickly: " + Measured);
});

/** Footwork is the camera: the untouched face points the way the player looks, and the keys tilt it from there. */
test("TheFaceFollowsTheWayThePlayerLooks", () => {
    const Body = new Vec3(-4, 1.2, 0), Looking = new Vec3(0.9, -0.4, 0);   // down at the table from its left side
    let Measured = "";
    let AllRight = true;
    for (const Each of [{ Key: "none", Up: 0, Right: 0, Leaning: null as Vec3 | null },
                        { Key: "S", Up: 1, Right: 0, Leaning: Vec3.Up as Vec3 | null },
                        { Key: "D", Up: 0, Right: 1, Leaning: new Vec3(0, 0, 1) as Vec3 | null }]) {
        const Hand = new CursorFollower(Start);
        Hand.SetStance(Body, Looking);
        Hand.SetFaceTilt(Each.Up, Each.Right);
        // A full second: the face turns a quarter turn from square to the new facing.
        for (let Step = 0; Step < FixedClock.StepsPerSecond; Step++) Hand.Advance(FixedClock.Step);
        const Face = Hand.Pose().Normal;
        const Right = Each.Leaning === null ? Degrees(Face, new Vec3(1, 0, 0)) < 1e-6 : Face.X > 0.6 && Face.Dot(Each.Leaning) > 0.6;
        AllRight &&= Right;
        Measured += `${Each.Key}: face ${Face}${Right ? "" : " WRONG"}; `;
    }
    Check(AllRight, Measured);
});

// ---- PlayerGrip: the player stands where the camera is: reaching left leans the racket left, reaching right leans it right.

const Height = ReachEnvelope.HitY;
const BehindTable = TableSpec.HalfLength + 0.5;
const OverTable = 1.0;
const FromPlayerCamera = (Centre: Vec3) => PlayerGrip.Lean(Centre, Vec3.Zero, CursorFollower.Square);

test("ReachingLeftLeansLeftAndRightIsTheMirrorImage", () => {
    for (const Z of [BehindTable, OverTable]) {
        for (let X = 0.05; X <= 1.5; X += 0.05) {
            const Left = FromPlayerCamera(new Vec3(-X, Height, Z));
            const Right = FromPlayerCamera(new Vec3(X, Height, Z));
            expect(Left > 0, `x = -${F(X, 2)}, z = ${F(Z, 2)}: lean ${F(ToDegrees(Left), 1)} deg, should lean left`).toBe(true);
            expect(Near(-Left, Right, 1e-12), `x = ${F(X, 2)}, z = ${F(Z, 2)}: right is not the mirror of left`).toBe(true);
        }
    }
});

/** Fully on its side well inside the table's width, not only at its edge. */
test("TheFurtherTheReachTheMoreTheLeanUntilItLiesOnItsSide", () => {
    let Previous = 0;
    for (let X = 0; X <= 1.5; X += 0.01) {
        const Lean = FromPlayerCamera(new Vec3(-X, Height, BehindTable));
        expect(Lean >= Previous - 1e-12, `lean falls back at x = -${F(X, 2)}`).toBe(true);
        Previous = Lean;
    }
    const Flat = ToDegrees(FromPlayerCamera(new Vec3(-PlayerGrip.FullLeanAt, Height, BehindTable)));
    expect(Near(90, Flat, 1e-9), "on its side at the full-lean reach").toBe(true);
    Check(PlayerGrip.FullLeanAt < TableSpec.HalfWidth,
          `on its side at ${F(PlayerGrip.FullLeanAt, 2)} m, inside the table's half width of ${F(TableSpec.HalfWidth, 2)} m`);
});

/** A handle nearer upright reaches below the tabletop from the hitting height. */
test("OverTheTableTheHandleSettlesAboveIt", () => {
    let Least = Number.MAX_VALUE;
    for (let X = -TableSpec.HalfWidth; X <= TableSpec.HalfWidth; X += 0.01)
        for (let Z = 0.3; Z <= TableSpec.HalfLength; Z += 0.05)
            Least = Math.min(Least, Math.abs(FromPlayerCamera(new Vec3(X, Height, Z))));
    Check(Least >= PlayerGrip.ClearLean - 1e-12, `least lean over the table ${F(ToDegrees(Least), 1)} deg, needs ${F(ToDegrees(PlayerGrip.ClearLean), 1)}`);
});

/** Behind the table nothing is in the way, so the racket swings through upright without a jump. */
test("BehindTheTableTheLeanChangesSmoothly", () => {
    let Largest = 0;
    for (let X = -1.5; X < 1.5; X += 0.01) {
        const Step = Math.abs(FromPlayerCamera(new Vec3(X + 0.01, Height, BehindTable)) - FromPlayerCamera(new Vec3(X, Height, BehindTable)));
        Largest = Math.max(Largest, Step);
    }
    Check(ToDegrees(Largest) < 2.5, `largest change per centimetre ${F(ToDegrees(Largest), 2)} deg`);
});

/**
 * Footwork is the camera: orbit round to stand off the left side of the table, looking along +x,
 * and the player's line runs along x, their right is +z. Left and right come from that line, not
 * from the table's centre line.
 */
test("LeftAndRightComeFromThePlayersOwnLine", () => {
    const Body = new Vec3(-4, 1.2, 0), Facing = new Vec3(1, 0, 0);
    const OnLine = PlayerGrip.Lean(new Vec3(-2, Height, 0), Body, Facing);
    const ToTheirRight = PlayerGrip.Lean(new Vec3(-2, Height, PlayerGrip.FullLeanAt), Body, Facing);
    const ToTheirLeft = PlayerGrip.Lean(new Vec3(-2, Height, -PlayerGrip.FullLeanAt), Body, Facing);
    const Measured = `on the line ${F(ToDegrees(OnLine), 0)} deg, to their right ${F(ToDegrees(ToTheirRight), 0)}, to their left ${F(ToDegrees(ToTheirLeft), 0)}`;
    Check(Near(0, OnLine, 1e-12) && Near(-Math.PI / 2, ToTheirRight, 1e-12) && Near(Math.PI / 2, ToTheirLeft, 1e-12), Measured);
});

// ---- ReachEnvelope: the cursor means one thing, and the racket never leaves its plane.

test("TheCursorCannotRaiseTheRacket", () => {
    let Worst = 0;
    for (let Y = -3.0; Y <= 3.0; Y += 0.05)
        for (const Z of [-2.0, 0.3, 1.0, 1.9, 5.0]) {
            const Got = ReachEnvelope.Clamp(new Vec3(0.4, Y, Z));
            Worst = Math.max(Worst, Math.abs(Got.Y - ReachEnvelope.HitY));
        }
    Check(Worst < 1e-12, `worst height deviation ${Worst.toExponential(1)} m over aims from y = -3 to +3 m`);

    const Left = ReachEnvelope.Clamp(new Vec3(-0.5, 99, 1.5));
    const Right = ReachEnvelope.Clamp(new Vec3(+0.5, -99, 1.5));
    Check(Right.X - Left.X > 0.9, `x ${F(Left.X, 2)} -> ${F(Right.X, 2)} as the aim crosses the centre line`);
});

test("DepthRunsOneWayOnly", () => {
    let Previous = Number.NEGATIVE_INFINITY;
    for (let Z = -3.0; Z <= 5.0; Z += 0.01) {
        const Got = ReachEnvelope.Clamp(new Vec3(0, 0, Z)).Z;
        expect(Got >= Previous - 1e-12, `depth reverses at an aim of z = ${F(Z, 2)}`).toBe(true);
        Previous = Got;
    }
    // Monotone alone would be satisfied by a constant, so the range has to be real too.
    Check(ReachEnvelope.ZNear < 0.5 && ReachEnvelope.ZFar > TableSpec.HalfLength + 0.5,
          `z ${F(ReachEnvelope.ZNear, 2)}..${F(ReachEnvelope.ZFar, 2)} m; the end line is at ${F(TableSpec.HalfLength, 2)}`);
});

test("ABrokenAimRestsTheRacketAtNeutral", () => {
    expect(ReachEnvelope.Clamp(null)).toBe(ReachEnvelope.Neutral);
    expect(ReachEnvelope.Clamp(new Vec3(Number.NaN, 0, 1))).toBe(ReachEnvelope.Neutral);
});

// ---- Swing: a gentle push reaches the ball almost as it is; a hard one levels off; a slide across is mostly footwork; up and down pass whole.

const Facing = new Vec3(0, 0, -1);

test("AGentlePushPassesAlmostUnchanged", () => {
    const Met = -Swing.Read(new Vec3(0, 0, -0.5), Facing).Z;
    Check(Met > 0.48 && Met <= 0.5, `a 0.5 m/s push met the ball at ${F(Met, 3)} m/s`);
});

test("TheFastestChaseLevelsOffBelowMostForward", () => {
    const Met = -Swing.Read(new Vec3(0, 0, -CursorFollower.TrackSpeed), Facing).Z;
    Check(Met < Swing.MostForward && Met > Swing.MostForward * 0.9,
          `a ${F(CursorFollower.TrackSpeed, 1)} m/s chase met the ball at ${F(Met, 2)} m/s, against ${F(Swing.MostForward, 1)}`);
});

test("ASlideAcrossIsMostlyFootworkAndUpAndDownPassWhole", () => {
    const Met = Swing.Read(new Vec3(4, 1.5, 0), Facing);
    expect(Near(Met.X, 4 * Swing.SideShare, 1e-12), "sideways").toBe(true);
    expect(Near(Met.Y, 1.5, 1e-12), "upward").toBe(true);
    expect(Near(Met.Z, 0, 1e-12), "forward").toBe(true);
});
