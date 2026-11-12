import { afterAll, beforeAll, expect, test } from "vitest";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import { BallState } from "../../src/engine/BallState";
import { Vec3 } from "../../src/engine/math/Vec3";
import { CursorFollower } from "../../src/game/control/CursorFollower";
import { ReachEnvelope } from "../../src/game/control/ReachEnvelope";
import { FixedClock } from "../../src/game/FixedClock";
import { Opponent } from "../../src/game/Opponent";
import { Rally } from "../../src/game/Rally";
import { Point } from "../../src/game/Referee";
import { RemoteRacket } from "../../src/game/RemoteRacket";
import { Codec } from "../../src/net/Codec";
import { Message } from "../../src/net/Message";
import { NetMirror } from "../../src/net/NetMirror";
import { NetSession } from "../../src/net/NetSession";
import { MemoryTransport, Transport } from "../../src/net/Transport";
import { WebSocketTransport } from "../../src/net/WebSocketTransport";
import { StartRelay } from "../../server/relay";
import { Check } from "../Measure";

/**
 * A match between two Rallys, without serves: the host puts each ball in play and calls each
 * point, and the joined machine follows. Every check is the half turn between the two ends,
 * (x, y, z) -> (-x, y, -z) with the ends swapped, not a value from the code.
 */
const Step = FixedClock.Step;

const SameBall = (A: BallState, B: BallState) =>
    A.Position.Minus(B.Position).Length() < 1e-6 && A.Velocity.Minus(B.Velocity).Length() < 1e-6 && A.Spin.Minus(B.Spin).Length() < 1e-6;

test("SpawnAndPointSurviveTheWire", () => {
    const Spawn: Message = { Kind: "Spawn", Ball: new BallState(new Vec3(0.1, 0.25, -1.5), new Vec3(-0.2, 1.1, 5.4), new Vec3(3, -4, 5)), Striker: "Far" };
    const Called: Message = { Kind: "Point", Call: new Point("Near", "2.10.1.2: {Far} did not return the ball before it touched the floor") };
    const Let: Message = { Kind: "Point", Call: new Point(null, "no stroke for 4 s") };
    const Measured = Codec.Encode(Spawn) + " | " + Codec.Encode(Called) + " | " + Codec.Encode(Let);
    const Back = [Spawn, Called, Let].map(Each => Codec.Decode(Codec.Encode(Each)));
    Check(Codec.Encode(Back[0]) === Codec.Encode(Spawn) && Codec.Encode(Back[1]) === Codec.Encode(Called)
          && Codec.Encode(Back[2]) === Codec.Encode(Let), Measured);
});

test("AnUnreadableLineIsRefused", () => {
    for (const Line of ["GET / HTTP/1.1", "HIT 1 2 3", "SPAWN 0 0 0 0 0 0 0 0 0 Sideways", "POSE a b c d e f g h"])
        expect(() => Codec.Decode(Line), Line).toThrow();
});

/** One machine's end of a match: its Rally and the session that links it to the other. */
class End {
    readonly Hand = new CursorFollower(ReachEnvelope.Neutral);
    readonly Remote = new RemoteRacket(new Vec3(0, 0.2, Opponent.StandZ));
    readonly Game = new Rally(this.Hand, this.Remote, true);
    readonly Session: NetSession;

    constructor(Link: Transport, Host: boolean) {
        // Park the racket wide of the table, so it can never meet the ball by chance.
        this.Hand.AimAt(new Vec3(2.0, 0, 1.6));
        this.Session = new NetSession(Link, this.Hand, this.Remote, this.Game, Host);
    }

    Advance(): void {
        this.Session.Pump(Step);
        this.Game.Step();
    }
}

/** Two ends over an in-memory wire 40 ms long each way, on a shared clock that steps with the game. */
function Pair(): { Host: End; Joined: End; Tick: () => void } {
    let Now = 0;
    const [HostLink, JoinLink] = MemoryTransport.Pair(() => Now, 0.04, 0.01);
    const Host = new End(HostLink, true), Joined = new End(JoinLink, false);
    return { Host, Joined, Tick: () => { Now += Step; Host.Advance(); Joined.Advance(); } };
}

test("AHitArrivesMirroredAndLivesAsTheRemoteSidesStroke", () => {
    let Now = 0;
    const [HostLink, JoinLink] = MemoryTransport.Pair(() => Now, 0, 0);
    const Host = new End(HostLink, true);
    const Struck = new BallState(new Vec3(0.2, 0.3, 1.1), new Vec3(-0.5, 1.0, -5.0), new Vec3(0, 20, -10));
    JoinLink.Send({ Kind: "Hit", Ball: Struck, At: 0 });
    Now += Step;
    Host.Session.Pump(Step);
    const SeenAtHost = Host.Game.View().Ball;
    Check(SameBall(NetMirror.Ball(Struck), SeenAtHost), `sent ${Struck.Position} moving ${Struck.Velocity}; host now has ${SeenAtHost.Position} moving ${SeenAtHost.Velocity}`);
});

test("APoseArrivesMirroredAtTheRemoteRacket", () => {
    let Now = 0;
    const [HostLink, JoinLink] = MemoryTransport.Pair(() => Now, 0, 0);
    const Host = new End(HostLink, true);
    const SentCentre = new Vec3(0.25, 0.4, 1.2);
    JoinLink.Send({ Kind: "Pose", Centre: SentCentre, Normal: new Vec3(0, 0, -1), Roll: 0.1, At: 0 });
    let Reached: Vec3 | null = null;
    for (let Tries = 0; Tries < 400 && Reached === null; Tries++) {
        Now += Step;
        Host.Advance();
        const Centre = Host.Game.View().Opponent.Centre;
        if (Centre.Minus(NetMirror.Vec(SentCentre)).Length() < 0.01) Reached = Centre;
    }
    Check(Reached !== null, `sent centre ${SentCentre} (mirrored ${NetMirror.Vec(SentCentre)}); remote racket reached ${Reached}`);
});

test("TheHostsBallAndCallsArriveTurnedRound", () => {
    const { Host, Joined, Tick } = Pair();
    // The host feeds after FeedDelay; step both ends until the joined one has the same ball.
    let AtHost: BallState | null = null, AtJoined: BallState | null = null;
    for (let Steps = 0; Steps < 20_000 && AtJoined === null; Steps++) {
        Tick();
        if (AtHost === null && !Host.Game.View().Ball.Velocity.IsZero()) AtHost = Host.Game.View().Ball;
        if (AtHost !== null && !Joined.Game.View().Ball.Velocity.IsZero()) AtJoined = Joined.Game.View().Ball;
    }
    expect(AtJoined, "no Spawn arrived").not.toBeNull();
    // Both ends fly the spawned ball from rest. Compare their velocities, which a few steps of flight leave nearly unchanged.
    const Off = AtJoined!.Velocity.Minus(NetMirror.Vec(AtHost!.Velocity)).Length();
    Check(Off < 0.2, `host spawned ${AtHost!.Position}; joined has ${AtJoined!.Position}; velocity off by ${Off.toFixed(4)} m/s`);

    // Let both play the ball out untouched: whoever the feed went to fails to return it.
    for (let Steps = 0; Steps < 8 / Step && Joined.Game.LastPoint() === null; Steps++) Tick();
    const HostCall = Host.Game.LastPoint(), JoinedCall = Joined.Game.LastPoint();
    const Here = { Near: "Host", Far: "Guest" }, There = { Near: "Guest", Far: "Host" };
    const Called = `host called ${HostCall?.Describe(Here)} at ${Host.Game.Score()}; joined shows ${JoinedCall?.Describe(There)} at ${Joined.Game.Score()}`;
    expect(HostCall, Called).not.toBeNull();
    expect(JoinedCall, Called).not.toBeNull();
    // Each end names the other's near end as its own far end: the same words, read from either side.
    Check(JoinedCall!.Describe(There) === HostCall!.Describe(Here)
          && Host.Game.Score().NearPoints === Joined.Game.Score().FarPoints
          && Host.Game.Score().FarPoints === Joined.Game.Score().NearPoints, Called);
});

/** The real wire: two browsers' transports through the relay, a room code between them. */
let Relay: Server;
let Url = "";
beforeAll(async () => {
    Relay = await StartRelay(0, "/nonexistent");
    Url = `ws://127.0.0.1:${(Relay.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>(Done => Relay.close(() => Done())));

async function Until(Condition: () => boolean, Within = 3000): Promise<void> {
    const Start = Date.now();
    while (!Condition()) {
        if (Date.now() - Start > Within) throw new Error("timed out");
        await new Promise(Wait => setTimeout(Wait, 5));
    }
}

test("TwoPlayersMeetInARoomAndTheirLinesCrossTheRelay", async () => {
    const Host = await WebSocketTransport.Connect(Url, "TEST", true, "ann");
    const Guest = await WebSocketTransport.Connect(Url, "TEST", false, "bo");
    const AtHost: Message[] = [], AtGuest: Message[] = [];
    Guest.Send({ Kind: "Ping", At: 7 });
    await Until(() => { AtHost.push(...Host.Poll()); return AtHost.some(Each => Each.Kind === "Ping"); });
    Host.Send({ Kind: "Pong", At: 7 });
    await Until(() => { AtGuest.push(...Guest.Poll()); return AtGuest.some(Each => Each.Kind === "Pong"); });
    const Hellos = AtHost.filter(Each => Each.Kind === "Hello").map(Each => Each.Kind === "Hello" ? `${Each.Name}@${Each.From}` : "");
    Check(Host.Room().Seat === 0 && Guest.Room().Seat === 1 && Hellos.includes("bo@1"),
          `host seat ${Host.Room().Seat}, guest seat ${Guest.Room().Seat}; host heard ${AtHost.map(Each => Each.Kind).join(",")} (${Hellos.join(",")}); guest heard ${AtGuest.map(Each => Each.Kind).join(",")}`);
    Host.Close();
    Guest.Close();
});

test("AFullRoomOrAMissingOneIsRefused", async () => {
    const Host = await WebSocketTransport.Connect(Url, "FULL", true, "ann", 2);
    const Guest = await WebSocketTransport.Connect(Url, "FULL", false, "bo");
    const Third = await WebSocketTransport.Connect(Url, "FULL", false, "cy").then(() => "seated", (Why: Error) => Why.message);
    const Nowhere = await WebSocketTransport.Connect(Url, "NONE", false, "cy").then(() => "seated", (Why: Error) => Why.message);
    Check(Third.includes("full") && Nowhere.includes("no room"), `third player: ${Third}; unknown code: ${Nowhere}`);
    Host.Close();
    Guest.Close();
});

/** Room for more than two: a third seat hears both others, each line tagged with whose it is. */
test("ARoomCanSeatMoreThanTwo", async () => {
    const Seats = [await WebSocketTransport.Connect(Url, "FOUR", true, "a", 4)];
    for (const Name of ["b", "c"]) Seats.push(await WebSocketTransport.Connect(Url, "FOUR", false, Name));
    Seats[0].Send({ Kind: "Ping", At: 1 });
    Seats[1].Send({ Kind: "Ping", At: 2 });
    const Heard: Message[] = [];
    await Until(() => { Heard.push(...Seats[2].Poll()); return Heard.filter(Each => Each.Kind === "Ping").length === 2; });
    const From = Heard.filter(Each => Each.Kind === "Ping").map(Each => Each.From).sort();
    Check(From[0] === 0 && From[1] === 1 && Seats[2].Room().Count === 3, `seat 2 heard pings from seats ${From.join(", ")}; ${Seats[2].Room().Count} in the room`);
    for (const Each of Seats) Each.Close();
});
