import { test } from "vitest";
import { BallState } from "../../src/engine/BallState";
import { Collisions } from "../../src/engine/Collisions";
import { Flight } from "../../src/engine/Flight";
import { SpinVector } from "../../src/engine/SpinVector";
import { Vec3 } from "../../src/engine/math/Vec3";
import { CursorFollower } from "../../src/game/control/CursorFollower";
import { ReachEnvelope } from "../../src/game/control/ReachEnvelope";
import { FixedClock } from "../../src/game/FixedClock";
import { DefaultLevel, Level, LevelNamed, Levels } from "../../src/game/Level";
import { Opponent } from "../../src/game/Opponent";
import { Rally } from "../../src/game/Rally";
import { Check, F } from "../Measure";

/**
 * The computer's levels, measured as Rally.test.ts measures the computer: the same grid of spun
 * player shots that land in its half, counted by how many come back into the player's half. The
 * default level's count is the Java edition's measured baseline, 361 of 385.
 */
const Step = FixedClock.Step;

/** A repeatable draw (mulberry32), so a level's scatter measures the same every run. */
function Seeded(Seed: number): () => number {
    return () => {
        Seed = (Seed + 0x6D2B79F5) | 0;
        let T = Math.imul(Seed ^ (Seed >>> 15), 1 | Seed);
        T = (T + Math.imul(T ^ (T >>> 7), 61 | T)) ^ T;
        return ((T ^ (T >>> 14)) >>> 0) / 4294967296;
    };
}

function LandsInTheComputersHalf(Ball: BallState): boolean {
    for (let Steps = 0; Steps < FixedClock.StepsPerSecond * 3; Steps++) {
        const Next = Collisions.Resolve(Ball, Flight.Step(Ball, Step), Step, []);
        Ball = Next.Ball;
        if (Next.Net || Next.Floor) return false;
        if (Next.Table) return Ball.Position.Z < 0;
    }
    return false;
}

/** Rally.test.ts's spun shots: three places, four heights, five speeds, five topspins, three sidespins. */
function SpunShots(): BallState[] {
    const Shots: BallState[] = [];
    for (const X of [-0.3, 0, 0.3])
        for (const Up of [1.0, 1.5, 2.0, 2.5])
            for (const Toward of [4, 5, 6, 7, 8])
                for (const Top of [-40, -20, 20, 40, 60])
                    for (const Side of [-30, 0, 30]) {
                        const Velocity = new Vec3(-X * 0.5, Up, -Toward);
                        const Shot = new BallState(new Vec3(X, 0.25, 1.6), Velocity, SpinVector.Of(Velocity, Top, Side));
                        if (LandsInTheComputersHalf(Shot)) Shots.push(Shot);
                    }
    return Shots;
}

/** How many of Shots a computer at Skill returns into the player's half, and the mean pace of its strokes, m/s. */
function Measure(Skill: Level, Shots: BallState[]): { Back: number; Pace: number } {
    const Random = Seeded(7);
    let Back = 0, Paces = 0, Strokes = 0;
    for (const Shot of Shots) {
        const Game = new Rally(new CursorFollower(new Vec3(ReachEnvelope.MaxX, 0, ReachEnvelope.ZFar)), new Opponent(Skill, Random));
        Game.Launch(Shot, "Near");
        let Hit = false, Net = false;
        for (let Steps = 0; Steps < FixedClock.StepsPerSecond * 4; Steps++) {
            Game.Step();
            const Last = Game.LastStep();
            if (!Hit && Last.Racket === Rally.OpponentRacket) {
                Hit = true;
                Paces += Game.View().Ball.Velocity.Length();
                Strokes++;
            }
            Net ||= Hit && Last.Net;
            if (Hit && Last.Table) { Back += !Net && Game.View().Ball.Position.Z > 0 ? 1 : 0; break; }
            if (Last.Floor) break;
        }
    }
    return { Back, Pace: Paces / Math.max(1, Strokes) };
}

test("EachLevelUpReturnsMoreAndTheEasierOnesHitSofter", () => {
    const Shots = SpunShots();
    const Results = Levels.map(Each => ({ Each, ...Measure(Each, Shots) }));
    const Measured = Results.map(R => `${R.Each.Name}: ${R.Back} of ${Shots.length} back (${F(100 * R.Back / Shots.length, 0)}%), mean pace ${F(R.Pace, 2)} m/s`).join("; ");
    const [Rookie, Club, Pro, Champion] = Results;
    Check(Levels.length === 4 && Pro.Each === DefaultLevel && Shots.length === 385 && Pro.Back === 361
          && Rookie.Back < Club.Back && Club.Back < Pro.Back && Champion.Back >= Pro.Back
          && Rookie.Pace < Club.Pace && Club.Pace < Pro.Pace && Champion.Pace > Pro.Pace, Measured);
});

test("ALevelIsFoundByItsKeyAndTheDefaultIsPro", () => {
    const Named = Levels.map(Each => `${Each.Key} -> ${LevelNamed(Each.Key.toUpperCase()).Name}`).join(", ");
    Check(Levels.every(Each => LevelNamed(Each.Key) === Each) && LevelNamed(null) === DefaultLevel && LevelNamed("grandmaster") === DefaultLevel
          && DefaultLevel.Key === "pro" && new Opponent().Playing() === DefaultLevel
          && DefaultLevel.ReactionTime === 0.25 && DefaultLevel.MoveSpeed === 2.0,
          `${Named}; no key or an unknown one -> ${LevelNamed(null).Name}`);
});
