import { Vec3 } from "./math/Vec3";
import { ToRadians } from "./math/Numeric";
import { BallState } from "./BallState";
import { Flight } from "./Flight";
import { BallSpec } from "./Specs";
import { SpinVector } from "./SpinVector";

/**
 * The launch that lands a ball of a given speed and spin on a chosen spot of the table, so a feed
 * can be stated as a coach states it (this fast, this much spin, there) and still land wherever
 * its spin bends it. The elevation is found by bisection, since the range grows with elevation
 * across the searched band; then the aim is moved by each landing's miss, so a sidespin ball's
 * curve carries it back onto the spot. As the earlier version of the game solved its feeds.
 */

/** The searched band: below it a feed dives into the net, above it range falls again. */
const LowestElevation = ToRadians(-20), HighestElevation = ToRadians(40);

/** 30 halvings of the 60 degree band put the landing within a micrometre. */
const Halvings = 30;

/** Re-aims for a curving ball; each closes the miss to a fraction of its curve. */
const Reaims = 4;

/** Within this the landing is on the spot, m. */
const Close = 0.005;

/** A flight longer than this never lands. */
const LongestFlight = 3.0;

/**
 * A ball launched from From at Speed (m/s) with TopRevs and SideRevs (rev/s, as SpinVector),
 * aimed to land on Target on the tabletop, flown in steps of Seconds as the game flies it.
 */
export function AtTarget(From: Vec3, Target: Vec3, Speed: number, TopRevs: number, SideRevs: number, Seconds: number): BallState {
    let AimAt = Target;
    let Launch = Elevated(From, AimAt, Speed, TopRevs, SideRevs, Seconds);
    for (let Pass = 0; Pass < Reaims; Pass++) {
        const Landed = Landing(Launch, Seconds);
        const Miss = new Vec3(Target.X - Landed.X, 0, Target.Z - Landed.Z);
        if (Miss.Length() < Close) break;
        AimAt = AimAt.Plus(Miss);
        Launch = Elevated(From, AimAt, Speed, TopRevs, SideRevs, Seconds);
    }
    return Launch;
}

/** The launch toward AimAt whose range along that heading reaches it. */
function Elevated(From: Vec3, AimAt: Vec3, Speed: number, TopRevs: number, SideRevs: number, Seconds: number): BallState {
    const Flat = new Vec3(AimAt.X - From.X, 0, AimAt.Z - From.Z);
    const Range = Flat.Length();
    const Heading = Flat.Normalized();
    const Spin = SpinVector.Of(Heading, TopRevs, SideRevs);
    let Low = LowestElevation, High = HighestElevation;
    for (let Halving = 0; Halving < Halvings; Halving++) {
        const Middle = (Low + High) / 2;
        const Trial = new BallState(From, Launched(Heading, Speed, Middle), Spin);
        if (Landing(Trial, Seconds).Minus(From).Dot(Heading) < Range) Low = Middle; else High = Middle;
    }
    return new BallState(From, Launched(Heading, Speed, (Low + High) / 2), Spin);
}

function Launched(Heading: Vec3, Speed: number, Elevation: number): Vec3 {
    return Heading.Scale(Speed * Math.cos(Elevation)).PlusScaled(Vec3.Up, Speed * Math.sin(Elevation));
}

/** Where the ball first comes down to the tabletop's height, in free flight; the net is not in the way here. */
export function Landing(Ball: BallState, Seconds: number): Vec3 {
    for (let Flown = 0; Flown < LongestFlight; Flown += Seconds) {
        const Next = Flight.Step(Ball, Seconds);
        if (Next.Position.Y <= BallSpec.Radius && Next.Velocity.Y < 0) {
            const Along = (Ball.Position.Y - BallSpec.Radius) / (Ball.Position.Y - Next.Position.Y);
            return Vec3.Lerp(Ball.Position, Next.Position, Math.max(0, Math.min(1, Along)));
        }
        Ball = Next;
    }
    return Ball.Position;
}

export const LaunchSolver = { AtTarget, Landing } as const;
