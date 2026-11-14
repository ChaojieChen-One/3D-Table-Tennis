import { Point } from "../../game/Referee";
import { Score } from "../../game/Scoreboard";
import { Other, Side, SideNames } from "../../game/Side";
import { Make, Replay } from "./Dom";
import { GameNumber } from "./ScoreTags";

/**
 * The umpire's calls as broadcast graphics. A point is a banner across the lower third: who won
 * it, and the reason beneath in small type. A game or a match is a band swept across the whole
 * width with its score. Each leaves by itself, or at once when the next ball is put in play.
 */
export class Announcer {
    /** TUNED: how long a point's banner stays, real ms: long enough to read the reason, gone before the next feed matters. */
    private static readonly BannerFor = 2600;

    /** TUNED: how long a game's or a match's band stays, real ms. */
    private static readonly SweepFor = 3400;

    readonly Root = Make("div", "announce");
    private readonly Banner = Make("div", "call");
    private readonly Head = Make("div", "call-head");
    private readonly Why = Make("div", "call-why");
    private readonly Sweep = Make("div", "sweep");
    private readonly SweepKicker = Make("div", "sweep-kicker");
    private readonly SweepHead = Make("div", "sweep-head");
    private readonly SweepScore = Make("div", "sweep-score");
    private Leaving = 0;

    constructor() {
        this.Banner.append(this.Head, this.Why);
        const Inner = Make("div", "sweep-inner");
        Inner.append(this.SweepKicker, this.SweepHead, this.SweepScore);
        this.Sweep.append(Inner);
        this.Banner.hidden = this.Sweep.hidden = true;
        // The calls are spoken to a screen reader as they appear.
        this.Root.setAttribute("aria-live", "polite");
        this.Root.append(this.Banner, this.Sweep);
    }

    /** Shows Called, with the score Now after it, naming the ends by Badges (on screen) and Names (in the reason). */
    Call(Called: Point, Now: Score, Badges: SideNames, Names: SideNames): void {
        this.Clear();
        if (Now.GameWinner !== null) this.ShowSweep(Now, Badges);
        else this.ShowBanner(Called, Badges, Names);
    }

    /** Takes whatever is up away: at once if Now, else with its leaving motion. */
    Clear(Now = true): void {
        window.clearTimeout(this.Leaving);
        if (Now) { this.Banner.hidden = this.Sweep.hidden = true; return; }
        for (const Each of [this.Banner, this.Sweep]) {
            if (Each.hidden) continue;
            Each.classList.add("leaving");
            this.Leaving = window.setTimeout(() => { Each.hidden = true; }, 320);
        }
    }

    private ShowBanner(Called: Point, Badges: SideNames, Names: SideNames): void {
        // The law's number is the umpire's business; the reason reads better without it.
        const Why = Called.Reason(Names).replace(/^[0-9.]+: /, "");
        this.Head.replaceChildren();
        if (Called.Winner === null) {
            this.Head.append(Make("span", "call-word", "LET"));
        } else {
            this.Head.append(Make("span", "call-word", "POINT"), Make("span", "call-dot", "·"), Make("span", "call-who", Badges[Called.Winner]));
        }
        this.Banner.dataset.side = Called.Winner ?? "none";
        this.Why.textContent = Why.charAt(0).toUpperCase() + Why.slice(1);
        this.Present(this.Banner, Announcer.BannerFor);
    }

    private ShowSweep(Now: Score, Badges: SideNames): void {
        const Winner = Now.GameWinner as Side, Match = Now.MatchWinner !== null;
        this.Sweep.dataset.side = Winner;
        this.Sweep.dataset.kind = Match ? "match" : "game";
        this.SweepKicker.textContent = Match ? `GAMES  ${Now.Games(Winner)}–${Now.Games(Other(Winner))}` : `GAME ${GameNumber(Now)}`;
        this.SweepHead.replaceChildren(Make("span", "", Match ? "MATCH" : "GAME"), Make("span", "call-dot", "·"), Make("span", "call-who", Badges[Winner]));
        this.SweepScore.textContent = `${Now.NearPoints}–${Now.FarPoints}`;
        this.Present(this.Sweep, Announcer.SweepFor);
    }

    private Present(Shown: HTMLElement, For: number): void {
        Shown.hidden = false;
        Shown.classList.remove("leaving");
        Replay(Shown, "entering");
        this.Leaving = window.setTimeout(() => this.Clear(false), For);
    }
}
