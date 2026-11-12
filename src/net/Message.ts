import { BallState } from "../engine/BallState";
import { Vec3 } from "../engine/math/Vec3";
import { Point } from "../game/Referee";
import { Side } from "../game/Side";

/**
 * Everything one machine tells another, each in the sender's own local frame (the sender always at
 * +Z). From is the relay seat the message came from, filled in on arrival: a match of two needs no
 * more than "the other one", but a table of three or four knows whose racket a pose belongs to.
 */
export type Message =
    | { readonly Kind: "Hello"; readonly Version: string; readonly Name: string; From?: number }
    | { readonly Kind: "Pose"; readonly Centre: Vec3; readonly Normal: Vec3; readonly Roll: number; readonly At: number; From?: number }
    | { readonly Kind: "Hit"; readonly Ball: BallState; readonly At: number; From?: number }
    | { readonly Kind: "Spawn"; readonly Ball: BallState; readonly Striker: Side; From?: number }
    | { readonly Kind: "Point"; readonly Call: Point; From?: number }
    | { readonly Kind: "Ping"; readonly At: number; From?: number }
    | { readonly Kind: "Pong"; readonly At: number; From?: number };

/** Raise whenever the wire format changes; a peer with another version is turned away. */
export const WireVersion = "2";

export const Hello = (Name: string): Message => ({ Kind: "Hello", Version: WireVersion, Name });
