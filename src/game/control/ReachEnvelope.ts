import { TableSpec } from "../../engine/Specs";
import { Clamp as Limit } from "../../engine/math/Numeric";
import { Vec3 } from "../../engine/math/Vec3";

/**
 * Where the player's racket may be. Cursor X maps to racket X, cursor Y to racket Z
 * (monotonically), and racket Y rests at HitY: one horizontal plane for the cursor, full 3D for
 * the ball. Only the automatic lift (CursorFollower.LiftToward) raises it, up to HighestLift.
 * Values from the earlier version of the game, where they were tuned against its feeds.
 */

/** TUNED: the height that gave the hardest feed its longest reachable window. Never from the cursor. */
export const HitY = 0.16;

/** TUNED: the lift reaches no higher than about shoulder height for a player standing at the table. */
export const HighestLift = 0.60;

/** TUNED: how far up the table the racket may reach, about a metre short of the net. */
export const ZNear = 0.30;

/** TUNED: past this a ball has dropped below a racket at HitY anyway. */
export const ZFar = 2.40;

/** A metre outside the table edge, so a ball run into the corner can be chased. */
export const MaxX = TableSpec.HalfWidth + 1.0;

/** TUNED: where returns arrive, so the worst-case dash from rest is shortest. */
export const Neutral = new Vec3(0, HitY, 1.90);

/** The legal hitting-plane point for a raw aim. The aim's Y is discarded, structurally. */
export function Clamp(RawAim: Vec3 | null | undefined): Vec3 {
    if (RawAim == null || !RawAim.IsFinite()) return Neutral;
    return new Vec3(Limit(RawAim.X, -MaxX, MaxX), HitY, Limit(RawAim.Z, ZNear, ZFar));
}

export const ReachEnvelope = { HitY, HighestLift, ZNear, ZFar, MaxX, Neutral, Clamp } as const;
