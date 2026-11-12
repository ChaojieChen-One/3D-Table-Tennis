import { BallState } from "../engine/BallState";
import { RacketPose } from "./control/RacketPose";

/**
 * What the screen draws after a step: the ball and every racket at the table. Rackets[0] is always
 * this machine's player; the rest are the rally's seats in order (in singles, Rackets[1] is the
 * opponent).
 */
export class RallyView {
    constructor(readonly Ball: BallState, readonly Rackets: readonly RacketPose[]) {}

    /** This machine's player. */
    get Player(): RacketPose { return this.Rackets[0]; }

    /** The first other seat: in singles, the opponent. */
    get Opponent(): RacketPose { return this.Rackets[1]; }

    /** Partway from one step's view to the next. */
    static Between(From: RallyView, To: RallyView, Fraction: number): RallyView {
        const Count = Math.min(From.Rackets.length, To.Rackets.length);
        const Rackets: RacketPose[] = [];
        for (let Each = 0; Each < Count; Each++) Rackets.push(RacketPose.Between(From.Rackets[Each], To.Rackets[Each], Fraction));
        return new RallyView(BallState.Between(From.Ball, To.Ball, Fraction), Rackets);
    }
}
