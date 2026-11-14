import { expect, test } from "vitest";
import { Air } from "../../src/engine/Air";
import { BallState } from "../../src/engine/BallState";
import { CollisionResult, Collisions } from "../../src/engine/Collisions";
import { Flight } from "../../src/engine/Flight";
import { TableSpec } from "../../src/engine/Specs";
import { Vec3 } from "../../src/engine/math/Vec3";
import { CursorFollower } from "../../src/game/control/CursorFollower";
import { ReachEnvelope } from "../../src/game/control/ReachEnvelope";
import { FixedClock } from "../../src/game/FixedClock";
import { RacketAgent } from "../../src/game/RacketAgent";
import { Rally } from "../../src/game/Rally";
import { Point, Referee } from "../../src/game/Referee";
import { Scoreboard } from "../../src/game/Scoreboard";
import { ServeAssist } from "../../src/game/ServeAssist";
import { Serves } from "../../src/game/Serves";
import { Other, Side } from "../../src/game/Side";
import { RacketPose } from "../../src/game/control/RacketPose";
import { Check, F } from "../Measure";

/**
 * Serving, judged against the ITTF Laws of Table Tennis: 2.6 (a correct service), 2.9.1.1 (a let
 * in service), 2.10.1.1 (a point for a service that is not correct) and 2.13 (the order of
 * service). Every expectation is a law or a closed form, not the code's own output.
 */
const Step = FixedClock.Step;

/** What one step's ball did, for a Referee judged directly. */
const Flew = (Ball: BallState): CollisionResult => ({ Ball, Table: false, Net: false, Floor: false, Racket: -1 });
const HitBy = (Ball: BallState, Racket: number): CollisionResult => ({ ...Flew(Ball), Racket });
const OnTable = (Z: number): CollisionResult => ({ ...Flew(new BallState(new Vec3(0, 0.02, Z), new Vec3(0, 1, Z < 0 ? -3 : 3), Vec3.Zero)), Table: true });
const OnNet: CollisionResult = { ...Flew(new BallState(new Vec3(0, 0.15, 0.01), new Vec3(0, 0.5, -2), Vec3.Zero)), Net: true };
const OnFloor = (Z: number): CollisionResult => ({ ...Flew(new BallState(new Vec3(0, -0.74, Z), new Vec3(0, 1, 0), Vec3.Zero)), Floor: true });

/**
 * A toss from the near server's palm, 0.25 m up and 0.2 m behind the end line, thrown straight up
 * to rise Rise under gravity, flown by the engine and struck by the server's racket (index 0)
 * either as it falls back to the palm's height or, StruckRising, a few steps after it leaves.
 * Returns the Referee's call at the strike (null for a good strike) and the rise it flew.
 */
function TossAndStrike(Rise: number, StruckRising: boolean): { Call: Point | null; Rose: number } {
    const Umpire = new Referee();
    const From = new Vec3(0, 0.25, TableSpec.HalfLength + 0.2);
    let Ball = new BallState(From, new Vec3(0, Math.sqrt(2 * -Air.Gravity.Y * Rise), 0), Vec3.Zero);
    Umpire.BeginServe("Near", Ball);
    let Peak = From.Y;
    for (let Steps = 0; Steps < 2 / Step; Steps++) {
        Ball = Flight.Step(Ball, Step);
        Peak = Math.max(Peak, Ball.Position.Y);
        const Strike = StruckRising ? Steps === 5 : Ball.Velocity.Y < 0 && Ball.Position.Y <= From.Y;
        if (Strike) return { Call: Umpire.Judge(HitBy(new BallState(Ball.Position, new Vec3(0, -1, -5), Vec3.Zero), 0), false, Step), Rose: Peak - From.Y };
        expect(Umpire.Judge(Flew(Ball), false, Step), "the toss was called in mid air").toBeNull();
    }
    throw new Error("the toss never came down");
}

/** [ITTF] 2.6.2: the ball must rise at least 16 cm after leaving the palm. 15 cm is a fault; 17 cm is not. */
test("ATossMustRiseSixteenCentimetres", () => {
    const Low = TossAndStrike(0.15, false), High = TossAndStrike(0.17, false);
    Check(Low.Call !== null && Low.Call.Winner === "Far" && Low.Call.Template.startsWith("2.6.2") && High.Call === null
          && Low.Rose < Referee.LeastToss && High.Rose >= Referee.LeastToss && Referee.LeastToss === 0.16,
          `a toss that rose ${F(Low.Rose * 100, 1)} cm: ${Low.Call}; one that rose ${F(High.Rose * 100, 1)} cm: ${High.Call ?? "a good strike"}`);
});

/** [ITTF] 2.6.3: the ball is struck as it is falling. A high enough toss met on the way up is a fault. */
test("AServeStruckWhileRisingIsAFault", () => {
    const Rising = TossAndStrike(0.50, true), Falling = TossAndStrike(0.50, false);
    Check(Rising.Call !== null && Rising.Call.Winner === "Far" && Rising.Call.Template.startsWith("2.6.3") && Falling.Call === null,
          `struck rising: ${Rising.Call}; struck falling after rising ${F(Falling.Rose * 100, 1)} cm: ${Falling.Call ?? "a good strike"}`);
});

/** [ITTF] 2.6.2 and 2.10.1.1: a toss the server never strikes touches the floor, and the receiver scores. */
test("ATossNeverStruckIsTheReceiversPoint", () => {
    let Measured = "";
    let AllRight = true;
    for (const Server of ["Near", "Far"] as Side[]) {
        const Umpire = new Referee();
        const Sign = Server === "Near" ? 1 : -1;
        let Ball = new BallState(new Vec3(0, 0.25, Sign * (TableSpec.HalfLength + 0.2)), new Vec3(0, 3, 0), Vec3.Zero);
        Umpire.BeginServe(Server, Ball);
        let Call: Point | null = null;
        for (let Steps = 0; Steps < 3 / Step && Call === null; Steps++) {
            const Next = Collisions.Resolve(Ball, Flight.Step(Ball, Step), Step, []);
            Ball = Next.Ball;
            Call = Umpire.Judge(Next, false, Step);
        }
        AllRight &&= Call !== null && Call.Winner === Other(Server) && Call.Template.includes("2.10.1.1");
        Measured += `${Server} tossed and never struck: ${Call}; `;
    }
    Check(AllRight, Measured);
});

/** A service already struck by Server, judged over the touches that follow. */
function Served(Server: Side, Touches: CollisionResult[]): { Call: Point | null; Umpire: Referee } {
    const Umpire = new Referee();
    Umpire.BeginServed(Server);
    let Call: Point | null = null;
    for (const Each of Touches) Call ??= Umpire.Judge(Each, false, Step);
    return { Call, Umpire };
}

/**
 * [ITTF] 2.6.3: the served ball touches the server's court first and then the receiver's. Own
 * court then the receiver's is good, and the receiver then has a ball to return; straight onto
 * the receiver's court, or twice on the server's own, is a fault and the receiver's point.
 */
test("AServeMustBounceOnTheServersCourtFirst", () => {
    const Good = Served("Near", [OnTable(0.7), OnTable(-0.7)]);
    const Direct = Served("Near", [OnTable(-0.7)]);
    const Twice = Served("Near", [OnTable(0.9), OnTable(0.3)]);
    const FarGood = Served("Far", [OnTable(-0.7), OnTable(0.7)]);
    const FarDirect = Served("Far", [OnTable(0.7)]);
    Check(Good.Call === null && Good.Umpire.Awaiting("Far") && !Good.Umpire.InService()
          && Direct.Call?.Winner === "Far" && Direct.Call.Template.startsWith("2.6.3")
          && Twice.Call?.Winner === "Far" && Twice.Call.Template.startsWith("2.6.3")
          && FarGood.Call === null && FarGood.Umpire.Awaiting("Near") && FarDirect.Call?.Winner === "Near",
          `own court then theirs: ${Good.Call ?? "in play, the receiver to return"}; straight onto theirs: ${Direct.Call}; twice on own: ${Twice.Call}; `
          + `the far server's the same: ${FarGood.Call ?? "in play"} and ${FarDirect.Call}`);
});

/**
 * [ITTF] 2.9.1.1: a service that touches the net assembly and is otherwise correct is a let, no
 * point. One that touches the net and then misses the receiver's court is not otherwise correct:
 * a fault ([ITTF] 2.10.1.1). And once a rally is under way, a net ball stays in play.
 */
test("AServeThatTouchesTheNetAndLandsInIsALet", () => {
    const Let = Served("Near", [OnTable(0.7), OnNet, OnTable(-0.3)]);
    const Stays = Served("Near", [OnTable(0.7), OnNet, OnTable(0.2)]);
    const Off = Served("Near", [OnTable(0.7), OnNet, OnFloor(-0.5)]);
    const Rally = new Referee();
    Rally.Begin("Near");
    const InPlay = [OnNet, OnTable(-0.3)].map(Each => Rally.Judge(Each, false, Step)).find(Each => Each !== null) ?? null;
    Check(Let.Call !== null && Let.Call.Winner === null && Let.Call.Template.startsWith("2.9.1.1")
          && Stays.Call?.Winner === "Far" && Off.Call?.Winner === "Far" && InPlay === null && Rally.Awaiting("Far"),
          `net then the receiver's court: ${Let.Call}; net then back on the server's: ${Stays.Call}; net then the floor: ${Off.Call}; `
          + `a rally's net ball: ${InPlay ?? "in play"}`);
});

/** [ITTF] 2.6.4: the ball is struck from behind the server's end line. Over the table is a fault. */
test("AServeStruckOverTheTableIsAFault", () => {
    const Umpire = new Referee();
    let Ball = new BallState(new Vec3(0, 0.25, TableSpec.HalfLength - 0.2), new Vec3(0, 3, 0), Vec3.Zero);
    Umpire.BeginServe("Near", Ball);
    let Call: Point | null = null;
    for (let Steps = 0; Steps < 2 / Step && Call === null; Steps++) {
        Ball = Flight.Step(Ball, Step);
        const Strike = Ball.Velocity.Y < 0 && Ball.Position.Y <= 0.3;
        Call = Umpire.Judge(Strike ? HitBy(Ball, 0) : Flew(Ball), false, Step);
        if (Strike) break;
    }
    Check(Call !== null && Call.Winner === "Far" && Call.Template.startsWith("2.6.4"), `struck 20 cm inside the end line: ${Call}`);
});

/**
 * [ITTF] 2.13.3: the service passes to the other end after every 2 points, and after every point
 * once both have 10. The expected server is counted out here by hand: points 1-2 to the first
 * server, 3-4 to the other, and so on; from 10-all, turn about.
 */
test("ServiceChangesEveryTwoPointsAndEveryPointFromTenAll", () => {
    const Board = new Scoreboard();
    Board.SetFirstServer("Far");
    let Served = "", Wrong = 0;
    // Alternate the winners to 10-all, then on to 13-all.
    for (let Played = 0; Played < 26; Played++) {
        const Expected: Side = Played < 20
            ? (Math.floor(Played / 2) % 2 === 0 ? "Far" : "Near")
            : ((Played - 20) % 2 === 0 ? "Far" : "Near");
        const Now = Board.Server();
        if (Now !== Expected) Wrong++;
        Served += Now[0];
        Board.Award(Played % 2 === 0 ? "Near" : "Far");
    }
    Check(Wrong === 0 && Served === "FFNNFFNNFFNNFFNNFFNN" + "FNFNFN" && Board.Now().NearPoints === 13 && Board.Now().FarPoints === 13,
          `servers point by point from 0-0 to ${Board.Now().NearPoints}-${Board.Now().FarPoints}: ${Served} (${Wrong} wrong)`);
});

/** [ITTF] 2.13.6: whoever served first in a game receives first in the next, whoever won it and however many points it took. */
test("TheFirstServerAlternatesGameByGame", () => {
    const Board = new Scoreboard();
    Board.SetFirstServer("Near");
    let Firsts = "";
    const Wins: Array<[Side, number]> = [["Near", 0], ["Far", 9], ["Near", 3], ["Far", 0]];   // each game's winner and the loser's points
    for (const [Winner, LoserPoints] of Wins) {
        Firsts += Board.Server()[0];
        for (let Each = 0; Each < LoserPoints; Each++) Board.Award(Other(Winner));
        for (let Each = 0; Each < Scoreboard.GamePoints; Each++) Board.Award(Winner);
        Firsts += `(${Board.Now().NearPoints}-${Board.Now().FarPoints}, next ${Board.Server()[0]}) `;
        Board.Next();
    }
    Firsts += Board.Server()[0];
    Check(Firsts.replace(/\([^)]*\) /g, "") === "NFNFN", `first servers of five games: ${Firsts}`);
});

/** A racket that stands still out of the way: a receiver who never returns, and never serves. */
class Bystander implements RacketAgent {
    Follow(): void {}
    Pose(): RacketPose { return new RacketPose(new Vec3(2.2, 0.2, -2.2), new Vec3(0, 0, 1), 0); }
}

/** A Coin that deals Values in turn, then its last for ever. */
const Dealt = (...Values: number[]) => { let At = 0; return () => Values[Math.min(At++, Values.length - 1)]; };

const Parked = () => new CursorFollower(new Vec3(ReachEnvelope.MaxX, 0, ReachEnvelope.ZFar));

/**
 * The game's own toss, flown by the engine: it leaves the hand behind the end line and above the
 * table ([ITTF] 2.6.4), straight up and without spin, and rises well over 16 cm ([ITTF] 2.6.2):
 * no more than v²/2g for the speed it left at, and within 5 cm of it, the less being the air's drag.
 */
test("TheGamesTossRisesOverSixteenCentimetresFromBehindTheEndLine", () => {
    const Game = new Rally(Parked(), new Bystander(), false, Dealt(0));   // the lot: Near serves
    Game.SetServing(true);
    Game.FeedNow();
    const Waiting = Game.AwaitingToss() && Game.Server() === "Near";
    const Hand = Game.View().Ball;
    expect(Game.Toss(), "the toss was refused").toBe(true);
    const Left = Game.View().Ball;
    let Peak = Left.Position.Y, Sideways = 0;
    for (let Steps = 0; Steps < 1 / Step && Game.View().Ball.Velocity.Y >= 0; Steps++) {
        Game.Step();
        const Ball = Game.View().Ball;
        Peak = Math.max(Peak, Ball.Position.Y);
        Sideways = Math.max(Sideways, Math.hypot(Ball.Position.X - Left.Position.X, Ball.Position.Z - Left.Position.Z));
    }
    const Rose = Peak - Left.Position.Y, ClosedForm = Left.Velocity.Y ** 2 / (2 * -Air.Gravity.Y);
    Check(Waiting && Hand.Velocity.IsZero() && Hand.Position.Z > TableSpec.HalfLength && Hand.Position.Y > 0
          && Rose >= Referee.LeastToss && Math.abs(Rose - ClosedForm) < 0.05 && Rose <= ClosedForm && Sideways < 1e-9 && Left.Spin.IsZero()
          && !Game.Toss(),
          `held at ${Hand.Position}; tossed at ${F(Left.Velocity.Y, 3)} m/s, rose ${F(Rose * 100, 1)} cm (v²/2g ${F(ClosedForm * 100, 1)} cm, the law's least 16), `
          + `${Sideways.toExponential(1)} m sideways; a second toss in the air was refused`);
});

/**
 * Every one of the computer's serves, played through the Rally and judged by the Referee, is a
 * correct service ([ITTF] 2.6): tossed at least 16 cm, struck behind the end line, the server's
 * court first, then the player's, the net untouched. With the player's racket out of the way each
 * ends as the computer's point for a ball not returned (2.10.1.2), never as a fault or a let.
 */
test("TheComputersServesAreAllCorrectServices", () => {
    let Measured = "";
    let AllRight = true;
    Serves.Presets.forEach((Each, Index) => {
        // The lot gives the computer the serve (0.9), then the draw picks this preset.
        const Game = new Rally(Parked(), undefined, false, Dealt(0.9, (Index + 0.5) / Serves.Presets.length));
        Game.SetServing(true);
        Game.FeedNow();
        const Held = Game.View().Ball.Position;
        let Peak = Held.Y, Net = false, StruckAt: Vec3 | null = null;
        const Bounces: Vec3[] = [];
        for (let Steps = 0; Steps < 6 / Step && Game.LastPoint() === null; Steps++) {
            Game.Step();
            const Last = Game.LastStep(), At = Game.View().Ball.Position;
            if (StruckAt === null) Peak = Math.max(Peak, At.Y);
            if (Last.Racket === Rally.OpponentRacket && StruckAt === null) StruckAt = At;
            Net ||= Last.Net;
            if (Last.Table) Bounces.push(At);
        }
        const Call = Game.LastPoint();
        const Right = Game.Server() === "Far" && Game.ComputerServe() === Each.Name && StruckAt !== null
            && Peak - Held.Y >= Referee.LeastToss && StruckAt.Z < -TableSpec.HalfLength && StruckAt.Y > 0
            && !Net && Bounces.length >= 2 && Bounces[0].Z < 0 && Bounces[1].Z > 0
            && Bounces[1].Minus(Each.Lands).Length() < 0.05
            && Call !== null && Call.Winner === "Far" && Call.Template.startsWith("2.10.1.2");
        AllRight &&= Right;
        Measured += `${Each.Name}: tossed ${F((Peak - Held.Y) * 100, 0)} cm, struck at z ${StruckAt === null ? "never" : F(StruckAt.Z, 2)}, `
                  + `bounced at z ${Bounces.slice(0, 2).map(B => F(B.Z, 2)).join(" then ")} (aimed ${F(Each.Lands.Z, 2)})${Net ? ", touched the net" : ""}; ${Call}\n`;
    });
    Check(AllRight, Measured);
});

/**
 * One scripted serve by the player: the racket waits behind the ball, the ball is tossed, and once
 * it has fallen to FromHeight the racket is pushed forward through it at Push m/s, the A/D aim
 * held at Tilt. Returns where the struck serve went.
 */
function PlayerServes(Push: number, FromHeight: number, Tilt: number, Across: number, Assist: boolean):
    { Struck: BallState | null; Bounces: Vec3[]; Net: boolean; Call: Point | null } {
    const Hand = new CursorFollower(new Vec3(Across, 0, 1.95));
    const Game = new Rally(Hand, new Bystander(), false, Dealt(0));
    Game.SetServing(true);
    Game.SetShotAssist(Assist);
    Hand.SetFaceTilt(0, Tilt);
    Game.FeedNow();
    for (let Settle = 0; Settle < 0.2 / Step; Settle++) Game.Step();
    Game.Toss();
    let AimZ = 1.95, Net = false;
    let Struck: BallState | null = null;
    const Bounces: Vec3[] = [];
    for (let Steps = 0; Steps < 5 / Step && Game.LastPoint() === null; Steps++) {
        const Ball = Game.View().Ball;
        if (Struck === null && Ball.Velocity.Y < 0 && Ball.Position.Y <= FromHeight) AimZ = Math.max(ReachEnvelope.ZNear, AimZ - Push * Step);
        Hand.AimAt(new Vec3(Across, 0, AimZ));
        Game.Step();
        const Last = Game.LastStep();
        if (Last.Racket === Rally.PlayerRacket && Struck === null) Struck = Game.View().Ball;
        Net ||= Last.Net;
        if (Last.Table) Bounces.push(Game.View().Ball.Position);
    }
    return { Struck, Bounces, Net, Call: Game.LastPoint() };
}

/**
 * The serve assist, as the owner's spec checks it ("20 random serves never miss bounce 1, and weak
 * serves fault"): over twenty different serves, soft to hard, struck high and low, aimed left,
 * straight and right (each from the side that keeps the aim on the table), every serve the racket strikes makes its first bounce on
 * the server's own court ([ITTF] 2.6.3), inside the assist's zone (5 cm in from the end line and
 * the net). Nothing sees it over the net: some are faults all the same, and the hardest go long.
 */
test("TheServeAssistKeepsThePlayersFirstBounceOnTheirOwnCourt", () => {
    let Measured = "";
    let StruckCount = 0, FirstOnOwn = 0, Good = 0, Faults = 0;
    for (const Push of [1.5, 2.5, 3.5, 4.5, 6])
        for (const [FromHeight, Tilt] of [[0.70, 0], [0.60, -1], [0.50, 1], [0.42, 0]]) {
            const Played = PlayerServes(Push, FromHeight, Tilt, -0.4 * Tilt, true);
            if (Played.Struck === null) { Measured += `push ${F(Push, 1)} from ${F(FromHeight, 2)} m: not struck; `; continue; }
            StruckCount++;
            const First = Played.Bounces[0];
            const OnOwn = First !== undefined && First.Z >= 0.05 - 1e-6 && First.Z <= TableSpec.HalfLength - 0.05 + 1e-6 && Math.abs(First.X) <= TableSpec.HalfWidth;
            FirstOnOwn += OnOwn ? 1 : 0;
            const In = Played.Call !== null && !Played.Call.Template.includes("2.10.1.1") && Played.Call.Winner !== null;
            Good += In ? 1 : 0;
            Faults += In ? 0 : 1;
            Measured += `push ${F(Push, 1)} from ${F(FromHeight, 2)} m, aim ${Tilt}: bounces at z ${Played.Bounces.slice(0, 2).map(B => F(B.Z, 2)).join(" then ")}`
                      + `${Played.Net ? " (net)" : ""}, ${In ? "in" : "fault or let"}; `;
        }
    Measured += `\n${StruckCount} of 20 struck; first bounce on the server's court for ${FirstOnOwn}; ${Good} good serves, ${Faults} not`;
    Check(StruckCount >= 15 && FirstOnOwn === StruckCount && Good >= 5 && Faults >= 1, Measured);
});

/**
 * ServeAssist by itself: a struck ball that would fly straight onto the far court, or drop off
 * the server's end, is bent, by its vertical speed alone, to bounce first within the server's
 * half; its forward speed and spin are untouched, and a ball already landing there is left as is.
 */
test("TheServeAssistChangesOnlyTheVerticalSpeed", () => {
    const From = new Vec3(0.1, 0.3, 1.6);
    const Long = new BallState(From, new Vec3(-0.3, 2.0, -5.5), new Vec3(-60, 0, 20));
    const Fixed = ServeAssist.Correct(Long, "Near", Step);
    const Landing = (Ball: BallState) => {
        for (let Steps = 0; Steps < 3 / Step; Steps++) {
            const Next = Collisions.Resolve(Ball, Flight.Step(Ball, Step), Step, []);
            Ball = Next.Ball;
            if (Next.Table || Next.Floor) return Ball.Position;
        }
        return Ball.Position;
    };
    const Before = Landing(Long), After = Landing(Fixed);
    const Already = new BallState(From, new Vec3(0, -1.5, -5), Vec3.Zero);
    Check(Before.Z < 0 && After.Z > 0.05 && After.Z < TableSpec.HalfLength - 0.05
          && Fixed.Velocity.X === Long.Velocity.X && Fixed.Velocity.Z === Long.Velocity.Z && Fixed.Spin === Long.Spin
          && Fixed.Velocity.Y !== Long.Velocity.Y && ServeAssist.Correct(Already, "Near", Step) === Already,
          `uncorrected it first lands at z ${F(Before.Z, 2)}; corrected, at z ${F(After.Z, 2)}, vertical speed ${F(Long.Velocity.Y, 2)} -> ${F(Fixed.Velocity.Y, 2)} m/s, `
          + `forward speed and spin unchanged; a serve already landing at z ${F(Landing(Already).Z, 2)} is left alone`);
});

/**
 * With the shot assist off ("?assist=off") the serve assist is off with it: the same swing leaves
 * the racket as the engine's contact alone, not as the aimed serve.
 */
test("WithTheAssistOffTheServeIsTheContactsAlone", () => {
    const On = PlayerServes(3.5, 0.60, 0, 0, true), Off = PlayerServes(3.5, 0.60, 0, 0, false);
    expect(On.Struck !== null && Off.Struck !== null, "a serve was not struck").toBe(true);
    const Pace = (Ball: BallState) => Math.hypot(Ball.Velocity.X, Ball.Velocity.Z);
    Check(Math.abs(Pace(On.Struck!) - Pace(Off.Struck!)) > 0.5,
          `assist on: leaves at ${On.Struck!.Velocity} and bounces at z ${On.Bounces.slice(0, 2).map(B => F(B.Z, 2)).join(" then ")}; `
          + `assist off: leaves at ${Off.Struck!.Velocity}, ${Off.Call}`);
});

/**
 * A whole run of served points through the Rally: the player tosses every serve of theirs and
 * never strikes it (a fault each time), and never returns the computer's. Each rally's server is
 * the one [ITTF] 2.13.3 gives for the points played so far, 2 each in turn, from the lot's choice;
 * and each fault is the receiver's point ([ITTF] 2.10.1.1).
 */
test("InPlayTheServeChangesEndsEveryTwoPoints", () => {
    const Game = new Rally(Parked(), undefined, false, Dealt(0, 0.1));   // the lot: Near serves first
    Game.SetServing(true);
    let Served = "", Wrong = 0, Points = 0;
    let Seen: Point | null = null;
    let Counted = false;
    for (let Steps = 0; Steps < 90 / Step && Points < 10; Steps++) {
        if (Game.AwaitingToss() || Game.AwaitingTheirToss()) {
            if (!Counted) {
                const Expected: Side = Math.floor(Points / 2) % 2 === 0 ? "Near" : "Far";
                if (Game.Server() !== Expected) Wrong++;
                Served += Game.Server()![0];
                Counted = true;
            }
            Game.Toss();
        }
        Game.Step();
        if (Game.LastPoint() !== Seen) {
            Seen = Game.LastPoint();
            if (Seen!.Winner !== "Far") Wrong++;
            Points++;
            Counted = false;
        }
    }
    Check(Points === 10 && Wrong === 0 && Served === "NNFFNNFFNN" && Game.Score().FarPoints === 10,
          `servers of ten points: ${Served}; every point the computer's, score ${Game.Score()}; last: ${Seen}`);
});

/** With serving off, a new Rally feeds the drills as it always has: no one is serving and there is nothing to toss. */
test("WithServingOffTheBallIsFed", () => {
    const Game = new Rally(Parked());
    Game.FeedNow();
    for (let Steps = 0; Steps < 20; Steps++) Game.Step();
    const Ball = Game.View().Ball;
    Check(!Game.Serving() && Game.Server() === null && !Game.AwaitingToss() && !Game.Toss() && Ball.Velocity.Z > 4,
          `serving ${Game.Serving()}, server ${Game.Server()}; the fed ball is moving ${Ball.Velocity}`);
});
