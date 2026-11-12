import { BallState } from "../engine/BallState";
import { Vec3 } from "../engine/math/Vec3";
import { Point } from "../game/Referee";
import { Side } from "../game/Side";
import { Message } from "./Message";

/**
 * A Message as one line of plain text, space separated: simple enough to read in a packet capture,
 * and small enough that a pose at 30 Hz costs nothing. Every number is a plain double, written to
 * six places as the Java edition wrote them.
 */

const N = (Value: number) => Value.toFixed(6);
const V = (Of: Vec3) => `${N(Of.X)} ${N(Of.Y)} ${N(Of.Z)}`;
const B = (Of: BallState) => `${V(Of.Position)} ${V(Of.Velocity)} ${V(Of.Spin)}`;

export function Encode(Msg: Message): string {
    switch (Msg.Kind) {
        case "Hello": return `HELLO ${Msg.Version} ${Msg.Name.replace(/\s+/g, "_") || "player"}`;
        case "Pose": return `POSE ${V(Msg.Centre)} ${V(Msg.Normal)} ${N(Msg.Roll)} ${N(Msg.At)}`;
        case "Hit": return `HIT ${B(Msg.Ball)} ${N(Msg.At)}`;
        case "Spawn": return `SPAWN ${B(Msg.Ball)} ${Msg.Striker}`;
        // The reason goes last, since it has spaces of its own; it runs to the end of the line.
        case "Point": return `POINT ${Msg.Call.Winner ?? "LET"} ${Msg.Call.Template.replace(/\n/g, " ")}`;
        case "Ping": return `PING ${N(Msg.At)}`;
        case "Pong": return `PONG ${N(Msg.At)}`;
    }
}

export function Decode(Line: string): Message {
    const Words = Line.trim().split(/\s+/);
    const D = (At: number) => {
        const Value = Number(Words[At]);
        if (Words[At] === undefined || !Number.isFinite(Value)) throw new Error("Unreadable message: " + Line);
        return Value;
    };
    const Vec = (At: number) => new Vec3(D(At), D(At + 1), D(At + 2));
    const Ball = () => new BallState(Vec(1), Vec(4), Vec(7));
    const SideOf = (Word: string | undefined): Side => {
        if (Word === "Near" || Word === "Far") return Word;
        throw new Error("Unreadable side: " + Line);
    };
    switch (Words[0]) {
        case "HELLO": return { Kind: "Hello", Version: Words[1] ?? "", Name: Words[2] ?? "" };
        case "POSE": return { Kind: "Pose", Centre: Vec(1), Normal: Vec(4), Roll: D(7), At: D(8) };
        case "HIT": return { Kind: "Hit", Ball: Ball(), At: D(10) };
        case "SPAWN": return { Kind: "Spawn", Ball: Ball(), Striker: SideOf(Words[10]) };
        case "POINT": {
            const Parts = Line.trim().match(/^POINT\s+(\S+)\s*(.*)$/);
            if (Parts === null) throw new Error("Unreadable message: " + Line);
            return { Kind: "Point", Call: new Point(Parts[1] === "LET" ? null : SideOf(Parts[1]), Parts[2]) };
        }
        case "PING": return { Kind: "Ping", At: D(1) };
        case "PONG": return { Kind: "Pong", At: D(1) };
        default: throw new Error("Unreadable message: " + Line);
    }
}

export const Codec = { Encode, Decode } as const;
