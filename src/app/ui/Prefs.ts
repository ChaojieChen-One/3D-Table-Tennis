/**
 * What the player chose in Settings, kept between visits in localStorage: the three volumes, mute,
 * the graphics quality and the opponent's level. The sound engine and the menus both read it and
 * hear of changes, so neither needs to know the other.
 */

export const Qualities = ["Low", "Medium", "High", "Ultra"] as const;
export type Quality = typeof Qualities[number];

export const Levels = ["Rookie", "Club", "Pro", "Champion"] as const;
export type Level = typeof Levels[number];

export interface Chosen {
    /** Volumes, 0 to 1, as the sliders show them. */
    Master: number;
    Effects: number;
    Crowd: number;
    Muted: boolean;
    Quality: Quality;
    Level: Level;
}

/**
 * TUNED: the volumes at first launch. The crowd is kept well under the ball, so the rally is what
 * is heard and the hall only surrounds it.
 */
const Defaults: Chosen = { Master: 0.8, Effects: 0.9, Crowd: 0.45, Muted: false, Quality: "High", Level: "Club" };

const Key = "tableTennisPrefs";

function Stored(): Partial<Chosen> {
    try {
        if (typeof localStorage === "undefined") return {};
        const Parsed: unknown = JSON.parse(localStorage.getItem(Key) ?? "{}");
        return typeof Parsed === "object" && Parsed !== null ? Parsed as Partial<Chosen> : {};
    } catch { return {}; }
}

function Volume(Value: unknown, Fallback: number): number {
    return typeof Value === "number" && Number.isFinite(Value) ? Math.max(0, Math.min(1, Value)) : Fallback;
}

export class Preferences {
    private Now: Chosen;
    private readonly Listeners: Array<(Now: Chosen) => void> = [];

    constructor() {
        const Was = Stored();
        this.Now = {
            Master: Volume(Was.Master, Defaults.Master),
            Effects: Volume(Was.Effects, Defaults.Effects),
            Crowd: Volume(Was.Crowd, Defaults.Crowd),
            Muted: Was.Muted === true,
            Quality: Qualities.includes(Was.Quality as Quality) ? Was.Quality as Quality : Defaults.Quality,
            Level: Levels.includes(Was.Level as Level) ? Was.Level as Level : Defaults.Level,
        };
    }

    Get(): Chosen { return this.Now; }

    /** Changes some of the choices, keeps them, and tells whoever listens. */
    Set(Changed: Partial<Chosen>): void {
        this.Now = { ...this.Now, ...Changed };
        try { if (typeof localStorage !== "undefined") localStorage.setItem(Key, JSON.stringify(this.Now)); } catch { /* private window: not kept */ }
        for (const Each of this.Listeners) Each(this.Now);
    }

    Listen(Listener: (Now: Chosen) => void): void { this.Listeners.push(Listener); }
}

/** The one set of choices the whole app shares. */
export const Prefs = new Preferences();
