import { BallState } from "../../engine/BallState";
import { Vec3 } from "../../engine/math/Vec3";
import { TableSpec } from "../../engine/Specs";
import { Point } from "../../game/Referee";
import { Side, SideAt } from "../../game/Side";
import { RallyEvents } from "../RallyEvents";

/** A moment worth a word on screen or a sound from the crowd. */
export type Moment =
    | { readonly Kind: "Smash"; readonly Kmh: number }
    | { readonly Kind: "NetCord" }
    | { readonly Kind: "Edge" }
    | { readonly Kind: "LongRally"; readonly Strokes: number };

/**
 * Follows a rally through the game loop's events and names what a commentator would: how many
 * strokes it has run, how fast the player's last shot left the racket, and the notable moments.
 * It only counts and compares; the HUD and the sound each keep one and decide what to do with it.
 */
export class RallyTracker implements RallyEvents {
    /** TUNED: a player's shot leaving at this speed or more, m/s, is called a smash (ShotAssist's hardest ordinary push leaves at about 6.3). */
    static readonly SmashSpeed = 8.5;

    /** TUNED: a rally of this many strokes or more is called out when its point is decided. */
    static readonly LongRally = 8;

    /** TUNED: a bounce this close to the table's edge, m, is called an edge ball: about a third of the ball's width. */
    static readonly EdgeBand = 0.012;

    /** Strokes in the rally so far; a racket meeting the ball twice in one swing is one stroke. */
    Strokes = 0;

    /** How fast the player's last shot left the racket, km/h, or null before their first. */
    PlayerKmh: number | null = null;

    OnStroke: (Strokes: number, Racket: number, Kmh: number) => void = () => {};
    OnMoment: (What: Moment) => void = () => {};

    private LastRacket = -1;
    /** The end that struck last, and whether its ball has touched the net since. */
    private Striker: Side | null = null;
    private Corded = false;

    NewBall(_Ball: BallState): void { this.Reset(); }

    Hit(Racket: number, At: Vec3, _SpeedChange: number, Ball: BallState): void {
        const Kmh = Ball.Velocity.Length() * 3.6;
        // The same racket again with no bounce between is the same swing still on the ball.
        const Fresh = Racket !== this.LastRacket;
        if (Fresh) this.Strokes++;
        this.LastRacket = Racket;
        this.Striker = SideAt(At.Z);
        this.Corded = false;
        if (Racket === 0) {
            this.PlayerKmh = Kmh;
            if (Fresh && Ball.Velocity.Length() >= RallyTracker.SmashSpeed) this.OnMoment({ Kind: "Smash", Kmh });
        }
        this.OnStroke(this.Strokes, Racket, Kmh);
    }

    Net(_At: Vec3, _SpeedChange: number): void { this.Corded = true; }

    Bounce(At: Vec3, _SpeedChange: number, _Ball: BallState): void {
        this.LastRacket = -1;
        const Court = SideAt(At.Z);
        // Only a ball that lands in the other court is notable; one that dies on the striker's own side is just a fault.
        if (this.Striker === null || Court === null || Court === this.Striker) { this.Corded = false; return; }
        if (this.Corded) this.OnMoment({ Kind: "NetCord" });
        else if (Math.abs(At.X) > TableSpec.HalfWidth - RallyTracker.EdgeBand || Math.abs(At.Z) > TableSpec.HalfLength - RallyTracker.EdgeBand) {
            this.OnMoment({ Kind: "Edge" });
        }
        this.Corded = false;
    }

    Point(_Called: Point): void {
        if (this.Strokes >= RallyTracker.LongRally) this.OnMoment({ Kind: "LongRally", Strokes: this.Strokes });
        this.Reset();
    }

    private Reset(): void {
        this.Strokes = 0;
        this.LastRacket = -1;
        this.Striker = null;
        this.Corded = false;
    }
}
