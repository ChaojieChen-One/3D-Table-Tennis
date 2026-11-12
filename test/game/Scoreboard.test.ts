import { expect, test } from "vitest";
import { Vec3 } from "../../src/engine/math/Vec3";
import { CursorFollower } from "../../src/game/control/CursorFollower";
import { ReachEnvelope } from "../../src/game/control/ReachEnvelope";
import { FixedClock } from "../../src/game/FixedClock";
import { Rally } from "../../src/game/Rally";
import { Point } from "../../src/game/Referee";
import { Scoreboard } from "../../src/game/Scoreboard";
import { Side } from "../../src/game/Side";
import { Check } from "../Measure";

/** Awards Points points to Winner. */
function Win(Board: Scoreboard, Winner: Side, Points: number): void {
    for (let Each = 0; Each < Points; Each++) Board.Award(Winner);
}

/** [ITTF] 2.11.1: 11 points win a game when the other player has 9 or fewer. */
test("ElevenPointsWinAGame", () => {
    const Board = new Scoreboard();
    Win(Board, "Far", 9);
    Win(Board, "Near", 10);
    const Before = Board.Now();
    Board.Award("Near");
    const After = Board.Now();
    Check(Before.GameWinner === null && After.GameWinner === "Near" && After.NearGames === 1
          && After.NearPoints === 11 && After.FarPoints === 9, `at 10-9 ${Before}, then ${After}`);
});

/** [ITTF] 2.11.1: from 10-all the game goes on until one player leads by 2. */
test("FromTenAllAGameNeedsALeadOfTwo", () => {
    const Board = new Scoreboard();
    Win(Board, "Near", 10);
    Win(Board, "Far", 10);
    Board.Award("Near");                       // 11-10: not yet
    const Advantage = Board.Now();
    Board.Award("Far");                        // 11-11
    Win(Board, "Far", 2);                      // 11-13: won
    const Won = Board.Now();
    Check(Advantage.GameWinner === null && Won.GameWinner === "Far" && Won.FarPoints === 13 && Won.NearPoints === 11,
          `at 11-10 ${Advantage}; at 11-13 ${Won}`);
});

/** A let scores nothing ([ITTF] 2.9); a won game's score stands until the next rally, then play restarts from love-all. */
test("LetsScoreNothingAndTheNextGameStartsFromLoveAll", () => {
    const Board = new Scoreboard();
    Board.Award(null);
    const AfterLet = Board.Now();
    Win(Board, "Near", 11);
    Board.Award("Far");                        // after the game is won: no effect
    const Stands = Board.Now();
    Board.Next();
    const Next = Board.Now();
    Check(AfterLet.Equals(new Scoreboard().Now()) && Stands.NearPoints === 11 && Stands.FarPoints === 0
          && Next.NearPoints === 0 && Next.FarPoints === 0 && Next.NearGames === 1 && Next.GameWinner === null,
          `after a let ${AfterLet}; won ${Stands}; next ${Next}`);
});

/** [ITTF] 2.12.1: a match is the best of an odd number of games; here five, so three games win it, then a new match begins. */
test("ThreeGamesWinTheMatch", () => {
    const Board = new Scoreboard();
    let Measured = "";
    const Games: Side[] = ["Near", "Far", "Near", "Far", "Near"];
    for (let Game = 0; Game < Games.length; Game++) {
        Win(Board, Games[Game], 11);
        Measured += Board.Now() + "; ";
        const Last = Game === Games.length - 1;
        expect(Board.Now().MatchWinner, Measured).toBe(Last ? "Near" : null);
        Board.Next();
    }
    Measured += "then " + Board.Now();
    Check(Board.Now().Equals(new Scoreboard().Now()), Measured);
});

/**
 * In play, every point the Referee decides is scored: unreturned feeds are all the computer's
 * points, so it takes each game 11-0 and the next game's points carry on the count.
 */
test("ARallysPointsAreScored", () => {
    const Game = new Rally(new CursorFollower(new Vec3(ReachEnvelope.MaxX, 0, ReachEnvelope.ZFar)));
    let Seen: Point | null = null;
    let Decided = 0;
    for (let Step = 0; Step < FixedClock.StepsPerSecond * 30; Step++) {
        Game.Step();
        if (Game.LastPoint() !== Seen) {
            Seen = Game.LastPoint();
            if (Seen!.Winner !== null) Decided++;
        }
    }
    const Now = Game.Score();
    Check(Decided > Scoreboard.GamePoints && Now.FarGames * Scoreboard.GamePoints + Now.FarPoints === Decided
          && Now.NearPoints === 0 && Now.NearGames === 0, `${Decided} points decided; score ${Now}`);
});
