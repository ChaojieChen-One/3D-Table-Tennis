/** Immutable vector in right-handed physics space: metres, +Y up, +Z toward the near end. */
export class Vec3 {
    constructor(readonly X: number, readonly Y: number, readonly Z: number) {}

    static readonly Zero = new Vec3(0, 0, 0);
    static readonly Up = new Vec3(0, 1, 0);

    Plus(Other: Vec3): Vec3 { return new Vec3(this.X + Other.X, this.Y + Other.Y, this.Z + Other.Z); }
    Minus(Other: Vec3): Vec3 { return new Vec3(this.X - Other.X, this.Y - Other.Y, this.Z - Other.Z); }
    Scale(Factor: number): Vec3 { return new Vec3(this.X * Factor, this.Y * Factor, this.Z * Factor); }
    Negate(): Vec3 { return new Vec3(-this.X, -this.Y, -this.Z); }

    PlusScaled(Other: Vec3, Factor: number): Vec3 {
        return new Vec3(this.X + Other.X * Factor, this.Y + Other.Y * Factor, this.Z + Other.Z * Factor);
    }

    Dot(Other: Vec3): number { return this.X * Other.X + this.Y * Other.Y + this.Z * Other.Z; }

    /** Right-handed; Magnus and the contact impulses depend on this sign. */
    Cross(Other: Vec3): Vec3 {
        return new Vec3(this.Y * Other.Z - this.Z * Other.Y,
                        this.Z * Other.X - this.X * Other.Z,
                        this.X * Other.Y - this.Y * Other.X);
    }

    LengthSquared(): number { return this.X * this.X + this.Y * this.Y + this.Z * this.Z; }
    Length(): number { return Math.sqrt(this.LengthSquared()); }

    /** Unit vector, or Zero when degenerate. */
    Normalized(): Vec3 {
        const Length = this.Length();
        return Length < 1e-12 ? Vec3.Zero : this.Scale(1.0 / Length);
    }

    /** Exactly (0, 0, 0): the Zero a degenerate Normalized gives back. */
    IsZero(): boolean { return this.X === 0 && this.Y === 0 && this.Z === 0; }

    /** Component-wise equality, as a Java record compares (but -0 equals 0). */
    Equals(Other: Vec3): boolean { return this.X === Other.X && this.Y === Other.Y && this.Z === Other.Z; }

    /** Any unit vector square to this one: across it from straight up, or from +x if it is vertical. Zero when degenerate. */
    Perpendicular(): Vec3 {
        const Side = this.Cross(Vec3.Up).Normalized();
        return Side.IsZero() ? this.Cross(new Vec3(1, 0, 0)).Normalized() : Side;
    }

    /** This point carried toward Target by at most MaxStep. */
    MovedToward(Target: Vec3, MaxStep: number): Vec3 {
        const Offset = Target.Minus(this);
        const Distance = Offset.Length();
        return Distance <= MaxStep ? Target : this.PlusScaled(Offset.Scale(1.0 / Distance), MaxStep);
    }

    IsFinite(): boolean {
        return Number.isFinite(this.X) && Number.isFinite(this.Y) && Number.isFinite(this.Z);
    }

    static Lerp(From: Vec3, To: Vec3, Fraction: number): Vec3 {
        return new Vec3(From.X + (To.X - From.X) * Fraction,
                        From.Y + (To.Y - From.Y) * Fraction,
                        From.Z + (To.Z - From.Z) * Fraction);
    }

    toString(): string {
        return `(${this.X.toFixed(3)}, ${this.Y.toFixed(3)}, ${this.Z.toFixed(3)})`;
    }
}
