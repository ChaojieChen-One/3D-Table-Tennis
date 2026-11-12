import { Vec3 } from "../../engine/math/Vec3";

/**
 * What the player's racket brings to a contact, as against how it moves about. The racket chases
 * the cursor at up to CursorFollower.TrackSpeed, and taken raw that chase is a stroke: a slide
 * across to reach the ball brushes it off the table sideways, and any quick movement as it arrives
 * sends it far long, since the racket's speed along its face counts (1 + e) times in the return.
 * So the contact meets a swing read from the motion, as the earlier version of the game read its
 * swings: smoothed over a few hundredths of a second, so a flick of the mouse is not a stroke; its
 * sideways part, mostly footwork, cut to SideShare; and its forward part on a saturating curve, so
 * a gentle push passes almost unchanged and a hard one levels off near what lands. Up and down,
 * the automatic lift included, passes whole.
 */

/**
 * TUNED: the forward swing speed that harder pushes level off toward, m/s. A sweep of square
 * faces meeting every drill (pushes 0 to 6 m/s, slides 0 to 6 m/s either way) put the most
 * warm-up returns in at 2.0: 38% against 14% raw, and none long or wide against 45 raw.
 */
export const MostForward = 2.0;

/** TUNED: the share of the racket's sideways motion that reaches the ball. */
export const SideShare = 0.25;

/** TUNED: the time constant the racket's motion is smoothed over, s. */
export const Smoothing = 0.025;

/** The swing a contact meets from a racket moving at Moving, for a player facing along Facing (horizontal, unit). */
export function Read(Moving: Vec3, Facing: Vec3): Vec3 {
    const Right = Facing.Cross(Vec3.Up).Normalized();
    const Forward = Moving.Dot(Facing), Across = Moving.Dot(Right);
    return Facing.Scale(MostForward * Math.tanh(Forward / MostForward))
                 .PlusScaled(Right, Across * SideShare)
                 .PlusScaled(Vec3.Up, Moving.Y);
}

export const Swing = { MostForward, SideShare, Smoothing, Read } as const;
