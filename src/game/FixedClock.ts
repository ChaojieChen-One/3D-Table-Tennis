/**
 * The physics clock: a frame's real time goes in, a whole number of fixed steps comes out. The
 * game only ever advances by Step, so it behaves the same at any frame rate; the screen draws
 * between the last two steps using Alpha.
 */
export class FixedClock {
    static readonly StepsPerSecond = 480;
    static readonly Step = 1.0 / FixedClock.StepsPerSecond;

    /** TUNED: a stall (a dragged window, a background tab) is skipped, not replayed in one burst. */
    private static readonly LongestFrame = 0.25;

    private Banked = 0;

    /** Banks one frame's real time and returns how many steps are now due. */
    Advance(Seconds: number): number {
        if (!(Seconds > 0)) return 0;   // also NaN
        this.Banked += Math.min(Seconds, FixedClock.LongestFrame);
        const Due = Math.floor(this.Banked / FixedClock.Step);
        this.Banked -= Due * FixedClock.Step;
        return Due;
    }

    /** How far time has come toward the next step, from 0 to just under 1. */
    Alpha(): number { return Math.max(0, Math.min(this.Banked / FixedClock.Step, 1 - 1e-9)); }
}
