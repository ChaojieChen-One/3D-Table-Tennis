import * as THREE from "three";
import { BallState } from "../../engine/BallState";
import { TableSpec } from "../../engine/Specs";
import { Vec3 } from "../../engine/math/Vec3";
import { PlayerGrip } from "../../game/control/PlayerGrip";
import { RacketPose } from "../../game/control/RacketPose";
import { RallyEvents } from "../RallyEvents";
import { RallyView } from "../../game/RallyView";
import { Arena } from "./ArenaView";
import { BallView } from "./BallView";
import { Impacts } from "./Impacts";
import { RacketView } from "./RacketView";
import { Sparks } from "./Sparks";

/**
 * Everything drawn in 3D: the hall, every racket and the ball. Each is posed at a ready stance
 * here, then moved every frame through PoseRacket and PlaceBall. Racket 0 is this machine's player;
 * the rest follow the rally's seats, so a table of four draws four. It listens to the rally
 * (RallyEvents) for what to throw sparks and light at. The scene only reads game state and never
 * changes it.
 */
export class TableScene implements RallyEvents {
    /** TUNED: a contact that changes the ball's velocity by less than this, m/s, throws no sparks; one this hard throws the most. */
    private static readonly SparksFrom = 5;
    private static readonly SparksFull = 16;

    /** TUNED: the flash a hard stroke lights the table with: its brightest, candela, and how long it takes to die, game s. */
    private static readonly FlashBright = 5;
    private static readonly FlashLasts = 0.12;

    /** TUNED: the colours of what flies off a contact: the player's strokes warm, the others' cool, the table's pale. */
    private static readonly Warm = new THREE.Color("#ffb066");
    private static readonly Cool = new THREE.Color("#8fd2ff");
    private static readonly Pale = new THREE.Color("#e8f0ff");

    /** TUNED: a ready stance, a hand's width above the table and a little behind the end line. */
    private static readonly RacketHeight = 0.20;
    private static readonly RacketBehindEnd = 0.15;
    private static readonly RacketOffCentre = 0.25;

    /** TUNED: low and near; higher up, perspective lifts it above the net and it reads as the far half. */
    private static readonly BallAt = new Vec3(-0.32, 0.15, TableSpec.HalfLength * 2 / 3);

    readonly Root = new THREE.Group();
    private readonly Rackets: RacketView[] = [];
    private readonly Poses: RacketPose[] = [];
    private readonly Ball = new BallView();
    private readonly Contacts = new Impacts();
    private readonly Flying = new Sparks();
    private readonly Flash = new THREE.PointLight("#ffd9a8", 0, 2.5, 2);
    private FlashLeft = 0;

    /** The hall itself, for the graphics settings and the reflections. */
    readonly Hall = new Arena();

    constructor() {
        this.Root.add(this.Hall.Root, this.Ball.Root, this.Contacts.Root, this.Flying.Root, this.Flash);
        const EndZ = TableSpec.HalfLength + TableScene.RacketBehindEnd;
        const Ready = new Vec3(TableScene.RacketOffCentre, TableScene.RacketHeight, EndZ);
        this.PoseRacket(0, Ready, new Vec3(0, 0, -1), PlayerGrip.Lean(Ready, Vec3.Zero, new Vec3(0, 0, -1)));
        this.PoseRacket(1, new Vec3(-TableScene.RacketOffCentre, TableScene.RacketHeight, -EndZ), new Vec3(0, 0, 1), Math.PI / 4);
        this.Ball.Place(TableScene.BallAt);
    }

    /** How many rackets are drawn; the rest are hidden until posed. */
    SetRacketCount(Count: number): void {
        this.Rackets.forEach((Each, Index) => { Each.Root.visible = Index < Count; });
    }

    /**
     * Racket Index at Centre, its hitting face along HittingNormal (toward the other end), rolled by
     * Roll (see RacketPose). Its holder sees the reverse, red side.
     */
    PoseRacket(Index: number, Centre: Vec3, HittingNormal: Vec3, Roll: number): void {
        while (this.Rackets.length <= Index) {
            const Made = new RacketView();
            this.Rackets.push(Made);
            this.Root.add(Made.Root);
        }
        this.Poses[Index] = new RacketPose(Centre, HittingNormal, Roll);
        this.Rackets[Index].Root.visible = true;
        this.Rackets[Index].Pose(Centre, HittingNormal.Negate(), Roll);
    }

    PlaceBall(Centre: Vec3): void { this.Ball.Place(Centre); }

    /** The ball after each physics step of Seconds, once per step, for its trail and its turning. */
    RecordBall(After: BallState, Seconds: number): void { this.Ball.Record(After, Seconds); }

    /** The ball, centred at Centre, struck the tabletop; SpeedChange (m/s) is how much that changed its velocity. */
    TableImpact(Centre: Vec3, SpeedChange: number): void {
        this.Contacts.Strike(new Vec3(Centre.X, 0, Centre.Z), Vec3.Up, SpeedChange);
    }

    /** The ball, centred at Centre, struck racket Index as last drawn: a mark under the ball on both faces, riding on the blade. */
    RacketImpact(Index: number, Centre: Vec3, SpeedChange: number): void {
        const Racket = this.Rackets[Index];
        if (Racket === undefined) return;
        const Local = Racket.Root.worldToLocal(new THREE.Vector3(Centre.X, Centre.Y, Centre.Z));
        for (const Face of [1, -1])
            this.Contacts.Strike(new Vec3(Local.x, Local.y, Face * 0.0076), new Vec3(0, 0, Face), SpeedChange, Racket.Root);
    }

    /** Ages the impact marks by Seconds of game time; once per frame. */
    Advance(Seconds: number): void { this.Contacts.Advance(Seconds); }

    /** A stroke: sparks along the way the ball left, and a flash, both as strong as the stroke was hard. */
    Hit(Racket: number, At: Vec3, SpeedChange: number, Ball: BallState): void {
        const Hard = Math.min(1, (SpeedChange - TableScene.SparksFrom) / (TableScene.SparksFull - TableScene.SparksFrom));
        if (Hard <= 0) return;
        const Tint = Racket === 0 ? TableScene.Warm : TableScene.Cool;
        this.Flying.Burst(At, Ball.Velocity.Normalized(), Math.round(6 + 22 * Hard), 1.2 + 2.6 * Hard, 0.55, Tint, 0.012 + 0.012 * Hard, 0.28);
        this.Flash.color.copy(Tint);
        this.Flash.position.set(At.X, At.Y, At.Z);
        this.FlashLeft = TableScene.FlashLasts * Hard;
    }

    /** A bounce: a small pale puff off the table, for all but the softest. */
    Bounce(At: Vec3, SpeedChange: number): void {
        if (SpeedChange < 3) return;
        const Hard = Math.min(1, SpeedChange / 10);
        this.Flying.Burst(new Vec3(At.X, 0.004, At.Z), Vec3.Up, Math.round(3 + 7 * Hard), 0.35 + 0.6 * Hard, 0.75, TableScene.Pale, 0.008, 0.2);
    }

    /** The net shivers off a few pale specks where the ball touched it. */
    Net(At: Vec3, SpeedChange: number): void {
        if (SpeedChange < 1) return;
        this.Flying.Burst(At, Vec3.Up, 5, 0.5, 0.9, TableScene.Pale, 0.007, 0.22);
    }

    /** Once a frame: the hall moves on real time (it is watched, not played); what flew off the ball ages with the game. */
    Frame(RealSeconds: number, GameSeconds: number, _View: RallyView): void {
        this.Hall.Advance(RealSeconds);
        this.Flying.Advance(GameSeconds);
        this.FlashLeft = Math.max(0, this.FlashLeft - GameSeconds);
        this.Flash.intensity = TableScene.FlashBright * (this.FlashLeft / TableScene.FlashLasts) ** 2;
    }
}
