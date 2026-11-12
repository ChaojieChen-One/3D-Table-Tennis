import * as THREE from "three";
import { Vec3 } from "../../engine/math/Vec3";

/**
 * Where the ball struck, for a moment: a ring that spreads and fades, as strong as the contact was
 * hard. Table marks lie on the table; racket marks ride on the blade (they are its children), so
 * they move on with it.
 */
export class Impacts {
    /** TUNED: how long a mark shows, game s, and how far it spreads, m. */
    private static readonly Lasts = 0.45;
    private static readonly Spreads = 0.05;

    readonly Root = new THREE.Group();
    private readonly Live: { Mark: THREE.Mesh; Age: number; Strength: number }[] = [];
    private readonly Ring = new THREE.RingGeometry(0.62, 1, 32);

    /** A mark at At on a surface facing Normal (in Parent's frame), from a contact that changed the ball's velocity by SpeedChange, m/s. */
    Strike(At: Vec3, Normal: Vec3, SpeedChange: number, Parent: THREE.Object3D = this.Root): void {
        const Strength = Math.min(1, SpeedChange / 8);
        if (Strength < 0.05) return;
        const Mark = new THREE.Mesh(this.Ring, new THREE.MeshBasicMaterial({ color: "#f8f2d0", transparent: true, depthWrite: false, side: THREE.DoubleSide }));
        Mark.position.set(At.X, At.Y, At.Z).addScaledVector(new THREE.Vector3(Normal.X, Normal.Y, Normal.Z), 0.0015);
        Mark.lookAt(Mark.position.clone().add(new THREE.Vector3(Normal.X, Normal.Y, Normal.Z)));
        Mark.renderOrder = 2;
        Parent.add(Mark);
        this.Live.push({ Mark, Age: 0, Strength });
    }

    /** Ages the marks by Seconds of game time; once per frame. */
    Advance(Seconds: number): void {
        for (let At = this.Live.length - 1; At >= 0; At--) {
            const Each = this.Live[At];
            Each.Age += Seconds;
            const Through = Each.Age / Impacts.Lasts;
            if (Through >= 1) {
                Each.Mark.removeFromParent();
                (Each.Mark.material as THREE.Material).dispose();
                this.Live.splice(At, 1);
                continue;
            }
            const Size = 0.012 + Impacts.Spreads * Each.Strength * Math.sqrt(Through);
            Each.Mark.scale.setScalar(Size);
            (Each.Mark.material as THREE.MeshBasicMaterial).opacity = 0.75 * Each.Strength * (1 - Through) ** 2;
        }
    }
}
