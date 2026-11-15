import { Other, Side } from "./Side";

/**
 * The score now. GameWinner is who has just won a game and MatchWinner who has just won the
 * match; both are null while a game is in progress.
 */
export class Score {
    constructor(readonly NearPoints: number, readonly FarPoints: number,
                readonly NearGames: number, readonly FarGames: number,
                readonly GameWinner: Side | null, readonly MatchWinner: Side | null) {}

    Points(Of: Side): number { return Of === "Near" ? this.NearPoints : this.FarPoints; }

    Games(Of: Side): number { return Of === "Near" ? this.NearGames : this.FarGames; }

    Equals(Other: Score): boolean {
        return this.NearPoints === Other.NearPoints && this.FarPoints === Other.FarPoints
            && this.NearGames === Other.NearGames && this.FarGames === Other.FarGames
            && this.GameWinner === Other.GameWinner && this.MatchWinner === Other.MatchWinner;
    }

    toString(): string {
        return `${this.NearPoints}-${this.FarPoints} (games ${this.NearGames}-${this.FarGames}`
            + (this.GameWinner ? `, game to ${this.GameWinner}` : "") + (this.MatchWinner ? `, match to ${this.MatchWinner}` : "") + ")";
    }

    /** The same score seen from the other end of the table. */
    Mirrored(): Score {
        const Flip = (S: Side | null): Side | null => S === null ? null : S === "Near" ? "Far" : "Near";
        return new Score(this.FarPoints, this.NearPoints, this.FarGames, this.NearGames, Flip(this.GameWinner), Flip(this.MatchWinner));
    }
}

/**
 * The score under the ITTF Laws of Table Tennis. A game is won by the first to 11 points, unless
 * both reach 10, when it is won by the first to lead by 2 (2.11.1). A match is the best of an odd
 * number of games (2.12.1), five here. A finished game's score stands until the next rally begins
 * (Next), so it can be read; a finished match's likewise, and then a new match starts from love-all.
 * The score is kept by end, so a doubles pair shares one.
 *
 * It also keeps the order of service (2.13): who serves first is drawn by lot (2.13.1, the caller's
 * draw, SetFirstServer); the service changes ends after every 2 points, and after every point once
 * both have reached 10 (2.13.3); and whoever served first in a game receives first in the next
 * (2.13.6). The players do not change ends between games (2.13.7): Near is always this machine's.
 */
export class Scoreboard {
    /** [ITTF] 2.11.1: the points that win a game. */
    static readonly GamePoints = 11;
    /** [ITTF] 2.11.1: the lead needed once both have reached GamePoints - 1. */
    static readonly Lead = 2;

    /** A match is the best of this many games ([ITTF] 2.12.1 allows any odd number); the first to win more than half wins it. */
    static readonly BestOf = 5;

    private NearPoints = 0;
    private FarPoints = 0;
    private NearGames = 0;
    private FarGames = 0;
    private GameWinner: Side | null = null;
    private MatchWinner: Side | null = null;

    /** Who serves first in the match's first game; [ITTF] 2.13.1 leaves it to a lot, which the caller draws. */
    private FirstServer: Side = "Near";

    /** [ITTF] 2.13.3: the points each end serves in turn, until both reach GamePoints - 1. */
    static readonly ServesEach = 2;

    /** The end that serves first in the match's first game. Meant for love-all at the start of a match. */
    SetFirstServer(First: Side): void { this.FirstServer = First; }

    /**
     * Whose serve the next rally is. [ITTF] 2.13.3: the service passes to the receiver after each
     * ServesEach points, and after each single point once both ends have GamePoints - 1. [ITTF]
     * 2.13.6: the first server of a game receives first in the next. While a won game stands on the
     * board, this is already the next game's first server.
     */
    Server(): Side {
        const Games = this.MatchWinner !== null ? 0 : this.NearGames + this.FarGames;
        const First = Games % 2 === 0 ? this.FirstServer : Other(this.FirstServer);
        if (this.GameWinner !== null) return First;
        const Played = this.NearPoints + this.FarPoints;
        const Deuce = Scoreboard.GamePoints - 1;
        const Turns = this.NearPoints >= Deuce && this.FarPoints >= Deuce
            ? (2 * Deuce) / Scoreboard.ServesEach + (Played - 2 * Deuce)
            : Math.floor(Played / Scoreboard.ServesEach);
        return Turns % 2 === 0 ? First : Other(First);
    }

    /** A point to Winner; null is a let and changes nothing. Ignored once a game is won, until Next. */
    Award(Winner: Side | null): void {
        if (Winner === null || this.GameWinner !== null) return;
        if (Winner === "Near") this.NearPoints++; else this.FarPoints++;
        const Mine = Winner === "Near" ? this.NearPoints : this.FarPoints;
        const Theirs = Winner === "Near" ? this.FarPoints : this.NearPoints;
        if (Mine >= Scoreboard.GamePoints && Mine - Theirs >= Scoreboard.Lead) {
            this.GameWinner = Winner;
            if (Winner === "Near") this.NearGames++; else this.FarGames++;
            if ((Winner === "Near" ? this.NearGames : this.FarGames) > Math.floor(Scoreboard.BestOf / 2)) this.MatchWinner = Winner;
        }
    }

    /** Before the next rally: after a won game the points go back to love-all, and after a won match the games too. */
    Next(): void {
        if (this.GameWinner === null) return;
        if (this.MatchWinner !== null) this.NearGames = this.FarGames = 0;
        this.NearPoints = this.FarPoints = 0;
        this.GameWinner = this.MatchWinner = null;
    }

    Now(): Score {
        return new Score(this.NearPoints, this.FarPoints, this.NearGames, this.FarGames, this.GameWinner, this.MatchWinner);
    }
}
