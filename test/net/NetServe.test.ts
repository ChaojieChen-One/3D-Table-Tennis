import { expect, test } from "vitest";
import { BallState } from "../../src/engine/BallState";
import { Vec3 } from "../../src/engine/math/Vec3";
import { CursorFollower } from "../../src/game/control/CursorFollower";
import { ReachEnvelope } from "../../src/game/control/ReachEnvelope";
import { FixedClock } from "../../src/game/FixedClock";
import { Opponent } from "../../src/game/Opponent";
import { Rally } from "../../src/game/Rally";
import { RemoteRacket } from "../../src/game/RemoteRacket";
import { Other } from "../../src/game/Side";
import { Codec } from "../../src/net/Codec";
import { Message } from "../../src/net/Message";
import { NetMirror } from "../../src/net/NetMirror";
import { NetSession } from "../../src/net/NetSession";
import { MemoryTransport } from "../../src/net/Transport";
import { Check } from "../Measure";

/**
 * A served match between two Rallys: the host says whose serve it is, the server's own machine
 * tosses, and the host calls the point. Every check is the half turn between the two ends, or an
 * ITTF law, not a value from the code.
 */
const Step = FixedClock.Step;

test("ServeAndTossSurviveTheWire", () => {
    const Serve: Message = { Kind: "Serve", Server: "Near" };
    const Toss: Message = { Kind: "Toss", Ball: new BallState(new Vec3(0.1, 0.25, 1.6), new Vec3(0, 3.13, 0), Vec3.Zero), At: 1.5 };
    const Back = [Serve, Toss].map(Each => Codec.Decode(Codec.Encode(Each)));
    Check(Codec.Encode(Back[0]) === Codec.Encode(Serve) && Codec.Encode(Back[1]) === Codec.Encode(Toss) && Back[0].Kind === "Serve" && Back[1].Kind === "Toss",
          Codec.Encode(Serve) + " | " + Codec.Encode(Toss));
});

/** One machine's end of a served match, its racket parked wide so it never strikes the ball. */
function End(Link: MemoryTransport, Host: boolean, Coin: () => number): { Game: Rally; Advance: () => void } {
    const Hand = new CursorFollower(ReachEnvelope.Neutral);
    Hand.AimAt(new Vec3(2.0, 0, 1.6));
    const Remote = new RemoteRacket(new Vec3(0, 0.2, Opponent.StandZ));
    const Game = new Rally(Hand, Remote, true, Coin);
    Game.SetServing(true);
    const Session = new NetSession(Link, Hand, Remote, Game, Host);
    return { Game, Advance: () => { Session.Pump(Step); Game.Step(); } };
}

/**
 * Whichever end the host's lot gives the serve, both machines agree whose it is (each calling the
 * other's Near its Far); only the server can toss; the toss is seen rising at the other end, half
 * turned; and a toss never struck is the receiver's point on both ([ITTF] 2.10.1.1), then the
 * same end serves again ([ITTF] 2.13.3: two points each).
 */
test("AServedMatchAgreesWhoseServeItIsAndCallsTheFault", () => {
    let Measured = "";
    for (const Lot of [0.1, 0.9]) {   // the host serves first, then the guest
        let Now = 0;
        const [HostLink, JoinLink] = MemoryTransport.Pair(() => Now, 0.04, 0.01);
        const Host = End(HostLink, true, () => Lot), Joined = End(JoinLink, false, () => Lot);
        const Tick = () => { Now += Step; Host.Advance(); Joined.Advance(); };
        for (let Steps = 0; Steps < 3 / Step && (Host.Game.Server() === null || Joined.Game.Server() === null); Steps++) Tick();
        const HostServes = Host.Game.Server() === "Near";
        const Server = HostServes ? Host.Game : Joined.Game, Receiver = HostServes ? Joined.Game : Host.Game;
        expect(Joined.Game.Server(), "the joined machine was never told whose serve it is").toBe(Other(Host.Game.Server()!));
        const OnlyTheServer = Server.AwaitingToss() && !Receiver.AwaitingToss() && Receiver.AwaitingTheirToss() && !Receiver.Toss();
        expect(Server.Toss(), "the server's toss was refused").toBe(true);
        // The toss, seen rising at the receiver's end at the half turn of where the server threw it.
        let Seen: BallState | null = null;
        const Thrown = Server.View().Ball;
        for (let Steps = 0; Steps < 0.2 / Step && Seen === null; Steps++) {
            Tick();
            if (Receiver.View().Ball.Velocity.Y > 1) Seen = Receiver.View().Ball;
        }
        expect(Seen, "the toss never arrived").not.toBeNull();
        const Turned = NetMirror.Ball(Thrown).Position;
        const Across = Math.hypot(Seen!.Position.X - Turned.X, Seen!.Position.Z - Turned.Z);
        for (let Steps = 0; Steps < 4 / Step && (Host.Game.LastPoint() === null || Joined.Game.LastPoint() === null); Steps++) Tick();
        const HostCall = Host.Game.LastPoint(), JoinedCall = Joined.Game.LastPoint();
        for (let Steps = 0; Steps < 3 / Step && !(Host.Game.AwaitingToss() || Joined.Game.AwaitingToss()); Steps++) Tick();
        const Again = HostServes ? Host.Game.AwaitingToss() : Joined.Game.AwaitingToss();
        const Line = `lot ${Lot}: ${HostServes ? "host" : "guest"} serves; toss seen ${Across.toExponential(1)} m off its half turn; `
                   + `host called ${HostCall}, at ${Host.Game.Score()}; guest shows ${JoinedCall}, at ${Joined.Game.Score()}; same server again ${Again}\n`;
        Measured += Line;
        expect(OnlyTheServer && Across < 1e-3 && HostCall !== null && JoinedCall !== null
               && HostCall.Winner === (HostServes ? "Far" : "Near") && JoinedCall.Winner === Other(HostCall.Winner!)
               && HostCall.Template.includes("2.10.1.1") && Host.Game.Score().Mirrored().Equals(Joined.Game.Score()) && Again, Line).toBe(true);
    }
    Check(true, Measured);
});
