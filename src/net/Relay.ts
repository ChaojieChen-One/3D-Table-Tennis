/**
 * The relay's own lines, shared by the server (server/relay.ts) and the browser's
 * WebSocketTransport. A room is named by a short code; the first to open it hosts (seat 0) and
 * the rest join in turn (seats 1, 2, ...), up to the room's size. Game lines are relayed to every
 * other seat in the room wrapped as "<seat>|<line>", so a receiver knows who sent each one.
 *
 *   client -> relay   (first text frame)   OPEN <code> <size>     host a new room
 *                                          JOIN <code>            join one
 *   relay  -> client                       SEATED <seat> <count>  you are in, at <seat>; <count> are in
 *                                          ARRIVED <seat>         another seat filled
 *                                          LEFT <seat>            a seat emptied
 *                                          REFUSED <why>          no room, room full, or code taken
 *   either way, afterwards                 <seat>|<game line>
 */

/** The port the relay listens on by default: the Java edition's hosting port. */
export const DefaultPort = 26780;

/** Room codes: four letters, no look-alikes (no I, L, O, 0, 1). */
const CodeLetters = "ABCDEFGHJKMNPQRSTUVWXYZ";

export function NewRoomCode(Random: () => number = Math.random): string {
    let Code = "";
    for (let Each = 0; Each < 4; Each++) Code += CodeLetters[Math.floor(Random() * CodeLetters.length)];
    return Code;
}

/** A typed code tidied: upper case, no spaces; null if it cannot be one. */
export function CleanRoomCode(Typed: string): string | null {
    const Code = Typed.trim().toUpperCase().replace(/\s+/g, "");
    return /^[A-Z0-9]{3,12}$/.test(Code) ? Code : null;
}

/** The most seats a room may have: room for doubles, with a spare for a watcher. */
export const MostSeats = 5;

/** Splits "<seat>|<line>"; null if it is not one. */
export function Unwrap(Frame: string): { From: number; Line: string } | null {
    const Bar = Frame.indexOf("|");
    if (Bar <= 0) return null;
    const From = Number(Frame.slice(0, Bar));
    return Number.isInteger(From) ? { From, Line: Frame.slice(Bar + 1) } : null;
}
