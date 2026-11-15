import { Score, Scoreboard } from "../../game/Scoreboard";
import { Other, Side } from "../../game/Side";

/**
 * What a score means beyond its numbers, as a broadcast scoreboard tags it: deuce, game point,
 * match point, or a game or match just won. All of it follows from [ITTF] 2.11.1 and 2.12.1 as
 * Scoreboard keeps them: a game to 11, by 2 from 10-all, a match the best of five.
 */
export type ScoreTag =
    | { readonly Kind: "None" | "Deuce" }
    | { readonly Kind: "GamePoint" | "MatchPoint" | "Game" | "Match"; readonly For: Side };

/** Games that win the match: more than half of BestOf. */
export const GamesToWin = Math.floor(Scoreboard.BestOf / 2) + 1;

/** The end that wins the game with the next point, or null. */
function OnePointFromGame(Now: Score): Side | null {
    for (const Each of ["Near", "Far"] as Side[]) {
        const Mine = Now.Points(Each), Theirs = Now.Points(Other(Each));
        if (Mine + 1 >= Scoreboard.GamePoints && Mine + 1 - Theirs >= Scoreboard.Lead) return Each;
    }
    return null;
}

export function TagOf(Now: Score): ScoreTag {
    if (Now.MatchWinner !== null) return { Kind: "Match", For: Now.MatchWinner };
    if (Now.GameWinner !== null) return { Kind: "Game", For: Now.GameWinner };
    const Close = OnePointFromGame(Now);
    if (Close !== null) return { Kind: Now.Games(Close) + 1 >= GamesToWin ? "MatchPoint" : "GamePoint", For: Close };
    const Level = Scoreboard.GamePoints - 1;
    if (Now.NearPoints >= Level && Now.NearPoints === Now.FarPoints) return { Kind: "Deuce" };
    return { Kind: "None" };
}

/** The game being played, counted from 1 (a game just won is still that game). */
export function GameNumber(Now: Score): number {
    return Now.NearGames + Now.FarGames + (Now.GameWinner === null ? 1 : 0);
}

export const ScoreTags = { TagOf, GameNumber, GamesToWin } as const;
