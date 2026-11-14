import * as THREE from "three";
import { BallState } from "../../engine/BallState";
import { BallSpec } from "../../engine/Specs";
import { Vec3 } from "../../engine/math/Vec3";
import { SpinVector } from "../../engine/SpinVector";
import { Canvas, Glow } from "./Textures";

/**
 * The ball as a real one looks: matte white plastic with a faint seam round its equator, where the
 * two halves are joined, and a small print on either side, three stars and a ring, as real balls
 * carry. The print is what shows the spin: the ball turns with it, so a plain sphere's spin,
 * invisible, can be read. A ribbon of light follows it and a faint halo sits round it, and both
 * take the spin's colour: warm for topspin, cool for backspin, violet for sidespin, stronger the
 * more there is, so the spin on a ball can be read from across the table before it lands.
 */
export class BallView {
    /**
     * TUNED: the most the ball is seen to turn, rev/s. Real spin of 40 to 100 rev/s at 60 frames a
     * second would turn it most of a revolution between frames and read as a random flicker, or as
     * turning backwards; shown spin rises with real spin but never past this, so its sense and its
     * strength still read.
     */
    private static readonly MostShownRevs = 8;

    /** TUNED: the trail keeps this many points, one every TrailEvery physics steps: about a quarter of a game second of flight. */
    private static readonly TrailPoints = 40;
    private static readonly TrailEvery = 3;

    /** TUNED: the trail's half width at the ball, m: a little inside the ball's own outline. */
    private static readonly TrailHalfWidth = 0.016;

    /** TUNED: the spin, rev/s, at which the colour is about three quarters of full; a loop drive carries 50 or more. */
    private static readonly VividRevs = 30;

    /** TUNED: the spin colours. Warm and cool are told apart by brightness as well as hue. */
    private static readonly Plain = new THREE.Color("#ffffff");
    private static readonly Topspin = new THREE.Color("#ff8a2e");
    private static readonly Backspin = new THREE.Color("#3fa9ff");
    private static readonly Sidespin = new THREE.Color("#c684ff");

    readonly Root = new THREE.Group();
    private readonly Sprite: THREE.Mesh;
    private readonly Halo: THREE.Sprite;
    private readonly Turned = new THREE.Quaternion();
    private readonly Step = new THREE.Quaternion();
    private readonly Axis = new THREE.Vector3();
    private readonly Path: { At: Vec3; Tint: THREE.Color; Strength: number }[] = [];
    private readonly Trail: THREE.Mesh;
    private readonly TrailAt: THREE.BufferAttribute;
    private readonly TrailOther: THREE.BufferAttribute;
    private readonly TrailSide: THREE.BufferAttribute;
    private readonly TrailTint: THREE.BufferAttribute;
    private readonly Tint = new THREE.Color("#ffffff");
    private Strength = 0;
    private Pace = 0;
    private Steps = 0;

    constructor() {
        const Shell = new THREE.CanvasTexture(BallView.Shell());
        Shell.colorSpace = THREE.SRGBColorSpace;
        Shell.anisotropy = 4;
        this.Sprite = new THREE.Mesh(new THREE.SphereGeometry(BallSpec.Radius, 40, 24),
            new THREE.MeshStandardMaterial({ map: Shell, roughness: 0.42, emissive: "#ffffff", emissiveMap: Shell, emissiveIntensity: 0.22 }));
        this.Sprite.castShadow = true;

        this.Halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: Glow(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.1 }));
        this.Halo.scale.setScalar(BallSpec.Radius * 7);
        this.Halo.renderOrder = 3;

        // Two vertices per point, pushed apart on screen by the shader, make a ribbon that always faces the eye.
        const Most = (BallView.TrailPoints + 1) * 2;
        this.TrailAt = new THREE.BufferAttribute(new Float32Array(Most * 3), 3);
        this.TrailOther = new THREE.BufferAttribute(new Float32Array(Most * 3), 3);
        this.TrailSide = new THREE.BufferAttribute(new Float32Array(Most), 1);
        this.TrailTint = new THREE.BufferAttribute(new Float32Array(Most * 4), 4);
        const Ribbon = new THREE.BufferGeometry();
        Ribbon.setAttribute("position", this.TrailAt);
        Ribbon.setAttribute("Other", this.TrailOther);
        Ribbon.setAttribute("Side", this.TrailSide);
        Ribbon.setAttribute("Tint", this.TrailTint);
        const Corners: number[] = [];
        for (let At = 0; At < BallView.TrailPoints; At++) Corners.push(At * 2, At * 2 + 1, At * 2 + 2, At * 2 + 1, At * 2 + 3, At * 2 + 2);
        Ribbon.setIndex(Corners);
        this.Trail = new THREE.Mesh(Ribbon, new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
            uniforms: { HalfWidth: { value: BallView.TrailHalfWidth } },
            vertexShader: `
                attribute vec3 Other; attribute float Side; attribute vec4 Tint;
                uniform float HalfWidth;
                varying vec4 vTint; varying float vAcross;
                void main() {
                    vec4 Here = modelViewMatrix * vec4(position, 1.0);
                    vec4 There = modelViewMatrix * vec4(Other, 1.0);
                    vec2 Along = There.xy - Here.xy;
                    float Long = length(Along);
                    vec2 Across = Long > 1e-6 ? vec2(-Along.y, Along.x) / Long : vec2(1.0, 0.0);
                    Here.xy += Across * Side * HalfWidth;
                    vTint = Tint;
                    vAcross = sign(Side);
                    gl_Position = projectionMatrix * Here;
                }`,
            fragmentShader: `
                varying vec4 vTint; varying float vAcross;
                void main() {
                    float Soft = 1.0 - vAcross * vAcross;
                    gl_FragColor = vec4(vTint.rgb * vTint.a * Soft, 1.0);
                }`,
        }));
        this.Trail.frustumCulled = false;
        this.Trail.renderOrder = 3;
        this.Root.add(this.Sprite, this.Halo, this.Trail);
    }

    Place(Position: Vec3): void {
        this.Sprite.position.set(Position.X, Position.Y, Position.Z);
        this.Sprite.quaternion.copy(this.Turned);
        this.Halo.position.copy(this.Sprite.position);
        const Halo = this.Halo.material;
        Halo.color.copy(this.Tint);
        Halo.opacity = 0.08 + 0.42 * this.Strength;
        this.DrawTrail(Position);
    }

    /** The ball after a physics step of Seconds: its trail grows, and it turns by its spin, as shown. */
    Record(Ball: BallState, Seconds: number): void {
        const Last = this.Path[this.Path.length - 1];
        // A ball that jumped was put there (a new feed): its trail starts again, so it never streaks across the hall.
        if (Last !== undefined && Ball.Position.Minus(Last.At).Length() > 0.2) this.Path.length = 0;
        this.ReadSpin(Ball);
        if (this.Steps++ % BallView.TrailEvery === 0) {
            this.Path.push({ At: Ball.Position, Tint: this.Tint.clone(), Strength: this.Strength });
            if (this.Path.length > BallView.TrailPoints) this.Path.shift();
        }
        const Spin = Ball.Spin;
        const Revs = Spin.Length() / (2 * Math.PI);
        if (Revs < 1e-6) return;
        const Shown = BallView.MostShownRevs * Math.tanh(Revs / BallView.MostShownRevs);
        // Turned about a world axis: the step's turn comes first in the product.
        this.Step.setFromAxisAngle(this.Axis.set(Spin.X, Spin.Y, Spin.Z).normalize(), Shown * 2 * Math.PI * Seconds);
        this.Turned.premultiply(this.Step).normalize();
    }

    /** The colour and strength the ball's spin shows as, and how fast it is going. */
    private ReadSpin(Ball: BallState): void {
        const Top = SpinVector.TopRevs(Ball.Velocity, Ball.Spin), Side = Math.abs(SpinVector.SideRevs(Ball.Spin));
        const All = Math.abs(Top) + Side;
        this.Pace = Ball.Velocity.Length();
        this.Strength = Math.tanh(All / BallView.VividRevs);
        if (All < 1e-6) { this.Tint.copy(BallView.Plain); return; }
        this.Tint.copy(Top > 0 ? BallView.Topspin : BallView.Backspin).lerp(BallView.Sidespin, Side / All);
        this.Tint.lerpColors(BallView.Plain, this.Tint.clone(), this.Strength);
    }

    /** The ribbon from the oldest kept point to the ball as drawn, thin and faint at its tail. */
    private DrawTrail(Now: Vec3): void {
        const Points = this.Path, Count = Points.length + 1;
        // TUNED: a slow ball leaves almost no trail; a drive leaves a bright one.
        const Bright = Math.min(1, this.Pace / 9) * 0.55 + 0.08 + 0.25 * this.Strength;
        for (let At = 0; At < Count; At++) {
            const Here = At < Points.length ? Points[At].At : Now;
            // Each point looks toward the next; the last looks back, with its sides swapped to match.
            const Forward = At < Count - 1;
            const There = Forward ? (At + 1 < Points.length ? Points[At + 1].At : Now) : (Points.length > 0 ? Points[Points.length - 1].At : Now);
            const Through = Count > 1 ? At / (Count - 1) : 1;
            const Tint = At < Points.length ? Points[At].Tint : this.Tint;
            for (const Edge of [0, 1]) {
                const Slot = At * 2 + Edge;
                this.TrailAt.setXYZ(Slot, Here.X, Here.Y, Here.Z);
                this.TrailOther.setXYZ(Slot, There.X, There.Y, There.Z);
                this.TrailSide.setX(Slot, (Edge === 0 ? -1 : 1) * (Forward ? 1 : -1) * Through);
                this.TrailTint.setXYZW(Slot, Tint.r, Tint.g, Tint.b, Bright * Through * Through);
            }
        }
        this.Trail.geometry.setDrawRange(0, Math.max(0, Count - 1) * 6);
        this.TrailAt.needsUpdate = this.TrailOther.needsUpdate = this.TrailSide.needsUpdate = this.TrailTint.needsUpdate = true;
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
