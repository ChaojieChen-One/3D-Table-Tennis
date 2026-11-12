import { Clamp } from "./math/Numeric";

/**
 * How a surface returns the ball: the restitution of the normal speed, the friction coefficient of
 * a slide, and how it grips. SpringBack is the share of the contact patch's slip that springs back
 * past stopping, falling by SpringBackFade per m/s of slip: it is what reverses spin off a racket's
 * rubber, and is zero for hard surfaces. DrillDamping is the share of spin about the surface's
 * normal that survives the contact.
 */
export class Surface {
    constructor(readonly Restitution: number,
                readonly Friction: number,
                readonly SpringBack: number,
                readonly SpringBackFade: number,
                readonly DrillDamping: number) {}

    /** A hard surface: it grips without springing back, and leaves spin about its normal alone. */
    static Rigid(Restitution: number, Friction: number): Surface {
        return new Surface(Restitution, Friction, 0, 0, 1);
    }

    /**
     * [ITTF] Laws of Table Tennis 2.1: a standard ball dropped from 30 cm must bounce about 23 cm,
     * so e = sqrt(23 / 30). Friction: a typical value for a painted top, TUNED.
     */
    static readonly Table = Surface.Rigid(Math.sqrt(0.23 / 0.30), 0.25);

    /**
     * Inverted rubber on a blade. Restitution: a lively face, TUNED. Its grip as the earlier version
     * of the game took it from arXiv:2606.28805 (coefficients fitted to 277 recorded matches): the
     * patch springs back e_t = 0.819 - 0.010 |slip|, spin about the face's normal keeps 0.805, and
     * friction is high enough (1.20, TUNED there) that the springing grip governs, not sliding.
     */
    static readonly Racket = new Surface(0.85, 1.20, 0.819, 0.010, 0.805);

    /** A sprung wooden sports floor. Typical values, TUNED. */
    static readonly Floor = Surface.Rigid(0.75, 0.3);

    /** Netting gives way and soaks up the hit. TUNED. */
    static readonly Net = Surface.Rigid(0.15, 0.3);

    /** The share of a slip at SlipSpeed (m/s) that springs back, from 0 to 1. */
    SpringBackAt(SlipSpeed: number): number {
        return Clamp(this.SpringBack - this.SpringBackFade * SlipSpeed, 0, 1);
    }
}
