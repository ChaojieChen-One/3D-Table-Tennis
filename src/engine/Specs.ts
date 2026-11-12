/**
 * The physical sizes of everything the ball can meet. These are the only source of them: never
 * hard-code a size anywhere else.
 */

/** The regulation ball. [ITTF] Technical Leaflet T3 "The Ball" and Laws of Table Tennis 2.03. */
export const BallSpec = (() => {
    /** 40 mm diameter. [ITTF] */
    const Radius = 0.020;
    /** 2.7 g. [ITTF] */
    const Mass = 0.0027;
    return {
        Radius,
        Mass,
        /** Hollow shell, so (2/3)mr², not the solid sphere's (2/5)mr². [ITTF] */
        Inertia: (2.0 / 3.0) * Mass * Radius * Radius,
        CrossSection: Math.PI * Radius * Radius,
    } as const;
})();

/**
 * The regulation table. [ITTF] Laws of Table Tennis 2.01. The physics origin is the centre of
 * the playing surface, so the far end is at z = -HalfLength and the floor at y = -Height.
 */
export const TableSpec = {
    /** 2.74 m. [ITTF] */
    Length: 2.74,
    /** 1.525 m. [ITTF] */
    Width: 1.525,
    /** 0.76 m. [ITTF] */
    Height: 0.76,
    /** Collision thickness of the top. */
    TopThickness: 0.025,
    HalfLength: 2.74 / 2,
    HalfWidth: 1.525 / 2,
} as const;

/** The net assembly, standing across the table at z = 0. [ITTF] Laws of Table Tennis 2.02. */
export const NetSpec = {
    /** 15.25 cm. [ITTF] */
    Height: 0.1525,
    /** 1.83 m, overhanging the table by 15.25 cm each side. [ITTF] */
    Width: 1.83,
    /** Real netting is ~1 mm; thicker so a fast ball cannot tunnel between steps. */
    Thickness: 0.006,
} as const;

/** The racket blade as the contact solver sees it: a disc slab. */
export const RacketSpec = {
    /** ITTF Law 2.4.1 sets no size; a 75 mm disc matches a typical 157 x 150 mm head. */
    BladeRadius: 0.075,
    /** Blade (~6 mm) plus two rubbers capped at 4.05 mm each by ITTF Law 2.4.3. */
    BladeThickness: 0.015,
} as const;
