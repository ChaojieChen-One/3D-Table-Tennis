import { BallState } from "../engine/BallState";
import { Collisions } from "../engine/Collisions";
import { Flight } from "../engine/Flight";
import { LaunchSolver } from "../engine/LaunchSolver";
import { TableSpec } from "../engine/Specs";
import { Vec3 } from "../engine/math/Vec3";
import { FixedClock } from "./FixedClock";
import { HalfTurnBall } from "./RacketAgent";
import { ServeAssist } from "./ServeAssist";
import { Side } from "./Side";

/**
 * A serve as a coach states it: its name, the speed it leaves the racket at (m/s), its topspin and
 * sidespin (rev/s, as SpinVector), and where on the receiver's court its second bounce lands, for
 * a server at the far end (so on the near court, z > 0).
 */
export interface Serve {
    readonly Name: string;
    readonly Speed: number;
    readonly TopRevs: number;
    readonly SideRevs: number;
    readonly Lands: Vec3;
}

/**
 * The computer's serves, in the spirit of the Feeder's drills (the Java edition's serve spec: "a
 * random target on the player's side and one of three preset spins; LaunchSolver produces the
 * swing; the AI never faults on purpose"). Each is stated as intent and solved once: the launch
 * from where the tossed ball is struck that bounces first on the server's own court and then, over
 * the net, on its spot of the receiver's ([ITTF] 2.6.3). LaunchSolver lands the first bounce; where
 * on the server's court that bounce must be for the second to reach the spot is found by scanning
 * the server's half, and ServeAssist holds the first bounce inside it.
 */

/**
 * TUNED: gentle serves, slower than match play so each can be read. A serve of a given speed has
 * two ways onto the receiver's court: struck flat and downward to bounce deep in the server's half
 * (5 m/s and up, the long serves), or lobbed slowly to bounce near the net (under 4 m/s, the short
 * ones); between the two it meets the net. Coming toward the receiver, positive sidespin curves to
 * their right.
 */
export const Presets: readonly Serve[] = [
    { Name: "Plain serve, long", Speed: 6.5, TopRevs: 0, SideRevs: 0, Lands: new Vec3(0.20, 0, 0.70) },
    { Name: "Topspin serve, long", Speed: 6.5, TopRevs: 25, SideRevs: 0, Lands: new Vec3(-0.30, 0, 0.90) },
    { Name: "Backspin serve, short", Speed: 3.5, TopRevs: -25, SideRevs: 0, Lands: new Vec3(0.25, 0, 0.40) },
    { Name: "Sidespin serve, curving right", Speed: 6.0, TopRevs: 10, SideRevs: 25, Lands: new Vec3(-0.25, 0, 0.70) },
    { Name: "Sidespin serve, curving left", Speed: 6.0, TopRevs: 10, SideRevs: -25, Lands: new Vec3(0.25, 0, 0.70) },
    { Name: "Backspin serve, long", Speed: 5.5, TopRevs: -25, SideRevs: 0, Lands: new Vec3(-0.20, 0, 0.72) },
    { Name: "Plain serve, short", Speed: 3.6, TopRevs: 0, SideRevs: 0, Lands: new Vec3(-0.20, 0, 0.35) },
];

/** The server's half is scanned for the first bounce from this far inside the end line to this far short of the net, m, in Scans steps, then Refines halvings about the best. */
const FromEndLine = 0.15, FromNet = 0.25, Scans = 12, Refines = 5;

/** Re-aims across, each moving the first bounce by the second's sideways miss. */
const Reaims = 2;

/** A serve still flying after this long never lands, s. */
const LongestFlight = 3.0;

/** The serve's two bounces as the game will fly it, or null where it is not a good service: the net touched, the first off the server's court or the second off the receiver's. */
export function Bounces(Launch: BallState, Server: Side, Seconds: number): { First: Vec3; Second: Vec3 } | null {
    let Ball = Launch;
    let First: Vec3 | null = null;
    const Own = Server === "Far" ? -1 : 1;
    for (let Flown = 0; Flown < LongestFlight; Flown += Seconds) {
        const Next = Collisions.Resolve(Ball, Flight.Step(Ball, Seconds), Seconds, []);
        Ball = Next.Ball;
        if (Next.Net || Next.Floor) return null;
        if (!Next.Table) continue;
        const OnOwn = Ball.Position.Z * Own > 0;
        if (First === null) {
            if (!OnOwn) return null;
            First = Ball.Position;
        } else {
            return OnOwn ? null : { First, Second: Ball.Position };
        }
    }
    return null;
}

/** The far server's launch from From for Each: the first bounce placed so the second lands on its spot. */
export function Solve(Each: Serve, From: Vec3, Seconds: number): BallState {
    const Launched = (Across: number, Depth: number) =>
        ServeAssist.Correct(LaunchSolver.AtTarget(From, new Vec3(Across, 0, Depth), Each.Speed, Each.TopRevs, Each.SideRevs, Seconds), "Far", Seconds);
    // How far the second bounce is from the spot along the table; a serve that is no good is as far off as can be.
    const Miss = (Launch: BallState) => {
        const Landed = Bounces(Launch, "Far", Seconds);
        return Landed === null ? Number.POSITIVE_INFINITY : Math.abs(Landed.Second.Z - Each.Lands.Z);
    };
    const Deepest = -(TableSpec.HalfLength - FromEndLine), Shallowest = -FromNet;
    let Across = From.X + (Each.Lands.X - From.X) * 0.4;
    let Best = Launched(Across, (Deepest + Shallowest) / 2), BestMiss = Number.POSITIVE_INFINITY;
    for (let Pass = 0; Pass <= Reaims; Pass++) {
        let BestDepth = Deepest, Width = (Shallowest - Deepest) / Scans;
        BestMiss = Number.POSITIVE_INFINITY;
        for (let Scan = 0; Scan <= Scans; Scan++) {
            const Depth = Deepest + Scan * Width, Trial = Launched(Across, Depth), Off = Miss(Trial);
            if (Off < BestMiss) { BestMiss = Off; BestDepth = Depth; Best = Trial; }
        }
        for (let Refine = 0; Refine < Refines; Refine++) {
            Width /= 2;
            for (const Depth of [BestDepth - Width, BestDepth + Width]) {
                const Trial = Launched(Across, Depth), Off = Miss(Trial);
                if (Off < BestMiss) { BestMiss = Off; BestDepth = Depth; Best = Trial; }
            }
        }
        const Landed = Bounces(Best, "Far", Seconds);
        if (Landed === null || Pass === Reaims) break;
        // The second bounce's sideways miss, scaled back to the first bounce by how far along the serve's line it is.
        const Along = (Landed.First.Z - From.Z) / (Landed.Second.Z - From.Z);
        Across += (Each.Lands.X - Landed.Second.X) * Along;
    }
    return Best;
}

/** Solved on first use, then kept, by where the ball is struck from: each takes a few hundred trial launches. */
const Solved = new Map<string, BallState[]>();

/** The far server's launch for preset Index, struck from From. */
export function Launch(Index: number, From: Vec3): BallState {
    const Key = `${From.X},${From.Y},${From.Z}`;
    let Kept = Solved.get(Key);
    if (Kept === undefined) Solved.set(Key, Kept = []);
    const Which = ((Index % Presets.length) + Presets.length) % Presets.length;
    return Kept[Which] ??= Solve(Presets[Which], From, FixedClock.Step);
}

/** The same serve from the near end: the far server's, half turned. */
export function LaunchFor(Server: Side, Index: number, From: Vec3): BallState {
    return Server === "Far" ? Launch(Index, From) : HalfTurnBall(Launch(Index, new Vec3(-From.X, From.Y, -From.Z)));
}

export const Serves = { Presets, Bounces, Solve, Launch, LaunchFor } as const;
