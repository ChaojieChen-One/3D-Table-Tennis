import { expect, test } from "vitest";
import * as THREE from "three";
import { BallState } from "../../src/engine/BallState";
import { SpinVector } from "../../src/engine/SpinVector";
import { Vec3 } from "../../src/engine/math/Vec3";
import { ReachEnvelope } from "../../src/game/control/ReachEnvelope";
import { CameraRig } from "../../src/app/camera/CameraRig";
import { OnPlane } from "../../src/app/input/CursorRay";
import { FaceKeys } from "../../src/app/input/FaceKeys";
import { SpinLine } from "../../src/app/SpinLine";
import { Check, F } from "../Measure";

// ---- SpinLine: the spin named as the player sees it: topspin and backspin by their sense, sidespin by which way it curves on screen.

const Of = (Velocity: Vec3, Top: number, Side: number) => SpinLine.Describe(new BallState(Vec3.Zero, Velocity, SpinVector.Of(Velocity, Top, Side)));

test("ToppedAndBackspunBallsAreNamed", () => {
    expect(Of(new Vec3(0, 0, -6), 40, 0)).toBe("SPIN   topspin 40 rev/s");
    expect(Of(new Vec3(0, 0, 6), -30, 0)).toBe("SPIN   backspin 30 rev/s");
    expect(Of(new Vec3(0, 0, 6), 0.4, 0)).toBe("SPIN   none");
});

/** Positive sidespin curves to the striker's left: the player's right for a ball coming at them, their left for their own shot. */
test("SidespinSaysWhichWayItCurvesOnScreen", () => {
    expect(Of(new Vec3(0, 0, 6), 0, 30)).toBe("SPIN   sidespin 30 rev/s, curving right");
    expect(Of(new Vec3(0, 0, -6), 0, 30)).toBe("SPIN   sidespin 30 rev/s, curving left");
    expect(Of(new Vec3(0, 0, 6), 10, -30)).toBe("SPIN   topspin 10 rev/s   ·   sidespin 30 rev/s, curving left");
});

// ---- FaceKeys: W/S tilt the face down/up and A/D right/left, as the README's Controls table says.

test("EachKeyTiltsTheWayTheReadmeSays", () => {
    for (const Each of [{ Key: "KeyW", Up: -1, Right: 0 }, { Key: "KeyS", Up: 1, Right: 0 }, { Key: "KeyA", Up: 0, Right: 1 }, { Key: "KeyD", Up: 0, Right: -1 }]) {
        const Keys = new FaceKeys();
        expect(Keys.Press(Each.Key), Each.Key + " is a face key").toBe(true);
        expect(Keys.Up(), Each.Key + " up").toBe(Each.Up);
        expect(Keys.Right(), Each.Key + " right").toBe(Each.Right);
        Keys.Release(Each.Key);
        expect(Keys.Up(), Each.Key + " released, up").toBe(0);
        expect(Keys.Right(), Each.Key + " released, right").toBe(0);
    }
});

test("OppositeKeysCancelAndFocusLossLetsGo", () => {
    const Keys = new FaceKeys();
    Keys.Press("KeyW");
    Keys.Press("KeyS");
    Keys.Press("KeyA");
    expect(Keys.Up()).toBe(0);
    expect(Keys.Right()).toBe(1);
    Keys.ReleaseAll();
    expect(Keys.Right()).toBe(0);
});

test("OtherKeysAreNotFaceKeys", () => {
    const Keys = new FaceKeys();
    for (const Other of ["KeyR", "KeyH", "Digit1", "ArrowUp"]) expect(Keys.Press(Other), Other + " is not a face key").toBe(false);
});

// ---- The camera and the cursor: what the Java edition's Xform and CursorRay tests guarded, in a frame that needs no flip.

/** The player view stands behind the near end and looks down the table; the side views stand where their names say. */
test("TheViewsStandWhereTheirNamesSay", () => {
    const Rig = new CameraRig();
    const Player = Rig.Eye(), Looking = Rig.Looking();
    Rig.View("left");
    const Left = Rig.Eye();
    Rig.View("right");
    const Right = Rig.Eye();
    Check(Player.Z > 4 && Player.Y > 1 && Looking.Z < -0.9 && Left.X < -7 && Right.X > 7,
          `player at ${Player} looking ${Looking}; left view at ${Left}; right view at ${Right}`);
});

/** From the player view, the cursor's left and right are the table's, and further up the screen is further up the table. */
test("TheCursorAimsWhereItPoints", () => {
    const Rig = new CameraRig();
    Rig.Camera.aspect = 16 / 9;
    Rig.Camera.updateProjectionMatrix();
    Rig.Camera.updateMatrixWorld();
    const At = (X: number, Y: number) => OnPlane(Rig.Camera as THREE.PerspectiveCamera, X, Y, ReachEnvelope.HitY, Vec3.Zero);
    const Middle = At(0, -0.4), Left = At(-0.5, -0.4), Right = At(0.5, -0.4), Higher = At(0, -0.1);
    Check(Left.X < Middle.X && Middle.X < Right.X && Higher.Z < Middle.Z && Math.abs(Middle.X) < 1e-9 && Middle.Y === ReachEnvelope.HitY,
          `middle ${Middle}, left ${Left}, right ${Right}, higher up the screen ${Higher}; mirrored by ${F(Left.X + Right.X, 6)}`);
});
