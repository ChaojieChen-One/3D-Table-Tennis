import * as THREE from "three";
import { BallSpec, NetSpec, TableSpec } from "../../engine/Specs";
import * as Textures from "./Textures";

/**
 * The hall: a table in a quiet training room, and its lights. Physics and Three.js share one frame
 * (metres, right-handed, +Y up, origin at the centre of the tabletop), so every size here is read
 * straight from the engine's specs. Collision surfaces keep the engine's dimensions; decorative
 * proportions are TUNED multiples of them. Keeping the room darker than the playing surface gives
 * the white ball a reliable silhouette. Built once, never per frame.
 */

/** ITTF Laws 2.1.4 and 2.1.6: side and end lines equal a ball radius; the doubles line is 15% of it. */
const LineWidth = BallSpec.Radius;
const CentreLineWidth = BallSpec.Radius * 0.15;

/** TUNED: enough separation to beat depth fighting without a visibly floating marking. */
const LineLift = TableSpec.TopThickness * 0.04;

const LegX = TableSpec.Width * 0.42;
const LegZ = TableSpec.Length * 0.34;
const BothSides = [-1, 1];

/** TUNED: the room, m: a training hall a few tables long. */
export const HalfWidth = 7, HalfLength = 11, CeilingY = 5.2;

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
    const White = Textures.Solid("#e2e9e8", 0.5);
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

/**
 * A dark apron under a thin silver rim makes the slab's thickness visible from the player's view;
 * crossbars and feet give the table weight. None of it is part of the collision world.
 */
function Frame(): THREE.Group {
    const Parts = new THREE.Group();
    const Metal = Textures.Solid("#242f3b", 0.45, 0.4);
    const Rim = Textures.Solid("#7f9ba5", 0.35, 0.7);
    const Feet = Textures.Solid("#111820", 0.9);
    const Slab = TableSpec.TopThickness, Apron = Slab * 3, Inset = Slab * 0.4, FootHeight = Slab * 0.65;
    const LegHeight = TableSpec.Height - Slab - FootHeight;
    for (const Side of BothSides) {
        Parts.add(Box(Slab, Apron, TableSpec.Length - Inset * 2, Side * (TableSpec.HalfWidth - Inset), -Slab - Apron / 2, 0, Metal),
                  Box(TableSpec.Width - Inset * 2, Apron, Slab, 0, -Slab - Apron / 2, Side * (TableSpec.HalfLength - Inset), Metal),
                  Box(Slab * 0.25, Slab * 0.18, TableSpec.Length, Side * TableSpec.HalfWidth, -Slab * 0.75, 0, Rim),
                  Box(TableSpec.Width, Slab * 0.18, Slab * 0.25, 0, -Slab * 0.75, Side * TableSpec.HalfLength, Rim),
                  Box(LegX * 2, Slab * 1.4, Slab * 1.4, 0, -TableSpec.Height * 0.68, Side * LegZ, Metal));
        for (const End of BothSides)
            Parts.add(Box(Slab * 2, LegHeight, Slab * 2, Side * LegX, -Slab - LegHeight / 2, End * LegZ, Metal),
                      Box(Slab * 3.2, FootHeight, Slab * 3.2, Side * LegX, -TableSpec.Height + FootHeight / 2, End * LegZ, Feet));
        const Brace = Box(0.035, 0.035, LegZ * 1.85, Side * LegX, -0.43, 0, Metal);
        Brace.rotation.x = THREE.MathUtils.degToRad(-15);
        Parts.add(Brace);
    }
    const Plaque = new THREE.Mesh(new THREE.PlaneGeometry(0.57, 0.056), Textures.Sign("TABLE TENNIS", "#d6dedb", "#242f3b", 1024, 100));
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
    const Cord = Textures.Solid("#45585b", 0.9);
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
    const Metal = Textures.Solid("#344655", 0.4, 0.6), Cap = Textures.Solid("#aac2c7", 0.3, 0.7);
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

/** One table, as the engine knows it: top, lines, frame and net. */
function TableSet(): THREE.Group {
    return new THREE.Group().add(TableTop(), Markings(), Frame(), Net());
}

/**
 * The room. Walls are single-sided and face inward: a manual orbit outside the hall sees through
 * the nearest wall instead of losing the table behind a box.
 */
function Room(): THREE.Group {
    const FloorY = -TableSpec.Height;
    const Hall = new THREE.Group();
    const Ground = new THREE.Mesh(new THREE.PlaneGeometry(HalfWidth * 2, HalfLength * 2), Textures.Floor(HalfWidth * 2, HalfLength * 2));
    Ground.rotation.x = -Math.PI / 2;
    Ground.position.y = FloorY;
    Ground.receiveShadow = true;
    Hall.add(Ground);
    // A court line round the playing area, as halls paint them: 7 m by 14 m.
    const Paint = Textures.Solid("#d8cfa8", 0.8);
    for (const [Width, Length, X, Z] of [[7, 0.05, 0, -7], [7, 0.05, 0, 7], [0.05, 14, -3.5, 0], [0.05, 14, 3.5, 0]]) {
        const Line = new THREE.Mesh(new THREE.PlaneGeometry(Width, Length), Paint);
        Line.rotation.x = -Math.PI / 2;
        Line.position.set(X, FloorY + 0.001, Z);
        Line.receiveShadow = true;
        Hall.add(Line);
    }

    const Height = CeilingY - FloorY;
    const WallOf = (Width: number, X: number, Z: number, Turn: number) => {
        const Panel = new THREE.Mesh(new THREE.PlaneGeometry(Width, Height), Textures.Wall(Width, Height));
        Panel.position.set(X, FloorY + Height / 2, Z);
        Panel.rotation.y = Turn;
        Panel.receiveShadow = true;
        Hall.add(Panel);
    };
    WallOf(HalfWidth * 2, 0, -HalfLength, 0);
    WallOf(HalfWidth * 2, 0, HalfLength, Math.PI);
    WallOf(HalfLength * 2, -HalfWidth, 0, Math.PI / 2);
    WallOf(HalfLength * 2, HalfWidth, 0, -Math.PI / 2);

    const Ceiling = new THREE.Mesh(new THREE.PlaneGeometry(HalfWidth * 2, HalfLength * 2), Textures.Solid("#1f2a31", 1));
    Ceiling.rotation.x = Math.PI / 2;
    Ceiling.position.y = CeilingY;
    Hall.add(Ceiling);
    // Long strip lights over the table: what the key light stands for.
    const Glow = new THREE.MeshBasicMaterial({ color: "#f3efe2" });
    for (const X of [-1.2, 1.2])
        for (const Z of [-3, 0, 3]) {
            const Strip = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, 1.6), Glow);
            Strip.position.set(X, CeilingY - 0.3, Z);
            Hall.add(Strip);
        }

    // Barriers round the court, as clubs stand them, and a sign on the far wall.
    const Barrier = Textures.Sign("3D TABLE TENNIS", "#9fb3b5", "#14323d", 1024, 128, 0);
    for (const [X, Z, Turn] of [[-2.6, -5.2, 0], [0, -5.2, 0], [2.6, -5.2, 0], [-4.2, -2.6, Math.PI / 2], [-4.2, 0, Math.PI / 2], [-4.2, 2.6, Math.PI / 2],
                                [4.2, -2.6, -Math.PI / 2], [4.2, 0, -Math.PI / 2], [4.2, 2.6, -Math.PI / 2]]) {
        const Panel = Box(2.5, 0.55, 0.03, X, FloorY + 0.275, Z, Barrier);
        Panel.rotation.y = Turn;
        Hall.add(Panel);
    }
    const Banner = new THREE.Mesh(new THREE.PlaneGeometry(5, 0.62), Textures.Sign("TRAINING HALL", "#d6dedb", "#17323d", 1024, 128));
    Banner.position.set(0, 2.6, -HalfLength + 0.01);
    Hall.add(Banner);
    return Hall;
}

/** TUNED sports-hall lighting: warm key from above with shadows, cool cross-fill, and a hemisphere for the undersides. */
function Lighting(): THREE.Group {
    const Lights = new THREE.Group();
    const Key = new THREE.DirectionalLight("#fff3df", 2.4);
    Key.position.set(-1.4, 4.6, 1.1);
    Key.target.position.set(0, 0, 0);
    Key.castShadow = true;
    Key.shadow.mapSize.set(2048, 2048);
    const Reach = 3.4;
    Object.assign(Key.shadow.camera, { left: -Reach * 0.7, right: Reach * 0.7, top: Reach, bottom: -Reach, near: 1, far: 9 });
    Key.shadow.bias = -0.0004;
    Key.shadow.normalBias = 0.01;
    const Fill = new THREE.DirectionalLight("#7f9cc0", 0.6);
    Fill.position.set(3.2, 2.2, -1.6);
    const Sky = new THREE.HemisphereLight("#c9d4da", "#4d3a2c", 0.9);
    Lights.add(Key, Key.target, Fill, Sky);
    return Lights;
}

export function Build(): THREE.Group {
    const Arena = new THREE.Group().add(Room(), TableSet(), Lighting());
    // Two more tables down the hall, out of play, so the room reads as a club.
    for (const Z of [-7.6, 7.6]) {
        const Extra = TableSet();
        Extra.position.set(-3.1, 0, Z);
        Extra.rotation.y = Math.PI / 2;
        Arena.add(Extra);
    }
    return Arena;
}
