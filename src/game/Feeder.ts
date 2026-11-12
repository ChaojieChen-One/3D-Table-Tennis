import { BallState } from "../engine/BallState";
import { LaunchSolver } from "../engine/LaunchSolver";
import { Vec3 } from "../engine/math/Vec3";
import { FixedClock } from "./FixedClock";
import { Opponent } from "./Opponent";

/** A feed as a coach states it: its name, speed (m/s), topspin and sidespin (rev/s, as SpinVector), and where on the player's half it lands. */
export interface Feed {
    readonly Name: string;
    readonly Speed: number;
    readonly TopRevs: number;
    readonly SideRevs: number;
    readonly Lands: Vec3;
}

/**
 * Sends the ball to the player from the opponent's end, as a coach feeding a drill would, one
 * drill after another: a plain warm-up ball, then topspin, backspin and sidespin either way, so the
 * player meets each spin in turn. Each is stated as intent (speed, spin, where it lands) and the
 * launch that lands it there is solved once, whatever its spin bends it to.
 */
export class Feeder {
    /** Where the ball is held before it goes: just in front of the opponent's racket. */
    static readonly Hold = new Vec3(0, 0.25, Opponent.StandZ + 0.12);

    /**
     * TUNED: gentle drill feeds, slower and lighter than match play (loops reach 60 to 110 rev/s)
     * so each can be read and returned. Coming toward the player, positive sidespin curves to the
     * player's right.
     */
    static readonly Drills: readonly Feed[] = [
        { Name: "Warm-up", Speed: 5.5, TopRevs: 0, SideRevs: 0, Lands: new Vec3(-0.25, 0, 0.60) },
        { Name: "Topspin", Speed: 7.0, TopRevs: 40, SideRevs: 0, Lands: new Vec3(0, 0, 0.80) },
        { Name: "Backspin", Speed: 5.0, TopRevs: -30, SideRevs: 0, Lands: new Vec3(0.25, 0, 0.60) },
        { Name: "Sidespin, curving right", Speed: 6.0, TopRevs: 10, SideRevs: 30, Lands: new Vec3(-0.20, 0, 0.80) },
        { Name: "Sidespin, curving left", Speed: 6.0, TopRevs: 10, SideRevs: -30, Lands: new Vec3(0.20, 0, 0.80) },
    ];

    /** Solved on first use, then kept: each takes a few thousand trial flights. */
    private static Solved: readonly BallState[] | null = null;

    private static Launches(): readonly BallState[] {
        Feeder.Solved ??= Feeder.Drills.map(Each =>
            LaunchSolver.AtTarget(Feeder.Hold, Each.Lands, Each.Speed, Each.TopRevs, Each.SideRevs, FixedClock.Step));
        return Feeder.Solved;
    }

    private NextIndex = 0;

    /** The next drill's ball, as it leaves the hold. */
    Next(): BallState { const All = Feeder.Launches(); return All[this.NextIndex++ % All.length]; }

    /** Which drill the next ball will be. */
    Upcoming(): Feed { return Feeder.Drills[this.NextIndex % Feeder.Drills.length]; }

    /** The warm-up feed, as it leaves the hold: the plain ball an online rally starts with while there are no serves. */
    static WarmUp(): BallState { return Feeder.Launches()[0]; }
}
