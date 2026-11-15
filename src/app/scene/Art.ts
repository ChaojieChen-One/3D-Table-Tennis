import * as THREE from "three";

/**
 * The hall's photographic art: the grandstands, the roof rig and the court's floor, as images in
 * public/art (made with an image generator, then cut to size). Each loads in the background and
 * simply appears on its surface when it arrives, so the game never waits on it; Ready resolves
 * once all have arrived or failed, which is when the scene's reflections are worth capturing.
 */

const Loader = new THREE.TextureLoader();
const Pending: Promise<void>[] = [];

function Load(File: string, Mirrored: boolean): THREE.Texture {
    let Arrived: () => void = () => {};
    Pending.push(new Promise(Done => { Arrived = Done; }));
    // A missing image leaves its surface in its plain colour: worth a line, never an error.
    const Map = Loader.load(`./art/${File}`, Arrived, undefined, () => { console.debug(`art/${File} did not load`); Arrived(); });
    Map.colorSpace = THREE.SRGBColorSpace;
    Map.wrapS = Map.wrapT = Mirrored ? THREE.MirroredRepeatWrapping : THREE.ClampToEdgeWrapping;
    Map.anisotropy = 8;
    return Map;
}

/** The grandstands at night, 21:9. Mirrored when repeated, so a long wall has no seam. */
export const Crowd = (): THREE.Texture => Load("crowd.jpg", true);

/** The roof and its lighting rig, seen from below, square. */
export const Roof = (): THREE.Texture => Load("roof.jpg", false);

/** Red sport flooring, seen from above, square; mirrored when repeated, which hides its uneven light. */
export const Court = (): THREE.Texture => Load("court.jpg", true);

/** Resolves once every image asked for so far has arrived or failed. */
export function Ready(): Promise<void> { return Promise.all(Pending).then(() => undefined); }
