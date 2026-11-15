import { Icon, Make } from "./Dom";

/** The spin as SpinLine words it, read back into numbers: rev/s of topspin (backspin negative) and of sidespin, positive curving right on screen. */
export function ReadSpin(Line: string): { Top: number; Side: number } {
    const Top = /(topspin|backspin) (\d+)/.exec(Line), Side = /sidespin (\d+) rev\/s, curving (right|left)/.exec(Line);
    return {
        Top: Top === null ? 0 : Number(Top[2]) * (Top[1] === "topspin" ? 1 : -1),
        Side: Side === null ? 0 : Number(Side[1]) * (Side[2] === "right" ? 1 : -1),
    };
}

/**
 * The ball's spin as a compact gauge: an arrow on a ball that points the way the spin carries it
 * (up the table for topspin, back for backspin, left or right for sidespin), the rev/s beside it,
 * and the spin's name. With no spin the arrow goes and the gauge dims.
 */
export class SpinGauge {
    readonly Root = Make("div", "chip gauge");
    private readonly Arrow = Make("span", "gauge-arrow");
    private readonly Value = Make("span", "chip-value", "0");
    private readonly Name = Make("span", "chip-note", "NO SPIN");
    private Shown = "";

    constructor() {
        const Ball = Make("span", "gauge-ball");
        this.Arrow.append(Icon("M12 19V5M6 11l6-6 6 6"));
        Ball.append(this.Arrow);
        const Words = Make("span", "chip-words");
        const Top = Make("span", "chip-top");
        Top.append(this.Value, Make("span", "chip-unit", "REV/S"));
        Words.append(Make("span", "chip-label", "SPIN"), Top, this.Name);
        this.Root.append(Ball, Words);
        this.Root.classList.add("idle");
    }

    /** Line is SpinLine.Describe's; called every frame, so nothing is touched unless the words changed. */
    Show(Line: string): void {
        if (Line === this.Shown) return;
        this.Shown = Line;
        const { Top, Side } = ReadSpin(Line), Revs = Math.hypot(Top, Side);
        this.Root.classList.toggle("idle", Revs === 0);
        this.Value.textContent = Revs.toFixed(0);
        // Up the screen is up the table: the arrow turns from there toward the side the ball curves to.
        this.Arrow.style.transform = `rotate(${(Math.atan2(Side, Top) * 180 / Math.PI).toFixed(0)}deg)`;
        const Names: string[] = [];
        if (Top !== 0) Names.push(Top > 0 ? "TOPSPIN" : "BACKSPIN");
        if (Side !== 0) Names.push(Side > 0 ? "SIDE RIGHT" : "SIDE LEFT");
        this.Name.textContent = Names.length === 0 ? "NO SPIN" : Names.join(" + ");
    }
}
