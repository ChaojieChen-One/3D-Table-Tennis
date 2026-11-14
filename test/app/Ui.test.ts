import { expect, test } from "vitest";
import { BallState } from "../../src/engine/BallState";
import { Vec3 } from "../../src/engine/math/Vec3";
import { Point } from "../../src/game/Referee";
import { Scoreboard } from "../../src/game/Scoreboard";
import { Synth } from "../../src/app/audio/Synth";
import { Moment, RallyTracker } from "../../src/app/ui/RallyTracker";
import { TagOf } from "../../src/app/ui/ScoreTags";
import { ReadSpin } from "../../src/app/ui/SpinGauge";
import { Check, F } from "../Measure";

// ---- ScoreTags: game point, match point and deuce as [ITTF] 2.11.1 and 2.12.1 make them.

function After(Near: number, Far: number, NearGames = 0) {
    const Board = new Scoreboard();
    for (let Game = 0; Game < NearGames; Game++) { for (let I = 0; I < 11; I++) Board.Award("Near"); Board.Next(); }
    for (let I = 0; I < Math.min(Near, Far); I++) { Board.Award("Near"); Board.Award("Far"); }
    for (let I = Far; I < Near; I++) Board.Award("Near");
    for (let I = Near; I < Far; I++) Board.Award("Far");
    return Board.Now();
}

test("TheScoreIsTaggedAsTheLawsMakeIt", () => {
    expect(TagOf(After(9, 9))).toEqual({ Kind: "None" });
    expect(TagOf(After(10, 9))).toEqual({ Kind: "GamePoint", For: "Near" });
    expect(TagOf(After(4, 10))).toEqual({ Kind: "GamePoint", For: "Far" });
    expect(TagOf(After(10, 10))).toEqual({ Kind: "Deuce" });
    expect(TagOf(After(12, 12))).toEqual({ Kind: "Deuce" });
    expect(TagOf(After(12, 13))).toEqual({ Kind: "GamePoint", For: "Far" });
    expect(TagOf(After(10, 3, 2))).toEqual({ Kind: "MatchPoint", For: "Near" });
    expect(TagOf(After(11, 3, 0))).toEqual({ Kind: "Game", For: "Near" });
    expect(TagOf(After(11, 3, 2))).toEqual({ Kind: "Match", For: "Near" });
});

test("TheSpinGaugeReadsTheSpinLine", () => {
    expect(ReadSpin("SPIN   none")).toEqual({ Top: 0, Side: 0 });
    expect(ReadSpin("SPIN   backspin 30 rev/s")).toEqual({ Top: -30, Side: 0 });
    expect(ReadSpin("SPIN   topspin 10 rev/s   ·   sidespin 30 rev/s, curving left")).toEqual({ Top: 10, Side: -30 });
});

// ---- RallyTracker: strokes counted once per swing, and the moments named.

test("ARallyIsCountedAndItsMomentsNamed", () => {
    const Tracker = new RallyTracker(), Seen: Moment[] = [];
    Tracker.OnMoment = What => Seen.push(What);
    const Ball = (Speed: number, Z: number) => new BallState(new Vec3(0, 0.2, Z), new Vec3(0, 0, Speed), Vec3.Zero);
    Tracker.NewBall(Ball(5, -1.3));
    for (let Stroke = 0; Stroke < 8; Stroke++) {
        const Near = Stroke % 2 === 0;
        Tracker.Hit(Near ? 0 : 1, new Vec3(0, 0.2, Near ? 1.4 : -1.4), 8, Ball(Near ? -6 : 6, Near ? 1.4 : -1.4));
        // The same racket still on the ball is the same stroke.
        Tracker.Hit(Near ? 0 : 1, new Vec3(0, 0.2, Near ? 1.4 : -1.4), 1, Ball(Near ? -6 : 6, Near ? 1.4 : -1.4));
        Tracker.Bounce(new Vec3(0, 0, Near ? -0.7 : 0.7), 4, Ball(0, 0));
    }
    const Strokes = Tracker.Strokes;
    Tracker.Hit(0, new Vec3(0, 0.2, 1.4), 14, Ball(-9, 1.4));
    Tracker.Net(new Vec3(0, 0.15, 0), 2);
    Tracker.Bounce(new Vec3(0, 0, -0.3), 3, Ball(0, 0));
    Tracker.Point(new Point("Near", "x"));
    Check(Strokes === 8 && Seen.map(Each => Each.Kind).join() === "Smash,NetCord,LongRally" && Tracker.Strokes === 0,
          `${Strokes} strokes from 16 touches; moments ${Seen.map(Each => Each.Kind).join()}`);
});

// ---- Synth: each sound is audible, unclipped, and where its kind of sound sits in the spectrum.

/** The power-weighted mean frequency, Hz, by a direct transform over 20 Hz bins up to 10 kHz. */
function Centroid(Samples: Float32Array, Rate: number): number {
    let Weighted = 0, Total = 0;
    for (let Hz = 60; Hz <= 10000; Hz += 20) {
        let Re = 0, Im = 0;
        const Count = Math.min(Samples.length, Math.floor(Rate * 0.1));
        for (let I = 0; I < Count; I++) { Re += Samples[I] * Math.cos(2 * Math.PI * Hz * I / Rate); Im -= Samples[I] * Math.sin(2 * Math.PI * Hz * I / Rate); }
        const Power = Re * Re + Im * Im;
        Weighted += Hz * Power; Total += Power;
    }
    return Weighted / Total;
}

function Levels(Samples: Float32Array): { Peak: number; Rms: number } {
    let Peak = 0, Sum = 0;
    for (const Each of Samples) { Peak = Math.max(Peak, Math.abs(Each)); Sum += Each * Each; }
    return { Peak, Rms: Math.sqrt(Sum / Samples.length) };
}

test("TheTockIsHigherAndBrighterThanThePock", () => {
    const Rate = 48000, Dice = Synth.Seeded(7);
    const Tock = Synth.Tock(Rate, 0.4, Dice), Pock = Synth.Pock(Rate, 0.4, Dice);
    const HardTock = Synth.Tock(Rate, 1, Dice), Floor = Synth.FloorKnock(Rate, 0.4, Dice), Net = Synth.NetTick(Rate, 0.3, Dice);
    const T = Centroid(Tock, Rate), P = Centroid(Pock, Rate), H = Centroid(HardTock, Rate), Fl = Centroid(Floor, Rate), N = Centroid(Net, Rate);
    const Loud = [Tock, Pock, HardTock, Floor, Net].map(Levels);
    Check(T > 1000 && T < 2600 && P > 450 && P < 1300 && P < T && H > T && Fl < T && N > 3000
          && Loud.every(Each => Each.Peak <= 0.9001 && Each.Peak > 0.5 && Each.Rms > 0.02),
          `centroids, Hz: tock ${F(T, 0)}, hard tock ${F(H, 0)}, pock ${F(P, 0)}, floor ${F(Fl, 0)}, net ${F(N, 0)}; peaks ${Loud.map(Each => F(Each.Peak, 2)).join(" ")}; rms ${Loud.map(Each => F(Each.Rms, 3)).join(" ")}`);
});

test("TheCrowdAndTheHallAreAudibleAndUnclipped", () => {
    const Dice = Synth.Seeded(11);
    const Made = {
        Bed: Synth.CrowdBed(24000, 4, 12, Dice), Applause: Synth.Applause(32000, 0.5, Dice),
        Cheer: Synth.Cheer(32000, 0.5, Dice), Ooh: Synth.Ooh(24000, 0.5, Dice), Hall: Synth.Hall(24000, 2.3, Dice),
    };
    const Told = Object.entries(Made).map(([Name, Sound]) => {
        const Of = Levels(Sound.Left);
        return { Name, ...Of, Fine: Of.Peak <= 1 && Of.Rms > 0.004 && Sound.Left.every(Number.isFinite) && Sound.Right.every(Number.isFinite) };
    });
    // The bed loops: its last sample runs into its first without a step bigger than its ordinary ones.
    const Bed = Made.Bed.Left, Seam = Math.abs(Bed[0] - Bed[Bed.length - 1]);
    Check(Told.every(Each => Each.Fine) && Seam < 0.2,
          Told.map(Each => `${Each.Name} peak ${F(Each.Peak, 2)} rms ${F(Each.Rms, 3)}`).join("; ") + `; bed seam ${F(Seam, 3)}`);
});
