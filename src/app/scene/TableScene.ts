import * as THREE from "three";
import { BallState } from "../../engine/BallState";
import { TableSpec } from "../../engine/Specs";
import { Vec3 } from "../../engine/math/Vec3";
import { PlayerGrip } from "../../game/control/PlayerGrip";
import { RacketPose } from "../../game/control/RacketPose";
import * as ArenaView from "./ArenaView";
import { BallView } from "./BallView";
import { Impacts } from "./Impacts";
import { RacketView } from "./RacketView";

/**
 * Everything drawn in 3D: the hall, every racket and the ball. Each is posed at a ready stance
 * here, then moved every frame through PoseRacket and PlaceBall. Racket 0 is this machine's player;
 * the rest follow the rally's seats, so a table of four draws four. The scene only reads game
 * state and never changes it.
 */
export class TableScene {
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

    constructor() {
        this.Root.add(ArenaView.Build(), this.Ball.Root, this.Contacts.Root);
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
}
