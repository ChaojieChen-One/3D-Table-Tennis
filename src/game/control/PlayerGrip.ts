import { TableSpec } from "../../engine/Specs";
import { Clamp, ToRadians } from "../../engine/math/Numeric";
import { Vec3 } from "../../engine/math/Vec3";

/**
 * How the player's hand holds the racket: its roll about its own face. The player stands where the
 * camera is (footwork is the camera), so a racket out to the left of their line is reached for with
 * the head leaning left and the handle back toward the body, and one out to the right is the mirror
 * image. Rolling a round blade about its own face changes nothing it could hit with, so the face
 * keys still own the face; this is how the hold looks.
 */

/** Fully on its side: the handle points straight back toward the body. */
export const MaxLean = Math.PI / 2;

/** TUNED: how far from the centre line the racket is when it lies fully on its side. */
export const FullLeanAt = 0.5;

/** Over the table, a handle nearer upright than this reaches below the tabletop from the hitting height. */
export const ClearLean = ToRadians(45);

/** How far past the table's edges the handle can still be over it. */
const Margin = 0.15;

/**
 * The lean the hand settles to at Centre, for a player standing at Body and facing along Facing
 * (horizontal): the handle's angle from straight down toward the player's right, radians, so
 * positive leans the head left. Left and right are measured from the player's own line, the one
 * straight ahead of them, which down the camera is the middle of the window. Over the table the
 * lean is never nearer upright than ClearLean, so crossing the line there changes sides; the
 * follower turns the racket across at a hand's pace.
 */
export function Lean(Centre: Vec3, Body: Vec3, Facing: Vec3): number {
    const Right = Facing.Cross(Vec3.Up).Normalized();
    const Aside = Centre.Minus(Body).Dot(Right);
    let Leaning = MaxLean * Clamp(-Aside / FullLeanAt, -1, 1);
    if (OverTable(Centre) && Math.abs(Leaning) < ClearLean) Leaning = Aside > 0 ? -ClearLean : ClearLean;
    return Leaning;
}

function OverTable(Centre: Vec3): boolean {
    return Math.abs(Centre.X) < TableSpec.HalfWidth + Margin && Math.abs(Centre.Z) < TableSpec.HalfLength + Margin;
}

export const PlayerGrip = { MaxLean, FullLeanAt, ClearLean, Lean } as const;
