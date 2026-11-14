import * as THREE from "three";
import { Vec3 } from "../../engine/math/Vec3";
import * as Textures from "./Textures";

/**
 * Short-lived specks of light thrown off a contact: sparks from a hard stroke, a puff where the
 * ball lands. A fixed pool drawn as one set of points, so a rally of any length costs the same.
 * They are decoration: nothing reads them back.
 */
export class Sparks {
    /** The most specks alive at once; a new one takes the oldest's place. */
    private static readonly Pool = 320;

    /** How hard the specks fall, m/s²: a fraction of gravity, so they hang a moment. TUNED. */
    private static readonly Fall = 3.0;

    readonly Root: THREE.Points;
    private readonly At: THREE.BufferAttribute;
    private readonly Tint: THREE.BufferAttribute;
    private readonly Size: THREE.BufferAttribute;
    private readonly Speed = new Float32Array(Sparks.Pool * 3);
    private readonly Age = new Float32Array(Sparks.Pool);
    private readonly Life = new Float32Array(Sparks.Pool).fill(0);
    private readonly Born = new Float32Array(Sparks.Pool * 4);
    private Next = 0;

    constructor() {
        const Cloud = new THREE.BufferGeometry();
        this.At = new THREE.BufferAttribute(new Float32Array(Sparks.Pool * 3), 3);
        this.Tint = new THREE.BufferAttribute(new Float32Array(Sparks.Pool * 4), 4);
        this.Size = new THREE.BufferAttribute(new Float32Array(Sparks.Pool), 1);
        Cloud.setAttribute("position", this.At);
        Cloud.setAttribute("Tint", this.Tint);
        Cloud.setAttribute("Size", this.Size);
        const Paint = new THREE.ShaderMaterial({
            transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
            uniforms: { Map: { value: Textures.Glow() }, Scale: { value: 600 } },
            vertexShader: `
                attribute vec4 Tint; attribute float Size;
                uniform float Scale;
                varying vec4 vTint;
                void main() {
                    vTint = Tint;
                    vec4 Seen = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = Size * Scale / max(0.05, -Seen.z);
                    gl_Position = projectionMatrix * Seen;
                }`,
            fragmentShader: `
                uniform sampler2D Map;
                varying vec4 vTint;
                void main() { gl_FragColor = vec4(vTint.rgb * vTint.a * texture2D(Map, gl_PointCoord).a, 1.0); }`,
        });
        this.Root = new THREE.Points(Cloud, Paint);
        this.Root.frustumCulled = false;
        this.Root.renderOrder = 4;
        // A point's size is given in metres; this turns it into pixels for whatever is drawing it.
        this.Root.onBeforeRender = (Renderer, _Scene, Camera) => {
            const Tall = Renderer.getDrawingBufferSize(new THREE.Vector2()).y;
            Paint.uniforms.Scale.value = Tall * (Camera as THREE.PerspectiveCamera).projectionMatrix.elements[5] / 2;
        };
    }

    /**
     * Count specks from From, thrown about Toward (a direction) at up to Fastest m/s and spread
     * Spread (0 a jet, 1 every way), each Wide metres across and living about Lasts seconds.
     */
    Burst(From: Vec3, Toward: Vec3, Count: number, Fastest: number, Spread: number, Colour: THREE.Color, Wide: number, Lasts: number): void {
        for (let Made = 0; Made < Count; Made++) {
            const Slot = this.Next;
            this.Next = (this.Next + 1) % Sparks.Pool;
            // A random direction, pulled toward Toward by how narrow the spread is.
            const Turn = Math.random() * Math.PI * 2, Rise = Math.acos(2 * Math.random() - 1);
            const Any = new Vec3(Math.sin(Rise) * Math.cos(Turn), Math.cos(Rise), Math.sin(Rise) * Math.sin(Turn));
            const Way = Toward.Scale(1 - Spread).Plus(Any.Scale(Spread)).Normalized();
            const Pace = Fastest * (0.35 + 0.65 * Math.random());
            this.Speed.set([Way.X * Pace, Way.Y * Pace, Way.Z * Pace], Slot * 3);
            this.At.setXYZ(Slot, From.X, From.Y, From.Z);
            this.Born.set([Colour.r, Colour.g, Colour.b, Wide * (0.6 + 0.8 * Math.random())], Slot * 4);
            this.Age[Slot] = 0;
            this.Life[Slot] = Lasts * (0.6 + 0.8 * Math.random());
        }
    }

    /** Ages every speck by Seconds. */
    Advance(Seconds: number): void {
        let Any = false;
        for (let Slot = 0; Slot < Sparks.Pool; Slot++) {
            if (this.Life[Slot] <= 0) continue;
            Any = true;
            this.Age[Slot] += Seconds;
            const Through = this.Age[Slot] / this.Life[Slot];
            if (Through >= 1) {
                this.Life[Slot] = 0;
                this.Tint.setW(Slot, 0);
                this.Size.setX(Slot, 0);
                continue;
            }
            this.Speed[Slot * 3 + 1] -= Sparks.Fall * Seconds;
            this.At.setXYZ(Slot, this.At.getX(Slot) + this.Speed[Slot * 3] * Seconds, this.At.getY(Slot) + this.Speed[Slot * 3 + 1] * Seconds,
                           this.At.getZ(Slot) + this.Speed[Slot * 3 + 2] * Seconds);
            const Fade = (1 - Through) * (1 - Through);
            this.Tint.setXYZW(Slot, this.Born[Slot * 4], this.Born[Slot * 4 + 1], this.Born[Slot * 4 + 2], Fade);
            this.Size.setX(Slot, this.Born[Slot * 4 + 3] * (0.5 + 0.5 * Fade));
        }
        if (Any) this.At.needsUpdate = this.Tint.needsUpdate = this.Size.needsUpdate = true;
    }
}
