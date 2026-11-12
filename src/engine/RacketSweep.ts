import { Vec3 } from "./math/Vec3";

/**
 * A racket over one physics step: its centre where the step began and where it ended, and its
 * face's unit normal; both faces hit. Swing is the velocity the ball meets at a contact. Without
 * one it is what the travel implies, so a swing reaches the ball as a swing; a player's racket
 * passes its own, read from its motion, so moving to the ball is not taken for a stroke.
 */
export class RacketSweep {
    constructor(readonly From: Vec3, readonly To: Vec3, readonly Normal: Vec3, readonly Swing: Vec3 | null = null) {}

    /** The velocity the ball meets: the given swing, or what the travel over Seconds implies. */
    Velocity(Seconds: number): Vec3 { return this.Swing !== null ? this.Swing : this.To.Minus(this.From).Scale(1 / Seconds); }
}
