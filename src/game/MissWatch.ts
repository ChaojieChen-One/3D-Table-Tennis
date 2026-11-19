import { BallState } from "../engine/BallState";
import { RacketSpec } from "../engine/Specs";
import { RacketPose } from "./control/RacketPose";
import { ReachEnvelope } from "./control/ReachEnvelope";

/**
 * Why the player missed a ball they had to return, in words they can act on. While the ball is
 * theirs (it has bounced on their side and they have not struck it) the rally shows it every step
 * with their racket; the moment the ball comes level with the racket's depth, how far it passed
 * from the blade is kept. If it never comes level, it either dropped short of the racket or got
 * past it before the racket was there.
 */

/** How the ball passed the racket's depth: metres to the player's right (+) and above (+) the blade's centre, and whether the racket was at a limit of its reach. */
export interface Pass {
    readonly Right: number;
    readonly Above: number;
    readonly AtLowest: boolean;
    readonly AtHighest: boolean;
}

/** Within this of a limit, m, the racket counts as held there. */
const AtLimit = 0.005;

export class MissWatch {
    private Passed: Pass | null = null;
    private Seen = false;
    private StartedBehind = false;

    /** A new ball: nothing seen yet. */
    Reset(): void {
        this.Passed = null;
        this.Seen = false;
        this.StartedBehind = false;
    }

    /** One step of a ball the player has to return: From and To are the ball before and after the step, Racket the player's racket at its end. */
    Watch(From: BallState, To: BallState, Racket: RacketPose): void {
        const Depth = Racket.Centre.Z;
        if (!this.Seen) this.StartedBehind = From.Position.Z > Depth;
        this.Seen = true;
        if (this.Passed !== null || !(From.Position.Z < Depth && To.Position.Z >= Depth)) return;
        const Share = (Depth - From.Position.Z) / (To.Position.Z - From.Position.Z);
        const Level = From.Position.PlusScaled(To.Position.Minus(From.Position), Share);
        const Height = Racket.Centre.Y;
        this.Passed = {
            Right: Level.X - Racket.Centre.X,
            Above: Level.Y - Height,
            AtLowest: Height <= ReachEnvelope.HitY + AtLimit,
            AtHighest: Height >= ReachEnvelope.HighestLift - AtLimit,
        };
    }

    /** How the ball passed the racket, or null if it never came level with it. */
    Pass(): Pass | null { return this.Passed; }

    /** Why the ball was missed, or null if the player never had it to return. */
    Describe(): string | null {
        if (!this.Seen) return null;
        const Passed = this.Passed;
        if (Passed === null)
            return this.StartedBehind ? "the ball bounced behind your paddle: stand further back" : "the ball dropped before it reached your paddle: move in";
        const Beyond = (Off: number) => Math.max(0, Math.abs(Off) - RacketSpec.BladeRadius);
        const Across = Beyond(Passed.Right), Up = Beyond(Passed.Above);
        const Cm = (Metres: number) => Math.max(1, Math.round(Metres * 100)) + " cm";
        const Parts: string[] = [];
        if (Up > 0) Parts.push(Cm(Up) + (Passed.Above > 0 ? " over" : " under"));
        if (Across > 0) Parts.push(Cm(Across) + (Passed.Right > 0 ? " right of" : " left of"));
        if (Parts.length === 0) return "the ball slipped past the edge of your paddle";
        let Line = "the ball passed " + Parts.join(" and ") + " your paddle";
        if (Up > 0 && Passed.Above < 0 && Passed.AtLowest) Line += " (it can't go lower)";
        if (Up > 0 && Passed.Above > 0 && Passed.AtHighest) Line += " (it can't go higher)";
        return Line;
    }
}
