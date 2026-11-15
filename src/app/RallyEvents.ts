import { BallState } from "../engine/BallState";
import { Vec3 } from "../engine/math/Vec3";
import { RallyView } from "../game/RallyView";
import { Point } from "../game/Referee";
import { Score } from "../game/Scoreboard";

/**
 * What happened in the rally, told by the game loop to whoever shows or sounds it: the scene's
 * effects, the camera, the sound and the HUD. Every method is optional, so a listener takes only
 * what it needs. Listeners only read; none of this reaches back into the game.
 *
 * SpeedChange is how much the contact changed the ball's velocity, m/s: a soft touch is under 2,
 * an ordinary bounce or push 3 to 8, a hard drive well past 10.
 */
export interface RallyEvents {
    /** The ball, now Ball, bounced on the tabletop at At. */
    Bounce?(At: Vec3, SpeedChange: number, Ball: BallState): void;

    /** Racket (0 is this machine's player) struck the ball at At; Ball is the ball as it left. */
    Hit?(Racket: number, At: Vec3, SpeedChange: number, Ball: BallState): void;

    /** The ball touched the net or its cord at At. */
    Net?(At: Vec3, SpeedChange: number): void;

    /** The ball struck the floor at At. */
    Floor?(At: Vec3, SpeedChange: number): void;

    /** The umpire called Called (Winner null is a let); Now is the score after it. */
    Point?(Called: Point, Now: Score): void;

    /** A new ball was put in play, as Ball. */
    NewBall?(Ball: BallState): void;

    /** Once per drawn frame, after the scene is posed: real and game seconds since the last, and what was drawn. */
    Frame?(RealSeconds: number, GameSeconds: number, View: RallyView): void;
}
