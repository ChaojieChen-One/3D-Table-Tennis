import { BallState } from "../engine/BallState";
import { Collisions } from "../engine/Collisions";
import { Contact } from "../engine/Contact";
import { Flight } from "../engine/Flight";
import { LaunchSolver } from "../engine/LaunchSolver";
import { Surface } from "../engine/Surface";
import { ToRadians } from "../engine/math/Numeric";
import { Vec3 } from "../engine/math/Vec3";

/**
 * Aiming a stroke through the engine's own physics: the face that sends a ball, as it meets a
 * racket swung at a given velocity, to land on a target across the net. Each face tried is played
 * through Contact.Bounce and flown, so it answers any spin by its effect rather than by a rule.
 * The computer aims every stroke this way, and the player's aim help turns their face with it.
 * Toward is the way the stroke goes across the table (horizontal, unit); faces open upward from
 * it and turn across it toward Up x Toward.
 */

/** The faces considered: how far open (tilted up) and how far turned across, radians. */
const LeastOpen = ToRadians(-25), MostOpen = ToRadians(65), MostAcross = ToRadians(40);

/** Each angle's range is scanned in this many steps for where the landing crosses its target... */
const Scans = 30;

/** ...and the crossing found to within a thousandth of a degree by this many halvings of one step. */
const Halvings = 12;

/** A return still flying after this long never lands, s. */
const LongestFlight = 3.0;

/**
 * The face that sends a ball Meeting a racket swung at Swing to land on Target: first how open,
 * for the depth, then how far across, for the side, and the depth again, twice over.
 */
export function FaceToward(Meeting: BallState, Swing: Vec3, Target: Vec3, Toward: Vec3, Seconds: number): Vec3 {
    const Side = Vec3.Up.Cross(Toward);
    let Open = ToRadians(35), Across = 0;
    for (let Round = 0; Round < 2; Round++) {
        const Turned = Across;
        Open = Solve(LeastOpen, MostOpen,
                     Each => Landing(Meeting, Face(Each, Turned, Toward), Swing, Seconds).Minus(Target).Dot(Toward),
                     Each => Returns(Meeting, Face(Each, Turned, Toward), Swing, Toward, Seconds));
        const Opened = Open;
        Across = Solve(-MostAcross, MostAcross,
                       Each => Landing(Meeting, Face(Opened, Each, Toward), Swing, Seconds).Minus(Target).Dot(Side),
                       () => true);
    }
    const Turned = Across;
    Open = Solve(LeastOpen, MostOpen,
                 Each => Landing(Meeting, Face(Each, Turned, Toward), Swing, Seconds).Minus(Target).Dot(Toward),
                 Each => Returns(Meeting, Face(Each, Turned, Toward), Swing, Toward, Seconds));
    return Face(Open, Across, Toward);
}

/** Whether the ball, met by a face along Normal swung at Swing, clears the net and first comes down across it. */
export function Returns(Meeting: BallState, Normal: Vec3, Swing: Vec3, Toward: Vec3, Seconds: number): boolean {
    let Ball = Contact.Bounce(Meeting, Normal, Swing, Surface.Racket);
    for (let Flown = 0; Flown < LongestFlight; Flown += Seconds) {
        const Next = Collisions.Resolve(Ball, Flight.Step(Ball, Seconds), Seconds, []);
        Ball = Next.Ball;
        if (Next.Net || Next.Floor) return false;
        if (Next.Table) return Ball.Position.Dot(Toward) > 0;
    }
    return false;
}

/** A face striking along Toward, tilted up by Open and turned across by Across. */
export function Face(Open: number, Across: number, Toward: Vec3): Vec3 {
    const Side = Vec3.Up.Cross(Toward);
    return Toward.Scale(Math.cos(Across) * Math.cos(Open)).PlusScaled(Side, Math.sin(Across) * Math.cos(Open))
                 .PlusScaled(Vec3.Up, Math.sin(Open));
}

/** Where the ball comes down after meeting a face along Normal swung at Swing. */
function Landing(Meeting: BallState, Normal: Vec3, Swing: Vec3, Seconds: number): Vec3 {
    return LaunchSolver.Landing(Contact.Bounce(Meeting, Normal, Swing, Surface.Racket), Seconds);
}

/**
 * The first angle from Low toward High where Miss rises through zero and Accept agrees; the
 * angle of the smallest miss if there is none. Scanned, not bisected end to end: depth rises
 * and then falls again as a face opens (a closed face drives into its own court, a wide open
 * one pops the ball up short), and the first crossing is the drive, the second a lob.
 */
function Solve(Low: number, High: number, Miss: (Angle: number) => number, Accept: (Angle: number) => boolean): number {
    const Step = (High - Low) / Scans;
    let Previous = Miss(Low), Best = Low, Smallest = Math.abs(Previous);
    for (let Each = 1; Each <= Scans; Each++) {
        const Angle = Low + Each * Step, Now = Miss(Angle);
        if (Previous < 0 && Now >= 0) {
            const Crossing = Bisect(Angle - Step, Angle, Miss);
            if (Accept(Crossing)) return Crossing;
        }
        if (Math.abs(Now) < Smallest) {
            Smallest = Math.abs(Now);
            Best = Angle;
        }
        Previous = Now;
    }
    return Best;
}

/** Where Miss crosses zero between Below (short) and Above (long). */
function Bisect(Below: number, Above: number, Miss: (Angle: number) => number): number {
    for (let Halving = 0; Halving < Halvings; Halving++) {
        const Middle = (Below + Above) / 2;
        if (Miss(Middle) < 0) Below = Middle; else Above = Middle;
    }
    return (Below + Above) / 2;
}

export const Aiming = { FaceToward, Returns, Face } as const;
