import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

/** How much is drawn, cheapest first. */
export const Qualities = ["low", "medium", "high", "ultra"] as const;
export type Quality = typeof Qualities[number];

/**
 * What each quality costs. TUNED: Low is the plain render for an old laptop; Medium adds the glow
 * and the lens; High smooths every edge and sharpens the shadows; Ultra is for a strong card.
 */
const Settings: Record<Quality, { Pixels: number; Shadow: number; Lens: boolean; Samples: number }> = {
    low:    { Pixels: 1,    Shadow: 1024, Lens: false, Samples: 0 },
    medium: { Pixels: 1.25, Shadow: 2048, Lens: true,  Samples: 0 },
    high:   { Pixels: 1.5,  Shadow: 2048, Lens: true,  Samples: 4 },
    ultra:  { Pixels: 2,    Shadow: 4096, Lens: true,  Samples: 4 },
};

/**
 * The lens, applied to the picture before it is tone mapped: a slight colour fringe and darkening
 * toward the corners, a little more colour, and a fine grain so dark gradients never band. TUNED
 * to be felt rather than noticed.
 */
const Lens = {
    uniforms: { tDiffuse: { value: null }, Time: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
        uniform sampler2D tDiffuse; uniform float Time;
        varying vec2 vUv;
        float Hash(vec2 P) { return fract(sin(dot(P, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
            vec2 Off = vUv - 0.5;
            float Out = dot(Off, Off);
            vec2 Fringe = Off * Out * 0.006;
            vec3 Seen = vec3(texture2D(tDiffuse, vUv + Fringe).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - Fringe).b);
            Seen *= mix(1.0, 0.58, smoothstep(0.12, 0.62, Out));
            float Light = dot(Seen, vec3(0.2126, 0.7152, 0.0722));
            Seen = max(vec3(0.0), mix(vec3(Light), Seen, 1.1));
            Seen += (Hash(vUv * 917.0 + Time) - 0.5) * 0.006 * (0.3 + Light);
            gl_FragColor = vec4(Seen, 1.0);
        }`,
};

/**
 * The renderer and everything between the scene and the screen: shadows, the glow round bright
 * things, the lens, tone mapping, and the quality setting that trades them for frame rate. With
 * no setting chosen it watches the frame rate for the first seconds and steps the quality down
 * until the game is smooth, since a smooth rally matters more than a pretty one.
 */
export class Graphics {
    /** TUNED: after Warmup s, a Window s average frame slower than Slow s steps the quality down. */
    private static readonly Warmup = 2.0;
    private static readonly Window = 1.5;
    private static readonly Slow = 1 / 42;

    readonly Renderer: THREE.WebGLRenderer;
    private Composer: EffectComposer | null = null;
    private LensPass: ShaderPass | null = null;
    private Level: Quality = "high";
    private Auto = true;
    private Watched = 0;
    private Frames = 0;
    private Since = 0;
    private Clock = 0;

    constructor(private readonly Stage: HTMLElement,
                private readonly Scene: THREE.Scene,
                private readonly Camera: THREE.PerspectiveCamera,
                private readonly Key: THREE.SpotLight) {
        this.Renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
        this.Renderer.shadowMap.enabled = true;
        this.Renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.Renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.Renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.Renderer.toneMappingExposure = 1.0;
        Stage.append(this.Renderer.domElement);
        this.Apply();
    }

    Quality(): Quality { return this.Level; }

    /** Draws at Level from now on; chosen by hand (Pinned), the frame rate no longer changes it. */
    SetQuality(Level: Quality, Pinned = true): void {
        this.Level = Level;
        if (Pinned) this.Auto = false;
        this.Apply();
    }

    /** Fits the picture to the stage, after a resize or a change of quality. */
    Resize(): void {
        const Width = this.Stage.clientWidth, Height = this.Stage.clientHeight;
        const Pixels = Math.min(window.devicePixelRatio, Settings[this.Level].Pixels);
        this.Renderer.setPixelRatio(Pixels);
        this.Renderer.setSize(Width, Height, false);
        this.Composer?.setPixelRatio(Pixels);
        this.Composer?.setSize(Width, Height);
        this.Camera.aspect = Width / Math.max(1, Height);
        this.Camera.updateProjectionMatrix();
    }

    /** Draws one frame, RealSeconds after the last. */
    Render(RealSeconds = 0): void {
        this.Clock += RealSeconds;
        if (this.LensPass !== null) this.LensPass.uniforms.Time.value = this.Clock % 10;
        if (this.Composer !== null) this.Composer.render();
        else this.Renderer.render(this.Scene, this.Camera);
        if (this.Auto) this.Watch(RealSeconds);
    }

    /**
     * Captures Surround (the hall without the table) as the scene's surroundings, so the tabletop,
     * the ball and the rackets carry the hall's lights in their sheen. Called once the hall's
     * images have arrived.
     */
    Surroundings(Surround: THREE.Object3D): void {
        const Home = Surround.parent;
        const Alone = new THREE.Scene();
        Alone.add(Surround, new THREE.AmbientLight("#ffffff", 0.6));
        const Maker = new THREE.PMREMGenerator(this.Renderer);
        const Before = this.Scene.environment;
        this.Scene.environment = Maker.fromScene(Alone, 0.03, 0.1, 40).texture;
        this.Scene.environmentIntensity = 0.5;
        Before?.dispose();
        Maker.dispose();
        Home?.add(Surround);
    }

    private Apply(): void {
        const Chosen = Settings[this.Level];
        this.Key.shadow.mapSize.set(Chosen.Shadow, Chosen.Shadow);
        this.Key.shadow.map?.dispose();
        this.Key.shadow.map = null;
        this.Composer?.dispose();
        this.Composer = null;
        this.LensPass = null;
        if (Chosen.Lens) {
            const Size = this.Renderer.getDrawingBufferSize(new THREE.Vector2());
            const Target = new THREE.WebGLRenderTarget(Math.max(1, Size.x), Math.max(1, Size.y), { type: THREE.HalfFloatType, samples: Chosen.Samples });
            this.Composer = new EffectComposer(this.Renderer, Target);
            this.Composer.addPass(new RenderPass(this.Scene, this.Camera));
            // TUNED: only what is brighter than white glows: the lamps, the boards' words, the arches' strips, the sparks.
            this.Composer.addPass(new UnrealBloomPass(new THREE.Vector2(Size.x, Size.y), 0.4, 0.55, 1.0));
            this.LensPass = new ShaderPass(Lens);
            this.Composer.addPass(this.LensPass);
            this.Composer.addPass(new OutputPass());
        }
        this.Resize();
        this.Watched = this.Frames = this.Since = 0;
    }

    /** Counts frames; a slow window steps the quality down once, and the watch starts again. */
    private Watch(RealSeconds: number): void {
        this.Watched += RealSeconds;
        if (this.Watched < Graphics.Warmup || document.hidden) return;
        this.Frames++;
        this.Since += RealSeconds;
        if (this.Since < Graphics.Window) return;
        const Average = this.Since / this.Frames, At = Qualities.indexOf(this.Level);
        if (Average > Graphics.Slow && At > 0) this.SetQuality(Qualities[At - 1], false);
        else if (Average <= Graphics.Slow) this.Auto = false;   // smooth: settled here
        this.Frames = this.Since = 0;
    }
}
