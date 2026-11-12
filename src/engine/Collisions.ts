import { Vec3 } from "./math/Vec3";
import { BallState } from "./BallState";
import { Contact } from "./Contact";
import { RacketSweep } from "./RacketSweep";
import { BallSpec, NetSpec, RacketSpec, TableSpec } from "./Specs";
import { Surface } from "./Surface";

/**
 * Everything the ball can strike during one physics step: the rackets, the net, the table top and
 * the floor, in that order. Each test looks at where the ball was when the step began and where
 * free flight has taken it, so a fast ball cannot pass through a racket or the net between steps.
 */

/** The ball after the step, and what it touched; Racket is the index of the racket that hit it, or -1. */
export interface CollisionResult {
    readonly Ball: BallState;
    readonly Table: boolean;
    readonly Net: boolean;
    readonly Floor: boolean;
    readonly Racket: number;
}

const R = BallSpec.Radius;

/** A ball put back on a surface it struck sits this far off it, so the next step starts clear. */
const Clearance = 1e-4;

/**
 * Before is the ball as the step began; Flown is where free flight took it over Seconds. Rackets
 * may hold any number of sweeps (one per player at the table), tested in order.
 */
export function Resolve(Before: BallState, Flown: BallState, Seconds: number, Rackets: readonly RacketSweep[]): CollisionResult {
    let Ball = Flown;
    let Racket = -1;
    for (let Index = 0; Index < Rackets.length && Racket < 0; Index++) {
        const Hit = RacketHit(Before, Ball, Seconds, Rackets[Index]);
        if (Hit !== null) {
            Ball = Hit;
            Racket = Index;
        }
    }

    const AfterNet = NetHit(Before, Ball);
    const Net = AfterNet !== Ball;
    Ball = AfterNet;

    const AfterTable = TableHit(Before, Ball);
    const Table = AfterTable !== Ball;
    Ball = AfterTable;

    let Floor = false;
    const FloorY = -TableSpec.Height + R;
    if (Ball.Position.Y < FloorY) {
        Ball = OffLevel(Ball, FloorY, Surface.Floor);
        Floor = true;
    }
    return { Ball, Table, Net, Floor, Racket };
}

/**
 * A bounce off level ground whose top the ball's centre meets at Level. The ball has sunk past
 * it by the end of the step; it is put back above by that overshoot times the restitution, as
 * if it had bounced at the moment it arrived, so a bounce neither gains nor loses height.
 */
function OffLevel(Ball: BallState, Level: number, Kind: Surface): BallState {
    const Bounced = Contact.Bounce(Ball, Vec3.Up, Vec3.Zero, Kind);
    if (Bounced === Ball) return Ball;   // already rising off it
    const P = Ball.Position;
    return Bounced.At(new Vec3(P.X, Level + (Level - P.Y) * Kind.Restitution, P.Z));
}

/**
 * Where the ball, moving relative to the racket, first reaches either face of the blade during
 * the step, and the bounce off the moving face; null if it misses the blade or is leaving it.
 */
function RacketHit(Before: BallState, Flown: BallState, Seconds: number, Sweep: RacketSweep): BallState | null {
    const N = Sweep.Normal;
    const Reach = R + RacketSpec.BladeThickness / 2;
    const D0 = Before.Position.Minus(Sweep.From).Dot(N);
    const D1 = Flown.Position.Minus(Sweep.To).Dot(N);
    const Side = D0 >= 0 ? 1 : -1;

    let When: number;
    if (Side * D0 >= Reach) {
        if (Side * D1 >= Reach) return null;                           // stayed clear of this face
        When = (Side * D0 - Reach) / (Side * D0 - Side * D1);
    } else {
        When = 0;                                                       // already touching as the step began
    }

    const BallAt = Vec3.Lerp(Before.Position, Flown.Position, When);
    const Offset = BallAt.Minus(Vec3.Lerp(Sweep.From, Sweep.To, When));
    const Across = Offset.Minus(N.Scale(Offset.Dot(N)));
    if (Across.Length() > RacketSpec.BladeRadius) return null;

    const Out = N.Scale(Side);
    const Bounced = Contact.Bounce(Flown, Out, Sweep.Velocity(Seconds), Surface.Racket);
    if (Bounced === Flown) return null;
    return Bounced.At(Sweep.To.Plus(Across).PlusScaled(Out, Reach + Clearance));
}

/**
 * The net stands across z = 0 from the table up to NetSpec.Height. Entering its slab below the
 * cord is a hit on the netting; passing the cord's height within a radius of it clips the cord.
 */
function NetHit(Before: BallState, Ball: BallState): BallState {
    const Face = R + NetSpec.Thickness / 2;
    const Z0 = Before.Position.Z, Z1 = Ball.Position.Z;
    const Side = Math.sign(Z0);
    if (Side === 0 || Side * Z0 < Face || Side * Z1 >= Face) return Ball;

    const When = (Side * Z0 - Face) / (Side * Z0 - Side * Z1);
    const At = Vec3.Lerp(Before.Position, Ball.Position, When);
    if (Math.abs(At.X) > NetSpec.Width / 2 || At.Y < 0) return Ball;

    if (At.Y < NetSpec.Height) {
        const Struck = Contact.Bounce(Ball, new Vec3(0, 0, Side), Vec3.Zero, Surface.Net);
        return Struck.At(new Vec3(At.X, At.Y, Side * (Face + Clearance)));
    }
    if (At.Y < NetSpec.Height + Face) {
        const FromCord = new Vec3(0, At.Y - NetSpec.Height, Side * Face).Normalized();
        return Contact.Bounce(Ball, FromCord, Vec3.Zero, Surface.Net);
    }
    return Ball;
}

/** The playing surface, met from above only: a ball under the table never strikes its top. */
function TableHit(Before: BallState, Ball: BallState): BallState {
    const P = Ball.Position;
    const Over = Math.abs(P.X) <= TableSpec.HalfWidth && Math.abs(P.Z) <= TableSpec.HalfLength;
    if (!Over || P.Y >= R || Before.Position.Y < 0) return Ball;
    return OffLevel(Ball, R, Surface.Table);
}

export const Collisions = { Resolve } as const;
