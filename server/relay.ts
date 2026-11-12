/**
 * The match relay: pairs players by room code and passes their lines between them. It knows
 * nothing of table tennis (the players' own machines run the game, each owning its own hits), so
 * it is small enough to run anywhere Node runs, and serves the built game (dist/) on the same port
 * so one command hosts both. Protocol: src/net/Relay.ts.
 *
 *   npm run build && npm run relay            # http://localhost:26780, relay on the same port
 *   PORT=8080 npm run relay                   # another port
 */
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, Server } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { CleanRoomCode, DefaultPort, MostSeats } from "../src/net/Relay";

/** The most a single line may be: a POINT with its reason is well under a kilobyte. */
const LongestLine = 2048;

/** A room no one has spoken in for this long is closed, ms. */
const IdleFor = 30 * 60 * 1000;

interface Room { readonly Size: number; readonly Seats: (WebSocket | null)[]; LastHeard: number; }

const Types: Record<string, string> = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
    ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2",
};

/** Starts the relay (and the game's files from Root, if built) on Port; resolves once it listens. */
export function StartRelay(Port: number = DefaultPort, Root: string = resolve("dist")): Promise<Server> {
    const Rooms = new Map<string, Room>();
    const Http = createServer((Request, Response) => {
        const Path = decodeURIComponent((Request.url ?? "/").split("?")[0]);
        let File = normalize(join(Root, Path === "/" ? "index.html" : Path));
        if (File !== Root && !File.startsWith(Root + sep)) { Response.writeHead(403).end(); return; }
        if (!existsSync(File) || statSync(File).isDirectory()) File = join(Root, "index.html");
        if (!existsSync(File)) {
            Response.writeHead(200, { "content-type": "text/plain" }).end("3D Table Tennis relay. Build the game (npm run build) to serve it here too.\n");
            return;
        }
        Response.writeHead(200, { "content-type": Types[extname(File)] ?? "application/octet-stream" });
        createReadStream(File).pipe(Response);
    });

    const Sockets = new WebSocketServer({ server: Http, maxPayload: LongestLine });

    function Broadcast(Into: Room, From: number, Text: string): void {
        Into.Seats.forEach((Each, Seat) => { if (Each !== null && Seat !== From && Each.readyState === WebSocket.OPEN) Each.send(Text); });
    }

    Sockets.on("connection", Socket => {
        let Code: string | null = null;
        let Seat = -1;

        Socket.on("message", Data => {
            const Text = Data.toString();
            if (Code === null) {
                const [Verb, Typed, SizeWord] = Text.trim().split(/\s+/);
                const Clean = CleanRoomCode(Typed ?? "");
                if (Clean === null || (Verb !== "OPEN" && Verb !== "JOIN")) { Socket.send("REFUSED unreadable request"); Socket.close(); return; }
                let Into = Rooms.get(Clean);
                if (Verb === "OPEN") {
                    if (Into !== undefined) { Socket.send("REFUSED that room code is taken"); Socket.close(); return; }
                    const Size = Math.max(2, Math.min(MostSeats, Number(SizeWord) || 2));
                    Into = { Size, Seats: new Array(Size).fill(null), LastHeard: Date.now() };
                    Rooms.set(Clean, Into);
                } else if (Into === undefined) { Socket.send("REFUSED no room with that code"); Socket.close(); return; }
                const Free = Into.Seats.indexOf(null);
                if (Free < 0) { Socket.send("REFUSED that room is full"); Socket.close(); return; }
                Code = Clean;
                Seat = Free;
                Into.Seats[Seat] = Socket;
                const Count = Into.Seats.filter(Each => Each !== null).length;
                Socket.send(`SEATED ${Seat} ${Count}`);
                Broadcast(Into, Seat, `ARRIVED ${Seat}`);
                console.log(`room ${Code}: seat ${Seat} in (${Count}/${Into.Size})`);
                return;
            }
            const Into = Rooms.get(Code);
            if (Into === undefined) return;
            Into.LastHeard = Date.now();
            for (const Line of Text.split("\n")) if (Line.length > 0) Broadcast(Into, Seat, `${Seat}|${Line}`);
        });

        Socket.on("close", () => {
            if (Code === null) return;
            const Into = Rooms.get(Code);
            if (Into === undefined) return;
            Into.Seats[Seat] = null;
            Broadcast(Into, Seat, `LEFT ${Seat}`);
            const Left = Into.Seats.filter(Each => Each !== null).length;
            console.log(`room ${Code}: seat ${Seat} out (${Left}/${Into.Size})`);
            // The host leaving ends the match: only it referees.
            if (Seat === 0 || Left === 0) {
                Rooms.delete(Code);
                for (const Each of Into.Seats) Each?.close();
            }
        });
    });

    const Sweeper = setInterval(() => {
        const Now = Date.now();
        for (const [Code, Into] of Rooms) if (Now - Into.LastHeard > IdleFor) {
            for (const Each of Into.Seats) Each?.close();
            Rooms.delete(Code);
        }
    }, 60_000);
    Sockets.on("close", () => clearInterval(Sweeper));
    Http.on("close", () => { clearInterval(Sweeper); Sockets.close(); });

    return new Promise(Done => Http.listen(Port, () => Done(Http)));
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const Port = Number(process.env.PORT ?? DefaultPort);
    const Root = resolve(process.env.STATIC_DIR ?? "dist");
    void StartRelay(Port, Root).then(() => console.log(`3D Table Tennis relay on port ${Port}${existsSync(Root) ? `, serving ${Root}` : ""}`));
}
