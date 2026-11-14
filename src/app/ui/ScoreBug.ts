import { Score } from "../../game/Scoreboard";
import { Side, SideNames } from "../../game/Side";
import { Make, Replay } from "./Dom";
import { GameNumber, GamesToWin, TagOf } from "./ScoreTags";

interface Row { Line: HTMLElement; Name: HTMLElement; Pips: HTMLElement[]; Points: HTMLElement; Serve: HTMLElement; }

/**
 * The scoreboard as a broadcast shows it: one row per end, in that end's colour, with the games
 * won as pips, the points as big numerals that tick over when they change, a ball beside whoever
 * serves, and under them a strip that says what the score means: deuce, game point, match point.
 */
export class ScoreBug {
    readonly Root = Make("div", "bug");
    private readonly Rows: Record<Side, Row>;
    private readonly Tag = Make("div", "bug-tag");
    private Badges: SideNames = { Near: "YOU", Far: "CPU" };
    private Shown: Score | null = null;

    constructor() {
        const Build = (Of: Side): Row => {
            const Line = Make("div", `bug-row bug-${Of.toLowerCase()}`);
            const Serve = Make("span", "bug-serve");
            Serve.hidden = true;
            const Name = Make("span", "bug-name");
            const Games = Make("span", "bug-games");
            const Pips = Array.from({ length: GamesToWin }, () => Make("span", "bug-pip"));
            Games.append(...Pips);
            const Points = Make("span", "bug-points");
            Points.append(Make("span", "bug-digit", "0"));
            Line.append(Name, Serve, Games, Points);
            return { Line, Name, Pips, Points, Serve };
        };
        this.Rows = { Near: Build("Near"), Far: Build("Far") };
        const Board = Make("div", "bug-board");
        Board.append(this.Rows.Near.Line, this.Rows.Far.Line);
        this.Root.append(Board, this.Tag);
        this.Root.setAttribute("role", "status");
        this.SetBadges(this.Badges);
    }

    SetBadges(Badges: SideNames): void {
        this.Badges = Badges;
        this.Rows.Near.Name.textContent = Badges.Near;
        this.Rows.Far.Name.textContent = Badges.Far;
        if (this.Shown !== null) this.Tell(this.Shown);
    }

    /** The ball beside whoever serves; null hides it (there are no serves yet). */
    SetServer(Server: Side | null): void {
        this.Rows.Near.Serve.hidden = Server !== "Near";
        this.Rows.Far.Serve.hidden = Server !== "Far";
    }

    Show(Now: Score): void {
        const Was = this.Shown;
        this.Shown = Now;
        for (const Each of ["Near", "Far"] as Side[]) {
            const Mine = this.Rows[Each];
            Mine.Pips.forEach((Pip, Index) => Pip.classList.toggle("on", Index < Now.Games(Each)));
            const Points = String(Now.Points(Each)), Old = Mine.Points.firstElementChild as HTMLElement;
            if (Old.textContent === Points) continue;
            // The new numeral rides up into place; only a point just won (not a reset to love-all) flashes the row.
            const Fresh = Make("span", "bug-digit", Points);
            Mine.Points.replaceChildren(Fresh);
            if (Was !== null) {
                Fresh.classList.add("tick");
                if (Now.Points(Each) > Was.Points(Each)) Replay(Mine.Line, "scored");
            }
        }
        this.Tell(Now);
    }

    private Tell(Now: Score): void {
        const Tag = TagOf(Now);
        let Line = `GAME ${GameNumber(Now)}  ·  BEST OF 5`;
        if (Tag.Kind === "Deuce") Line = "DEUCE";
        else if (Tag.Kind === "GamePoint") Line = `GAME POINT  ·  ${this.Badges[Tag.For]}`;
        else if (Tag.Kind === "MatchPoint") Line = `MATCH POINT  ·  ${this.Badges[Tag.For]}`;
        else if (Tag.Kind === "Game") Line = `GAME  ·  ${this.Badges[Tag.For]}`;
        else if (Tag.Kind === "Match") Line = `MATCH  ·  ${this.Badges[Tag.For]}`;
        if (this.Tag.textContent !== Line) {
            this.Tag.textContent = Line;
            this.Tag.dataset.kind = Tag.Kind;
            if (Tag.Kind !== "None") Replay(this.Tag, "changed");
        }
        this.Root.setAttribute("aria-label",
            `You: ${Now.NearGames} games, ${Now.NearPoints} points. Opponent: ${Now.FarGames} games, ${Now.FarPoints} points.`
            + (Tag.Kind === "None" ? "" : ` ${Line.replace(/\s+·\s+/, ", ")}.`));
    }
}
