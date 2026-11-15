import { Vec3 } from "../engine/math/Vec3";

/**
 * How well the computer plays: one immutable set of the things an Opponent does differently from
 * level to level. Every time is in game seconds, like every constant of the game.
 */
export interface Level {
    /** The level's name in a URL or a saved setting, lower case. */
    readonly Key: string;

    /** The level's name on a menu. */
    readonly Name: string;

    /** How long after a ball turns toward it before it starts to move, s. */
    readonly ReactionTime: number;

    /** The fastest its racket moves across and up or down, m/s. */
    readonly MoveSpeed: number;

    /**
     * Its aim's scatter: each stroke's face is off the one it aimed by up to this many degrees,
     * open or closed and to either side, drawn evenly. 0 plays the aimed face exactly.
     */
    readonly AimError: number;

    /** The forward swings it tries in turn, m/s: its usual one first, firmer only when that cannot get the ball back. Its pace. */
    readonly SwingSpeeds: readonly number[];

    /** Where its returns land on the player's half, in turn: how wide and how deep it places them. */
    readonly Targets: readonly Vec3[];

    /** The share of its strokes it attacks, 0 to 1: on those it tries its firmest swing first and settles for a gentler one only if that would miss. */
    readonly Attacks: number;
}

/**
 * TUNED: the levels, easiest first. Pro is the computer as it has always played (its reaction
 * time, speed, swings and targets are the ones the Java edition was measured with: 81 of 81
 * ordinary shots returned, 361 of 385 spun ones), and the default. Rookie and Club react later,
 * move slower, swing softer, keep the ball nearer the middle and miss their aim by a few degrees;
 * Champion reacts sooner, moves faster, places wider and deeper, and attacks half its strokes.
 */
const Rookie: Level = {
    Key: "rookie", Name: "Rookie", ReactionTime: 0.45, MoveSpeed: 1.1, AimError: 5, SwingSpeeds: [1.5, 3.0, 4.5],
    Targets: [new Vec3(-0.15, 0, 0.75), new Vec3(0.15, 0, 0.75), new Vec3(0, 0, 0.75)], Attacks: 0,
};
const Club: Level = {
    Key: "club", Name: "Club", ReactionTime: 0.35, MoveSpeed: 1.5, AimError: 2.5, SwingSpeeds: [1.8, 3.0, 4.5],
    Targets: [new Vec3(-0.25, 0, 0.80), new Vec3(0.25, 0, 0.80), new Vec3(0, 0, 0.80)], Attacks: 0,
};
const Pro: Level = {
    Key: "pro", Name: "Pro", ReactionTime: 0.25, MoveSpeed: 2.0, AimError: 0, SwingSpeeds: [2.0, 3.0, 4.5],
    Targets: [new Vec3(-0.35, 0, 0.85), new Vec3(0.35, 0, 0.85), new Vec3(0, 0, 0.85)], Attacks: 0,
};
const Champion: Level = {
    Key: "champion", Name: "Champion", ReactionTime: 0.18, MoveSpeed: 2.8, AimError: 0, SwingSpeeds: [2.0, 3.0, 4.5],
    Targets: [new Vec3(-0.50, 0, 1.00), new Vec3(0.50, 0, 1.00), new Vec3(0, 0, 1.10)], Attacks: 0.5,
};

/** Every level, easiest first, for a menu to offer. */
export const Levels: readonly Level[] = [Rookie, Club, Pro, Champion];

/** The level the computer plays at unless told otherwise: the one every measured baseline was taken with. */
export const DefaultLevel: Level = Pro;

/** The level with this Key, in any letter case; the default for null or a key that names none. */
export function LevelNamed(Key: string | null | undefined): Level {
    const Wanted = (Key ?? "").trim().toLowerCase();
    return Levels.find(Each => Each.Key === Wanted) ?? DefaultLevel;
}
