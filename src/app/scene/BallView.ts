import * as THREE from "three";
import { BallState } from "../../engine/BallState";
import { BallSpec } from "../../engine/Specs";
import { Vec3 } from "../../engine/math/Vec3";
import { Canvas } from "./Textures";

/**
 * The ball as a real one looks: matte white plastic with a faint seam round its equator, where the
 * two halves are joined, and a small print on either side, three stars and a ring, as real balls
 * carry. The print is what shows the spin: the ball turns with it, so a plain sphere's spin,
 * invisible, can be read. A short fading trail follows it.
 */
export class BallView {
    /**
     * TUNED: the most the ball is seen to turn, rev/s. Real spin of 40 to 100 rev/s at 60 frames a
     * second would turn it most of a revolution between frames and read as a random flicker, or as
     * turning backwards; shown spin rises with real spin but never past this, so its sense and its
     * strength still read.
     */
    private static readonly MostShownRevs = 8;

    /** TUNED: how much of the ball's recent path the trail shows, physics steps. */
    private static readonly TrailSteps = 72;

    readonly Root = new THREE.Group();
    private readonly Sprite: THREE.Mesh;
    private readonly Turned = new THREE.Quaternion();
    private readonly Step = new THREE.Quaternion();
    private readonly Axis = new THREE.Vector3();
    private readonly Path: Vec3[] = [];
    private readonly Trail: THREE.Line;
    private readonly TrailAt: THREE.BufferAttribute;
    private readonly TrailTint: THREE.BufferAttribute;

    constructor() {
        const Shell = new THREE.CanvasTexture(BallView.Shell());
        Shell.colorSpace = THREE.SRGBColorSpace;
        this.Sprite = new THREE.Mesh(new THREE.SphereGeometry(BallSpec.Radius, 32, 20),
            new THREE.MeshStandardMaterial({ map: Shell, roughness: 0.55, emissive: "#ffffff", emissiveMap: Shell, emissiveIntensity: 0.14 }));
        this.Sprite.castShadow = true;

        const Points = new Float32Array(BallView.TrailSteps * 3), Tints = new Float32Array(BallView.TrailSteps * 4);
        this.TrailAt = new THREE.BufferAttribute(Points, 3);
        this.TrailTint = new THREE.BufferAttribute(Tints, 4);
        const Geometry = new THREE.BufferGeometry();
        Geometry.setAttribute("position", this.TrailAt);
        Geometry.setAttribute("color", this.TrailTint);
        this.Trail = new THREE.Line(Geometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
        this.Trail.frustumCulled = false;
        this.Root.add(this.Sprite, this.Trail);
    }

    Place(Position: Vec3): void {
        this.Sprite.position.set(Position.X, Position.Y, Position.Z);
        this.Sprite.quaternion.copy(this.Turned);
        this.DrawTrail(Position);
    }

    /** The ball after a physics step of Seconds: its trail grows, and it turns by its spin, as shown. */
    Record(Ball: BallState, Seconds: number): void {
        this.Path.push(Ball.Position);
        if (this.Path.length > BallView.TrailSteps - 1) this.Path.shift();
        const Spin = Ball.Spin;
        const Revs = Spin.Length() / (2 * Math.PI);
        if (Revs < 1e-6) return;
        const Shown = BallView.MostShownRevs * Math.tanh(Revs / BallView.MostShownRevs);
        // Turned about a world axis: the step's turn comes first in the product.
        this.Step.setFromAxisAngle(this.Axis.set(Spin.X, Spin.Y, Spin.Z).normalize(), Shown * 2 * Math.PI * Seconds);
        this.Turned.premultiply(this.Step).normalize();
    }

    /** A trail that breaks where the ball jumped (a new feed), so it never streaks across the hall. */
    private DrawTrail(Now: Vec3): void {
        let Count = 0;
        const Points = [...this.Path, Now];
        let From = 0;
        for (let At = 1; At < Points.length; At++) if (Points[At].Minus(Points[At - 1]).Length() > 0.2) From = At;
        for (let At = From; At < Points.length; At++, Count++) {
            const P = Points[At], Fade = (At - From) / Math.max(1, Points.length - 1 - From);
            this.TrailAt.setXYZ(Count, P.X, P.Y, P.Z);
            this.TrailTint.setXYZW(Count, 1, 1, 1, 0.42 * Fade * Fade);
        }
        this.Trail.geometry.setDrawRange(0, Count);
        this.TrailAt.needsUpdate = true;
        this.TrailTint.needsUpdate = true;
    }

    /**
     * Off-white with the seam a shade darker. The sphere's V runs pole to pole, so the equator is
     * mid-height; the stars sit above it on one side and the ring below it on the other.
     */
    private static Shell(): HTMLCanvasElement {
        const Width = 512, Height = 256;
        const [Sheet, Pen] = Canvas(Width, Height);
        Pen.fillStyle = "#f7f7f3";
        Pen.fillRect(0, 0, Width, Height);
        Pen.fillStyle = "#d9d9d3";
        Pen.fillRect(0, Height / 2 - 1.2, Width, 2.4);
        Pen.fillStyle = "#2a2a2e";
        // TUNED: three stars in a row on one side and a bold ring on the other: a real ball's print,
        // a little large so that it still shows, and shows the ball turning, at the length of the table.
        for (let Star = -1; Star <= 1; Star++) BallView.StarAt(Pen, Width * 0.25 + Star * 34, Height * 0.34, 17);
        Pen.lineWidth = 9;
        Pen.strokeStyle = "#2a2a2e";
        Pen.beginPath();
        Pen.arc(Width * 0.75, Height * 0.66, 16.5, 0, Math.PI * 2);
        Pen.stroke();
        return Sheet;
    }

    /** A five-pointed star of tip radius Outer, pointing up. */
    private static StarAt(Pen: CanvasRenderingContext2D, X: number, Y: number, Outer: number): void {
        Pen.beginPath();
        for (let Point = 0; Point < 10; Point++) {
            const Radius = Point % 2 === 0 ? Outer : Outer * 0.42, Angle = Point * Math.PI / 5;
            Pen.lineTo(X + Radius * Math.sin(Angle), Y - Radius * Math.cos(Angle));
        }
        Pen.closePath();
        Pen.fill();
    }
}
