import * as THREE from "three";
import { BallSpec, NetSpec, TableSpec } from "../../engine/Specs";
import * as Art from "./Art";
import * as Textures from "./Textures";

/**
 * The hall: one show-court table under a lighting rig, in a dark arena full of people. Physics and
 * Three.js share one frame (metres, right-handed, +Y up, origin at the centre of the tabletop), so
 * every size here is read straight from the engine's specs. Collision surfaces keep the engine's
 * dimensions; decorative proportions are TUNED multiples of them. The arena stays far darker than
 * the playing surface, which gives the white ball a reliable silhouette, and nothing bright sits
 * at the ball's usual height behind the far end except the boards, held well under white.
 * Built once; only the boards, the dust and the crowd's flashes move.
 */

/** ITTF Laws 2.1.4 and 2.1.6: side and end lines equal a ball radius; the doubles line is 15% of it. */
const LineWidth = BallSpec.Radius;
const CentreLineWidth = BallSpec.Radius * 0.15;

/** TUNED: enough separation to beat depth fighting without a visibly floating marking. */
const LineLift = TableSpec.TopThickness * 0.04;

const BothSides = [-1, 1];
const FloorY = -TableSpec.Height;

/** TUNED: the arena, m: the grandstands' faces and the roof. */
export const HalfWidth = 10, HalfLength = 12, CeilingY = 8.6;

/** [ITTF] 3.2.3.1: the playing space is at least 14 m long and 7 m wide; its red mat and the boards round it. */
const CourtHalfWidth = 3.5, CourtHalfLength = 7;

/** TUNED: the perimeter boards, m: LED surrounds are about 0.75 m tall. */
const BoardHeight = 0.75, BoardThickness = 0.08;

/** TUNED: where the lighting rig hangs over the table, m. */
const RigY = 7.6;

function Box(Width: number, Height: number, Depth: number, X: number, Y: number, Z: number, Paint: THREE.Material, Shadows = true): THREE.Mesh {
    const Made = new THREE.Mesh(new THREE.BoxGeometry(Width, Height, Depth), Paint);
    Made.position.set(X, Y, Z);
    Made.castShadow = Shadows;
    Made.receiveShadow = Shadows;
    return Made;
}

/** The top sits exactly at y = 0, matching the engine's table slab, thickness included. */
function TableTop(): THREE.Mesh {
    return Box(TableSpec.Width, TableSpec.TopThickness, TableSpec.Length, 0, -TableSpec.TopThickness / 2, 0, Textures.Table());
}

function Markings(): THREE.Group {
    const Lines = new THREE.Group();
    const White = new THREE.MeshStandardMaterial({ color: "#c4cccc", roughness: 0.55 });
    const Flat = (Width: number, Length: number, X: number, Z: number) => {
        const Strip = new THREE.Mesh(new THREE.PlaneGeometry(Width, Length), White);
        Strip.rotation.x = -Math.PI / 2;
        Strip.position.set(X, LineLift, Z);
        Strip.receiveShadow = true;
        Lines.add(Strip);
    };
    for (const Side of BothSides) {
        Flat(LineWidth, TableSpec.Length, Side * (TableSpec.HalfWidth - LineWidth / 2), 0);
        Flat(TableSpec.Width, LineWidth, 0, Side * (TableSpec.HalfLength - LineWidth / 2));
    }
    Flat(CentreLineWidth, TableSpec.Length, 0, 0);
    return Lines;
}

/** An arch seen from the side (x across, y up), Outer and Inner half spans and heights in metres, standing on y = 0. */
function Arch(OuterSpan: number, OuterRise: number, InnerSpan: number, InnerRise: number): THREE.Shape {
    const Outline = new THREE.Shape();
    Outline.absellipse(0, 0, OuterSpan, OuterRise, 0, Math.PI, false);
    Outline.absellipse(0, 0, InnerSpan, InnerRise, Math.PI, 0, true);
    Outline.closePath();
    return Outline;
}

/**
 * The undercarriage of a show-court table: a dark apron under a thin bright rim makes the slab's
 * thickness visible from the player's view, and the top rides on two arches that run the table's
 * length, each with a strip of light along its inside. None of it is part of the collision world.
 */
function Frame(): THREE.Group {
    const Parts = new THREE.Group();
    const Metal = Textures.Solid("#10151d", 0.38, 0.75);
    const Rim = Textures.Solid("#8e9daa", 0.4, 0.8);
    const Slab = TableSpec.TopThickness, Apron = Slab * 3, Inset = Slab * 0.4;
    for (const Side of BothSides) {
        Parts.add(Box(Slab, Apron, TableSpec.Length - Inset * 2, Side * (TableSpec.HalfWidth - Inset), -Slab - Apron / 2, 0, Metal),
                  Box(TableSpec.Width - Inset * 2, Apron, Slab, 0, -Slab - Apron / 2, Side * (TableSpec.HalfLength - Inset), Metal),
                  Box(Slab * 0.25, Slab * 0.18, TableSpec.Length, Side * TableSpec.HalfWidth, -Slab * 0.75, 0, Rim),
                  Box(TableSpec.Width, Slab * 0.18, Slab * 0.25, 0, -Slab * 0.75, Side * TableSpec.HalfLength, Rim));
    }
    // The arches stand on the floor and stop under the apron. TUNED proportions.
    const Rise = TableSpec.Height - Slab - Apron, Span = TableSpec.HalfLength * 0.86, Thick = 0.11, Deep = 0.085;
    const Body = new THREE.ExtrudeGeometry(Arch(Span, Rise, Span - Thick, Rise - Thick),
                                           { depth: Deep, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 3, curveSegments: 48 });
    const Strip = new THREE.ExtrudeGeometry(Arch(Span - Thick + 0.004, Rise - Thick + 0.004, Span - Thick - 0.008, Rise - Thick - 0.008),
                                            { depth: Deep * 0.5, bevelEnabled: false, curveSegments: 48 });
    const Light = new THREE.MeshBasicMaterial({ color: new THREE.Color("#4fb4ff").multiplyScalar(1.7) });
    for (const Side of BothSides) {
        const Leg = new THREE.Mesh(Body, Metal), Lit = new THREE.Mesh(Strip, Light);
        // The shapes are drawn across x; a quarter turn lays them along the table.
        for (const Each of [Leg, Lit]) { Each.rotation.y = Math.PI / 2; Each.position.set(Side * TableSpec.Width * 0.3 - Deep / 2, FloorY, 0); }
        Lit.position.x += Deep * 0.25;
        Leg.castShadow = Leg.receiveShadow = true;
        Parts.add(Leg, Lit);
    }
    // Cross members tie the arches under the top, and pads spread their feet.
    for (const End of BothSides) {
        Parts.add(Box(TableSpec.Width * 0.6, 0.05, 0.07, 0, -Slab - Apron - 0.03, End * Span * 0.45, Metal));
        for (const Side of BothSides)
            Parts.add(Box(0.2, 0.025, 0.2, Side * TableSpec.Width * 0.3, FloorY + 0.0125, End * (Span - Thick / 2), Metal));
    }
    const Plaque = new THREE.Mesh(new THREE.PlaneGeometry(0.57, 0.056), Textures.Sign("3D TABLE TENNIS", "#dfe9f2", "#10151d", 1024, 100, 0.25));
    Plaque.position.set(0.40, -0.061, TableSpec.HalfLength + 0.003);
    Parts.add(Plaque);
    return Parts;
}

/**
 * Real opaque strands keep front/behind ordering through the net's holes. The mesh stays a little
 * coarser than regulation to survive pixel sampling at the far end; the cord's top stays at the
 * net height.
 */
function Net(): THREE.Group {
    const Netting = new THREE.Group();
    const Cord = Textures.Solid("#2c3a48", 0.9);
    const HalfNet = NetSpec.Width / 2;
    const Strand = NetSpec.Thickness / 4, TapeHeight = NetSpec.Thickness * 2;
    const Columns = Math.ceil(NetSpec.Width / (NetSpec.Height / 9));
    const Spacing = NetSpec.Width / Columns;
    const Rows: number[] = [];
    for (let Y = Spacing; Y < NetSpec.Height - TapeHeight; Y += Spacing) Rows.push(Y);
    const Upright = new THREE.InstancedMesh(new THREE.BoxGeometry(Strand, NetSpec.Height, Strand), Cord, Columns + 1);
    const Place = new THREE.Matrix4();
    for (let Column = 0; Column <= Columns; Column++) Upright.setMatrixAt(Column, Place.makeTranslation(-HalfNet + Column * Spacing, NetSpec.Height / 2, 0));
    const Level = new THREE.InstancedMesh(new THREE.BoxGeometry(NetSpec.Width, Strand, Strand), Cord, Rows.length);
    Rows.forEach((Y, Index) => Level.setMatrixAt(Index, Place.makeTranslation(0, Y, 0)));
    Upright.castShadow = Level.castShadow = true;
    Netting.add(Upright, Level,
                Box(NetSpec.Width, TapeHeight, NetSpec.Thickness * 2 / 3, 0, NetSpec.Height - TapeHeight / 2, 0, Textures.Tape()),
                Box(NetSpec.Width, Strand * 1.4, Strand * 1.4, 0, Strand, 0, Cord));
    const Metal = Textures.Solid("#1a222c", 0.3, 0.85), Cap = Textures.Solid("#c4d2dc", 0.25, 0.9);
    const Slab = TableSpec.TopThickness, Reach = (NetSpec.Width - TableSpec.Width) / 2;
    for (const Side of BothSides) {
        const X = Side * HalfNet;
        const Post = new THREE.Mesh(new THREE.CylinderGeometry(NetSpec.Thickness * 1.6, NetSpec.Thickness * 1.6, NetSpec.Height + Slab, 20), Metal);
        Post.position.set(X, (NetSpec.Height - Slab) / 2, 0);
        Post.castShadow = true;
        const Tip = new THREE.Mesh(new THREE.CylinderGeometry(NetSpec.Thickness * 1.65, NetSpec.Thickness * 1.65, NetSpec.Thickness * 0.6, 20), Cap);
        Tip.position.set(X, NetSpec.Height - NetSpec.Thickness * 0.3, 0);
        Netting.add(Post, Tip,
                    Box(Reach + Slab, Slab * 0.6, Slab * 2.5, Side * (TableSpec.HalfWidth + Reach / 2), -Slab * 0.6, 0, Metal),
                    Box(Slab, Slab * 2, Slab * 2.5, Side * (TableSpec.HalfWidth + Slab / 2), -Slab, 0, Metal));
    }
    return Netting;
}

/** A flat panel lying on the floor, Lift above it. */
function Laid(Width: number, Length: number, Lift: number, Paint: THREE.Material): THREE.Mesh {
    const Made = new THREE.Mesh(new THREE.PlaneGeometry(Width, Length), Paint);
    Made.rotation.x = -Math.PI / 2;
    Made.position.y = FloorY + Lift;
    Made.receiveShadow = true;
    return Made;
}

/** The floor: the arena's dark concrete, and on it the red mat of the playing space with its white edge. */
function Floor(): THREE.Group {
    const Ground = new THREE.Group();
    Ground.add(Laid(HalfWidth * 2, HalfLength * 2, 0, Textures.Solid("#0b0e14", 0.55, 0.1)));
    const Mat = Art.Court();
    // TUNED: the image covers 2.4 m of mat, which keeps its grain the size of real flooring's.
    Mat.repeat.set(CourtHalfWidth * 2 / 2.4, CourtHalfLength * 2 / 2.4);
    const Red = new THREE.MeshStandardMaterial({ map: Mat, color: "#b08484", roughness: 0.62, metalness: 0, bumpMap: Mat, bumpScale: 0.6 });
    Ground.add(Laid(CourtHalfWidth * 2, CourtHalfLength * 2, 0.002, Red));
    const Paint = Textures.Solid("#e9e4dc", 0.7);
    const Edge = 0.05, In = 0.25;
    for (const Side of BothSides) {
        const Along = Laid(Edge, (CourtHalfLength - In) * 2, 0.003, Paint), Across = Laid((CourtHalfWidth - In) * 2, Edge, 0.003, Paint);
        Along.position.x = Side * (CourtHalfWidth - In);
        Across.position.z = Side * (CourtHalfLength - In);
        Ground.add(Along, Across);
    }
    return Ground;
}

/**
 * The grandstands and the roof, as photographs on the arena's faces: they are far enough behind
 * the boards that a flat image reads as depth. Single-sided and facing inward, so a manual orbit
 * outside the hall sees through the nearest stand instead of losing the table behind it. They are
 * lit by nothing here (basic materials): their light is the photograph's own.
 */
function Stands(): THREE.Group {
    const Seats = new THREE.Group();
    const Height = CeilingY - FloorY;
    const Face = (Width: number, X: number, Z: number, Turn: number) => {
        const Crowd = Art.Crowd();
        // The photograph is 21:9; a longer wall repeats it mirrored.
        Crowd.repeat.set(Width / (Height * 21 / 9), 1);
        const Panel = new THREE.Mesh(new THREE.PlaneGeometry(Width, Height), new THREE.MeshBasicMaterial({ map: Crowd, color: "#b9c0cc" }));
        Panel.position.set(X, FloorY + Height / 2, Z);
        Panel.rotation.y = Turn;
        Seats.add(Panel);
    };
    Face(HalfWidth * 2, 0, -HalfLength, 0);
    Face(HalfWidth * 2, 0, HalfLength, Math.PI);
    Face(HalfLength * 2, -HalfWidth, 0, Math.PI / 2);
    Face(HalfLength * 2, HalfWidth, 0, -Math.PI / 2);
    const Roof = new THREE.Mesh(new THREE.PlaneGeometry(HalfWidth * 2, HalfLength * 2), new THREE.MeshBasicMaterial({ map: Art.Roof(), color: "#d5d9e0" }));
    Roof.rotation.x = Math.PI / 2;
    Roof.position.y = CeilingY;
    Seats.add(Roof);
    return Seats;
}

/** What an umpire's corner holds: the desk beside the net, and a towel box at each end, as show courts stand them. */
function Furniture(): THREE.Group {
    const Things = new THREE.Group();
    const Dark = Textures.Solid("#121a26", 0.5, 0.3), Cloth = Textures.Solid("#0d3a86", 0.85);
    const DeskX = -(TableSpec.HalfWidth + 1.75);
    Things.add(Box(0.5, 0.74, 0.9, DeskX, FloorY + 0.37, 0, Cloth), Box(0.56, 0.03, 0.96, DeskX, FloorY + 0.755, 0, Dark));
    for (const End of BothSides)
        Things.add(Box(0.42, 0.4, 0.42, -(CourtHalfWidth - 0.75), FloorY + 0.2, End * (CourtHalfLength - 1.1), Cloth));
    return Things;
}

/**
 * Soft cones of light from the rig to the court, drawn additively: bright where the eye looks
 * along the cone's skin and at the rig's end, nothing at its rim. Purely for the look; the light
 * that falls on the table is Lighting's.
 */
function Shafts(): THREE.Group {
    const Beams = new THREE.Group();
    const Haze = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
        uniforms: { Tint: { value: new THREE.Color("#cfe2ff") }, Strength: { value: 0.085 } },
        vertexShader: `
            varying vec2 vUv; varying vec3 vNormal; varying vec3 vToEye;
            void main() {
                vUv = uv;
                vec4 Seen = modelViewMatrix * vec4(position, 1.0);
                vNormal = normalize(normalMatrix * normal);
                vToEye = normalize(-Seen.xyz);
                gl_Position = projectionMatrix * Seen;
            }`,
        fragmentShader: `
            uniform vec3 Tint; uniform float Strength;
            varying vec2 vUv; varying vec3 vNormal; varying vec3 vToEye;
            void main() {
                float Facing = abs(dot(normalize(vNormal), normalize(vToEye)));
                float Skin = Facing * Facing * Facing;
                float Fall = mix(0.08, 1.0, vUv.y * vUv.y);
                gl_FragColor = vec4(Tint * Strength * Skin * Fall, 1.0);
            }`,
    });
    // TUNED: four lamps of the rig, each throwing a cone that opens to a pool round the table.
    for (const [X, Z] of [[-1.5, -2.2], [1.5, -2.2], [-1.5, 2.2], [1.5, 2.2]]) {
        const Long = RigY - FloorY;
        const Cone = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 2.6, Long, 40, 1, true), Haze);
        Cone.position.set(X * 0.55, FloorY + Long / 2, Z * 0.55);
        Cone.rotation.set(-Z * 0.03, 0, X * 0.03);
        Cone.renderOrder = 3;
        Beams.add(Cone);
    }
    return Beams;
}

/**
 * TUNED arena lighting: one warm-white key from the rig, straight down enough that the table's
 * shadow lies under it, with the only shadow map; a cool and a warm lamp across it for the rim
 * light on rackets and ball; a faint sky for the undersides; and the arches' glow on the floor.
 */
function Lighting(): THREE.Group {
    const Lights = new THREE.Group();
    const Key = new THREE.SpotLight("#fff4e4", 235, 0, 0.52, 0.55, 2);
    Key.position.set(-0.9, RigY, 1.3);
    Key.target.position.set(0, 0, 0);
    Key.castShadow = true;
    Key.shadow.mapSize.set(2048, 2048);
    Key.shadow.camera.near = 3;
    Key.shadow.camera.far = 11;
    Key.shadow.bias = -0.00025;
    Key.shadow.normalBias = 0.012;
    Key.name = "Key";
    const Cool = new THREE.SpotLight("#6ea6ff", 95, 0, 0.6, 0.7, 2);
    Cool.position.set(5.5, 5.2, -5);
    Cool.target.position.set(0, 0, 0);
    const Warm = new THREE.SpotLight("#ffc79a", 120, 0, 0.6, 0.7, 2);
    Warm.position.set(-5.5, 4.6, 5.5);
    Warm.target.position.set(0, 0, 0);
    const Sky = new THREE.HemisphereLight("#9fb1d2", "#4a2a2e", 0.5);
    const Under = new THREE.PointLight("#3d9cff", 1.6, 3.2, 2);
    Under.position.set(0, FloorY + 0.35, 0);
    Lights.add(Key, Key.target, Cool, Cool.target, Warm, Warm.target, Sky, Under);
    return Lights;
}

/** The arena, and what moves in it. */
export class Arena {
    /** TUNED: how fast the boards' words travel, m/s, slow enough to be read and ignored. */
    private static readonly BoardSpeed = 0.22;

    /** TUNED: the dust in the lamps' light: how many motes, and the box they drift in, m, kept above the ball's usual flight. */
    private static readonly Motes = 260;
    private static readonly DustLow = 0.9;
    private static readonly DustHigh = 5.5;
    private static readonly DustReach = 3.2;

    /** TUNED: camera flashes in the stands at once, and how long one lasts, s. */
    private static readonly Flashes = 14;
    private static readonly FlashLasts = 0.22;

    readonly Root = new THREE.Group();

    /** The part that shows in reflections: stands, roof, floor and boards, without the table or anything that moves on it. */
    readonly Surround = new THREE.Group();

    /** The light that casts the shadows, for the graphics settings to size its map. */
    readonly Key: THREE.SpotLight;

    private readonly Boards: THREE.Texture[] = [];
    private readonly Dust: THREE.Points;
    private readonly DustAt: THREE.BufferAttribute;
    private readonly DustSeed: Float32Array;
    private readonly Flash: { Mark: THREE.Sprite; Left: number }[] = [];
    private Time = 0;

    constructor() {
        this.Surround.add(Floor(), Stands(), this.Perimeter(), Furniture());
        const Lights = Lighting();
        this.Key = Lights.getObjectByName("Key") as THREE.SpotLight;
        this.Root.add(this.Surround, new THREE.Group().add(TableTop(), Markings(), Frame(), Net()), Lights, Shafts());

        // Dust: each mote drifts on its own slow circle, so the air in the beams is never still.
        const Positions = new Float32Array(Arena.Motes * 3);
        this.DustSeed = new Float32Array(Arena.Motes * 4);
        for (let At = 0; At < Arena.Motes; At++) {
            const Seed = (N: number) => (Textures.Noise(At * 7 + N, At * 13 + N * 5) + 1) / 2;
            this.DustSeed.set([(Seed(1) - 0.5) * 2 * Arena.DustReach, Arena.DustLow + Seed(2) * (Arena.DustHigh - Arena.DustLow),
                               (Seed(3) - 0.5) * 2 * Arena.DustReach, Seed(4) * Math.PI * 2], At * 4);
        }
        this.DustAt = new THREE.BufferAttribute(Positions, 3);
        const Cloud = new THREE.BufferGeometry();
        Cloud.setAttribute("position", this.DustAt);
        this.Dust = new THREE.Points(Cloud, new THREE.PointsMaterial({ map: Textures.Glow(), color: "#dfeaff", size: 0.02, sizeAttenuation: true,
                                                                       transparent: true, opacity: 0.32, depthWrite: false, blending: THREE.AdditiveBlending }));
        this.Dust.frustumCulled = false;
        this.Root.add(this.Dust);

        const Spark = Textures.Glow();
        for (let At = 0; At < Arena.Flashes; At++) {
            const Mark = new THREE.Sprite(new THREE.SpriteMaterial({ map: Spark, color: "#ffffff", transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
            Mark.scale.setScalar(0.2);
            this.Root.add(Mark);
            this.Flash.push({ Mark, Left: 0 });
        }
        this.Advance(0);
    }

    /** The LED boards round the playing space, a gap at each corner as real surrounds leave for the players. */
    private Perimeter(): THREE.Group {
        const Ring = new THREE.Group();
        const Back = Textures.Solid("#090c12", 0.6, 0.2);
        const Words = ["3D TABLE TENNIS", "CHAMPIONSHIP SERIES", "3D TABLE TENNIS", "REAL PHYSICS · REAL SPIN"];
        const Run = (Length: number, X: number, Z: number, Turn: number) => {
            const Lit = Textures.Led(Words);
            // TUNED: the strip of words is 18 m long on the board.
            Lit.repeat.set(Length / 18, 1);
            this.Boards.push(Lit);
            const Panel = new THREE.Group();
            const Face = new THREE.Mesh(new THREE.PlaneGeometry(Length, BoardHeight - 0.06), new THREE.MeshBasicMaterial({ map: Lit, color: new THREE.Color(0.9, 0.9, 0.9) }));
            Face.position.z = BoardThickness / 2 + 0.001;
            const Shell = Box(Length, BoardHeight, BoardThickness, 0, 0, 0, Back);
            Panel.add(Shell, Face);
            Panel.position.set(X, FloorY + BoardHeight / 2, Z);
            Panel.rotation.y = Turn;
            Ring.add(Panel);
        };
        const Gap = 0.7;
        Run(CourtHalfWidth * 2 - Gap * 2, 0, -CourtHalfLength, 0);
        Run(CourtHalfWidth * 2 - Gap * 2, 0, CourtHalfLength, Math.PI);
        Run(CourtHalfLength * 2 - Gap * 2, -CourtHalfWidth, 0, Math.PI / 2);
        Run(CourtHalfLength * 2 - Gap * 2, CourtHalfWidth, 0, -Math.PI / 2);
        return Ring;
    }

    /** Moves what moves, by Seconds of real time: the hall is watched, not played, so it never slows with the game. */
    Advance(Seconds: number): void {
        this.Time += Seconds;
        for (const Each of this.Boards) Each.offset.x = (Each.offset.x + Arena.BoardSpeed / 18 * Seconds) % 1;
        const Seed = this.DustSeed;
        for (let At = 0; At < Arena.Motes; At++) {
            const Phase = Seed[At * 4 + 3] + this.Time * 0.12;
            this.DustAt.setXYZ(At, Seed[At * 4] + Math.sin(Phase) * 0.25, Seed[At * 4 + 1] + Math.sin(Phase * 0.7 + At) * 0.12, Seed[At * 4 + 2] + Math.cos(Phase) * 0.25);
        }
        this.DustAt.needsUpdate = true;
        for (const Each of this.Flash) {
            Each.Left -= Seconds;
            if (Each.Left <= 0 && Math.random() < Seconds * 0.6) {
                // A new flash somewhere in the seats: on one of the four stands, between the boards and the dark upper tier.
                const Along = (Math.random() * 2 - 1), Up = FloorY + 1.2 + Math.random() * 4.2;
                if (Math.random() < 0.5) Each.Mark.position.set(Along * HalfWidth * 0.95, Up, (Math.random() < 0.5 ? -1 : 1) * (HalfLength - 0.15));
                else Each.Mark.position.set((Math.random() < 0.5 ? -1 : 1) * (HalfWidth - 0.15), Up, Along * HalfLength * 0.95);
                Each.Left = Arena.FlashLasts;
            }
            const Through = Math.max(0, Each.Left / Arena.FlashLasts);
            (Each.Mark.material as THREE.SpriteMaterial).opacity = Through * Through;
        }
    }
}
