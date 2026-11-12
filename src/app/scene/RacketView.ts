import * as THREE from "three";
import { RacketSpec } from "../../engine/Specs";
import { Vec3 } from "../../engine/math/Vec3";
import * as Textures from "./Textures";

/**
 * A racket: blade, rubbers and handle, built in its own frame: local +Z is the red face's normal,
 * local -Y is the way the handle points within the face, and +X completes a right-handed frame. The
 * total head thickness stays within the spec, so what is drawn is what the engine hits with.
 */
export class RacketView {
    readonly Root = new THREE.Group();

    /** Where the handle's middle sits along it from the blade's centre, and its half length and half width, m. */
    static readonly HandleMiddle = 0.134;

    constructor() {
        const Thick = RacketSpec.BladeThickness, Core = Thick * 0.42;
        const Wood = Textures.Wood();
        const Blade = RacketView.Slab(RacketView.Head(1, 0.074), Core, Wood);
        const Red = RacketView.Slab(RacketView.Head(0.982, 0.0715), (Thick - Core) / 2, Textures.Rubber("#ef0730"));
        Red.position.z = Core / 2;
        const Black = RacketView.Slab(RacketView.Head(0.982, 0.0715), (Thick - Core) / 2, Textures.Rubber("#181a1c"));
        Black.position.z = -Thick / 2;
        Blade.position.z = -Core / 2;

        // The throat from the head into the handle, then the flared handle itself.
        const Throat = RacketView.Slab([[-0.036, -0.056], [0.036, -0.056], [0.014, -0.105], [-0.014, -0.105]], Core + 0.0002, Wood);
        Throat.position.z = -Core / 2 - 0.0001;
        const HandleShape = new THREE.Shape();
        HandleShape.moveTo(-0.0125, -0.084);
        HandleShape.lineTo(0.0125, -0.084);
        HandleShape.quadraticCurveTo(0.0135, -0.15, 0.0155, -0.184);
        HandleShape.lineTo(-0.0155, -0.184);
        HandleShape.quadraticCurveTo(-0.0135, -0.15, -0.0125, -0.084);
        const Handle = new THREE.Mesh(new THREE.ExtrudeGeometry(HandleShape, { depth: 0.024, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 3 }),
                                      new THREE.MeshStandardMaterial({ color: "#a77a4c", roughness: 0.6 }));
        Handle.position.z = -0.012;
        const Badge = Textures.Solid("#d8c37a", 0.35, 0.8);
        for (const Side of [-1, 1]) {
            const Plate = new THREE.Mesh(new THREE.PlaneGeometry(0.01, 0.038), Badge);
            Plate.position.set(0, -0.157, Side * 0.0143);
            if (Side < 0) Plate.rotation.y = Math.PI;
            this.Root.add(Plate);
        }
        for (const Part of [Blade, Red, Black, Throat, Handle]) {
            Part.castShadow = true;
            Part.receiveShadow = true;
            this.Root.add(Part);
        }
    }

    /** A flat piece of outline Points (x, y), Depth thick from z = 0 to Depth. */
    private static Slab(Points: number[][], Depth: number, Paint: THREE.Material): THREE.Mesh {
        const Outline = new THREE.Shape(Points.map(([X, Y]) => new THREE.Vector2(X, Y)));
        return new THREE.Mesh(new THREE.ExtrudeGeometry(Outline, { depth: Depth, bevelEnabled: false, curveSegments: 1 }), Paint);
    }

    /** The head: a disc a little taller than wide, cut off flat where it meets the throat, Bottom below the centre. */
    private static Head(Scale: number, Bottom: number): number[][] {
        const Segments = 96, Radius = RacketSpec.BladeRadius * Scale;
        const Angle = Math.acos(-Bottom / (Radius * 1.04));
        const Outline: number[][] = [];
        for (let I = 0; I <= Segments; I++) {
            const T = -Angle + 2 * Angle * I / Segments;
            Outline.push([Radius * Math.sin(T), Radius * 1.04 * Math.cos(T)]);
        }
        return Outline;
    }

    /**
     * Built, not solved as the shortest rotation onto the normal, which lets the roll fall anywhere.
     * RedNormal is the red face, which faces its holder, so Up x RedNormal is the holder's right.
     * Lean is the handle's angle from straight down toward the holder's right, radians.
     */
    Pose(Centre: Vec3, RedNormal: Vec3, Lean: number): void {
        const Out = RedNormal.Normalized();
        const HolderRight = Vec3.Up.Cross(Out).Normalized();
        const Grip = new Vec3(0, -Math.cos(Lean), 0).PlusScaled(HolderRight, Math.sin(Lean));
        let Handle = Grip.Minus(Out.Scale(Grip.Dot(Out)));
        // A blade lying flat has no down within its face: it hangs toward the near end.
        if (Handle.Length() < 1e-6) { const Near = new Vec3(0, 0, 1); Handle = Near.Minus(Out.Scale(Near.Dot(Out))); }
        Handle = Handle.Normalized();
        const Y = Handle.Negate(), X = Y.Cross(Out);
        const Basis = new THREE.Matrix4().makeBasis(new THREE.Vector3(X.X, X.Y, X.Z), new THREE.Vector3(Y.X, Y.Y, Y.Z), new THREE.Vector3(Out.X, Out.Y, Out.Z));
        this.Root.quaternion.setFromRotationMatrix(Basis);
        this.Root.position.set(Centre.X, Centre.Y, Centre.Z);
    }
}
