import { BallState } from "../engine/BallState";
import { CursorFollower } from "../game/control/CursorFollower";
import { RacketPose } from "../game/control/RacketPose";
import { Rally } from "../game/Rally";
import { RemoteRacket } from "../game/RemoteRacket";
import { Other } from "../game/Side";
import { Message } from "./Message";
import { NetMirror } from "./NetMirror";
import { Transport } from "./Transport";

/**
 * Bridges one Rally to the other machine over a Transport: sends this machine's own racket pose
 * about 30 times a second and a Hit whenever the local player strikes the ball; applies whatever
 * the other machine sends the same way. Everything that arrives is mirrored once, in NetMirror,
 * since each machine's wire data is its own local frame with itself at +Z. Pump is called once a
 * step by whoever owns the game loop.
 *
 * Singles: every remote message is the one opponent's. Remotes maps a relay seat to the racket
 * that shows it, so a table of more players adds entries rather than a new session.
 */
export class NetSession {
    /** About 30 poses a second. */
    private static readonly PoseEvery = 1.0 / 30;

    /** A ping once a second, for the round trip. */
    private static readonly PingEvery = 1.0;

    private SincePose = NetSession.PoseEvery;
    private SincePing = NetSession.PingEvery;
    private Clock = 0;
    private PingSentAt = Number.NaN;

    /** The last measured round trip, s; 0 until the first Pong. */
    private Lag = 0;

    /** The names the other machines gave in their HELLO, by seat. */
    readonly Names = new Map<number, string>();

    /** Host true on the machine that opened the room, false on one that joined: only the host referees. */
    constructor(private readonly Link: Transport,
                private readonly Player: CursorFollower,
                private readonly Remote: RemoteRacket,
                private readonly Game: Rally,
                Host = true) {
        Game.SetReferee(Host);
        Game.SetOnLocalHit(Struck => this.SendHit(Struck));
        Game.SetOnSpawn((Spawned, Striker) => Link.Send({ Kind: "Spawn", Ball: Spawned, Striker }));
        Game.SetOnPoint(Called => Link.Send({ Kind: "Point", Call: Called }));
    }

    /** Whether the other machine is still there. */
    Connected(): boolean { return this.Link.Connected(); }

    Close(): void { this.Link.Close(); }

    /** Shares Ball as this machine's own stroke. */
    SendHit(Ball: BallState): void { this.Link.Send({ Kind: "Hit", Ball, At: this.Clock }); }

    /** Advances by Seconds of game time: applies whatever arrived, and sends due Pose and Ping. */
    Pump(Seconds: number): void {
        this.Clock += Seconds;
        for (const Msg of this.Link.Poll()) this.Apply(Msg);

        this.SincePose += Seconds;
        if (this.SincePose >= NetSession.PoseEvery) {
            this.SincePose = 0;
            const Pose = this.Player.Pose();
            this.Link.Send({ Kind: "Pose", Centre: Pose.Centre, Normal: Pose.Normal, Roll: Pose.Roll, At: this.Clock });
        }
        this.SincePing += Seconds;
        if (this.SincePing >= NetSession.PingEvery) {
            this.SincePing = 0;
            this.PingSentAt = this.Clock;
            this.Link.Send({ Kind: "Ping", At: this.Clock });
        }
    }

    /** The last measured round trip, s; 0 before the first Pong. */
    RoundTrip(): number { return this.Lag; }

    private Apply(Msg: Message): void {
        switch (Msg.Kind) {
            case "Pose": this.Remote.Receive(NetMirror.Pose(new RacketPose(Msg.Centre, Msg.Normal, Msg.Roll))); break;
            case "Hit": this.Game.ApplyRemoteHit(NetMirror.Ball(Msg.Ball), this.Lag / 2); break;
            // The host's near end is this machine's far end, so its sides swap along with its frame.
            case "Spawn": this.Game.ApplySpawn(NetMirror.Ball(Msg.Ball), Other(Msg.Striker)); break;
            case "Point": this.Game.ApplyRemotePoint(Msg.Call.Mirrored()); break;
            case "Ping": this.Link.Send({ Kind: "Pong", At: Msg.At }); break;
            case "Pong": this.Lag = Math.max(0, this.Clock - this.PingSentAt); break;
            case "Hello": if (Msg.From !== undefined) this.Names.set(Msg.From, Msg.Name); break;
        }
    }
}
