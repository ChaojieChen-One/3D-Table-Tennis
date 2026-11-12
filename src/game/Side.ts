/**
 * The two ends of the table. Near is this machine's end (z > 0, where the camera stands) and Far
 * the other (z < 0). Every rule is about ends, never about who is at them, so a side can hold one
 * player (singles) or two (doubles), human, computer or remote.
 */
export type Side = "Near" | "Far";

export function Other(Of: Side): Side { return Of === "Near" ? "Far" : "Near"; }

/** The end of the table a point lies over, by the sign of z; null on the net's line. */
export function SideAt(Z: number): Side | null { return Z > 0 ? "Near" : Z < 0 ? "Far" : null; }

/** What each end is called in the referee's reasons and on the scoreboard. */
export interface SideNames { readonly Near: string; readonly Far: string; }

/** Practice against the computer. */
export const PracticeNames: SideNames = { Near: "Player", Far: "Computer" };
