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
    // Serving: the host says whose serve the next rally is; the server's own machine shares its toss, then its Hit.
    | { readonly Kind: "Serve"; readonly Server: Side; From?: number }
    | { readonly Kind: "Toss"; readonly Ball: BallState; readonly At: number; From?: number }
    | { readonly Kind: "Ping"; readonly At: number; From?: number }
    | { readonly Kind: "Pong"; readonly At: number; From?: number }
    // The link's own, not the game's (WebRtcTransport): a Signal is one piece of the direct
    // connection's negotiation; a Numbered wraps a message that must arrive, with its place in the
    // sender's order. Every At above is the sender's real clock, s, whatever the game speed.
    | { readonly Kind: "Signal"; readonly Part: number; readonly Of: number; readonly Text: string; From?: number }
    | { readonly Kind: "Numbered"; readonly Seq: number; readonly Inner: Message; From?: number };

/** Raise whenever the wire format changes; a peer with another version is turned away. */
export const WireVersion = "3";

export const Hello = (Name: string): Message => ({ Kind: "Hello", Version: WireVersion, Name });
