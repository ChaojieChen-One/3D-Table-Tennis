/**
 * The racket-face keys, held rather than pressed: W turns the face down, S up, A right and D left
 * (README, Controls). Opposite keys held together cancel. Input only; the follower owns the face.
 * Keys are KeyboardEvent.code values, so they sit in the same place on any keyboard layout.
 */
export class FaceKeys {
    private static readonly All = new Set(["KeyW", "KeyS", "KeyA", "KeyD"]);

    private readonly Held = new Set<string>();

    /** True if the key is a face key, which is then held; any other key is not this class's. */
    Press(Code: string): boolean {
        if (!FaceKeys.All.has(Code)) return false;
        this.Held.add(Code);
        return true;
    }

    Release(Code: string): boolean {
        if (!FaceKeys.All.has(Code)) return false;
        this.Held.delete(Code);
        return true;
    }

    /** A window that loses focus never hears the key come up, so everything is let go. */
    ReleaseAll(): void { this.Held.clear(); }

    /** +1 up (S), -1 down (W), 0 neither or both. */
    Up(): number { return this.Axis("KeyS", "KeyW"); }

    /** +1 right (A), -1 left (D), 0 neither or both: reversed from the usual at the owner's request. */
    Right(): number { return this.Axis("KeyA", "KeyD"); }

    private Axis(Positive: string, Negative: string): number {
        return (this.Held.has(Positive) ? 1 : 0) - (this.Held.has(Negative) ? 1 : 0);
    }
}
