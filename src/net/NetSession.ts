import { BallState } from "../engine/BallState";
import { CursorFollower } from "../game/control/CursorFollower";
import { RacketPose } from "../game/control/RacketPose";
import { Rally } from "../game/Rally";
import { RemoteRacket } from "../game/RemoteRacket";
import { Other } from "../game/Side";
import { Message } from "./Message";
import { NetMirror } from "./NetMirror";
import { LinkPath, Transport } from "./Transport";

/**
 * Bridges one Rally to the other machine over a Transport: sends this machine's own racket pose
 * 60 times a real second and a Hit whenever the local player strikes the ball; applies whatever
 * the other machine sends the same way. Everything that arrives is mirrored once, in NetMirror,
 * since each machine's wire data is its own local frame with itself at +Z. Pump is called once a
 * frame by whoever owns the game loop.
 *
 * Two clocks pass through Pump. The link lives on real time: poses, pings and the round trip are
 * all real seconds, so a match in slow motion sends and measures exactly as one at full speed.
 * The rally lives on game time, so the one figure that crosses over, how far a remote stroke is
 * flown forward to make up for its trip, is the one way trip in real seconds times the game speed.
 *
 * Singles: every remote message is the one opponent's. Remotes maps a relay seat to the racket
 * that shows it, so a table of more players adds entries rather than a new session.
 */
export class NetSession {
    /** 60 poses a real second: one short line each, and the finer the samples the less the other side has to guess. */
    static readonly PoseEvery = 1.0 / 60;

    /** A frame this share of PoseEvery after the last pose still sends one, so a 60 Hz display's uneven frames never skip a pose. */
    private static readonly PoseSlack = 0.9;

    /** A ping every half a real second, for the round trip. */
    static readonly PingEvery = 0.5;

    /** TUNED: each new round trip moves the smoothed one this share of the way: about four pings (2 s) to settle. */
    private static readonly Smoothing = 0.25;

    private SincePose = NetSession.PoseEvery;
    private SincePing = NetSession.PingEvery;

    /** This machine's real clock, s: what every At this session sends is read from. */
    private Clock = 0;

    /** Game seconds per real second, as the last frame ran. */
    private Rate = 1;

    /** The smoothed round trip and how much it varies, real s; no Samples until the first Pong on this path. */
    private Lag = 0;
    private Varies = 0;
    private Samples = 0;

    /** The path the link was last seen on, and when it changed: a Pong to a Ping sent before then measured the old path. */
    private OnPath: LinkPath;
    private PathSince = 0;

    /** The names the other machines gave in their HELLO, by seat. */
    readonly Names = new Map<number, string>();

    /** Host true on the machine that opened the room, false on one that joined: only the host referees. */
    constructor(private readonly Link: Transport,
                private readonly Player: CursorFollower,
                private readonly Remote: RemoteRacket,
                private readonly Game: Rally,
                Host = true) {
        this.OnPath = this.Path();
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

    /**
     * One frame: Seconds of game time and RealSeconds of real time have passed (the same, unless
     * the game runs slowed). Applies whatever arrived, and sends the Pose and Ping that are due.
     */
    Pump(Seconds: number, RealSeconds: number = Seconds): void {
        this.Clock += RealSeconds;
        if (RealSeconds > 0) this.Rate = Seconds / RealSeconds;
        this.Remote.Advance(RealSeconds);
        for (const Msg of this.Link.Poll()) this.Apply(Msg);

        const Path = this.Path();
        if (Path !== this.OnPath) {
            this.OnPath = Path;
            this.PathSince = this.Clock;
            this.Samples = 0;
        }

        this.SincePose += RealSeconds;
        if (this.SincePose >= NetSession.PoseEvery * NetSession.PoseSlack) {
            // What ran over (or the slack that was borrowed) is carried, so a faster display still averages 60 a second.
            this.SincePose = Math.min(NetSession.PoseEvery, this.SincePose - NetSession.PoseEvery);
            const Pose = this.Player.Pose();
            this.Link.Send({ Kind: "Pose", Centre: Pose.Centre, Normal: Pose.Normal, Roll: Pose.Roll, At: this.Clock });
        }
        this.SincePing += RealSeconds;
        if (this.SincePing >= NetSession.PingEvery) {
            this.SincePing = 0;
            this.Link.Send({ Kind: "Ping", At: this.Clock });
        }
    }

    /** The smoothed round trip, real s; 0 before the first Pong. It includes each machine's wait for its next frame, as a stroke's trip does. */
    RoundTrip(): number { return this.Lag; }

    /** How much the round trip varies, real s: the smoothed distance of each one from the smoothed round trip. */
    Jitter(): number { return this.Varies; }

    /** Whether the link is through the relay or straight to the other machine. */
    Path(): LinkPath { return this.Link.Path?.() ?? "relay"; }

    /**
     * How far a remote stroke is flown forward on arrival, game s: half the smoothed round trip,
     * which is real time, times the game speed. Rally caps it at MostCatchUp.
     */
    CatchUp(): number { return this.Lag / 2 * this.Rate; }

    /** The link in a line for the HUD: "PING 34 ms · DIRECT". */
    Describe(): string {
        const Ping = this.Lag > 0 ? `PING ${Math.round(this.Lag * 1000)} ms` : "PING …";
        return `${Ping} · ${this.Path().toUpperCase()}`;
    }

    private Apply(Msg: Message): void {
        switch (Msg.Kind) {
            case "Pose": this.Remote.Receive(NetMirror.Pose(new RacketPose(Msg.Centre, Msg.Normal, Msg.Roll)), Msg.At); break;
            case "Hit": this.Game.ApplyRemoteHit(NetMirror.Ball(Msg.Ball), this.CatchUp()); break;
            // The host's near end is this machine's far end, so its sides swap along with its frame.
            case "Spawn": this.Game.ApplySpawn(NetMirror.Ball(Msg.Ball), Other(Msg.Striker)); break;
            case "Point": this.Game.ApplyRemotePoint(Msg.Call.Mirrored()); break;
            case "Ping": this.Link.Send({ Kind: "Pong", At: Msg.At }); break;
            case "Pong": this.Measure(Msg.At); break;
            case "Hello": if (Msg.From !== undefined) this.Names.set(Msg.From, Msg.Name); break;
            // A raw link has no order to restore: what it wrapped is applied as it comes.
            case "Numbered": this.Apply(Msg.Inner); break;
        }
    }

    /** A Pong to the Ping sent at SentAt: one more round trip into the smoothed one. */
    private Measure(SentAt: number): void {
        if (SentAt < this.PathSince) return;
        const Trip = Math.max(0, this.Clock - SentAt);
        if (this.Samples++ === 0) {
            this.Lag = Trip;
            this.Varies = 0;
            return;
        }
        this.Varies += NetSession.Smoothing * (Math.abs(Trip - this.Lag) - this.Varies);
        this.Lag += NetSession.Smoothing * (Trip - this.Lag);
    }
}
