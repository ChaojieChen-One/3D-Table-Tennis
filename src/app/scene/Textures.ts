import * as THREE from "three";

/**
 * Small, deterministic material maps for the training hall, drawn once on canvases and never
 * during a rally. The fine grain is deliberately low contrast: it should reveal a surface when the
 * camera is near it without becoming another moving pattern behind the ball. TUNED colours and
 * grain amplitudes describe finishes, not physics.
 */

/** A repeatable pseudo-random value in [-1, 1] for a pixel, so every launch draws the same grain. */
export function Noise(X: number, Y: number): number {
    let H = (X * 374761393 + Y * 668265263) | 0;
    H = Math.imul(H ^ (H >>> 13), 1274126177);
    return (((H ^ (H >>> 16)) >>> 0) / 4294967295) * 2 - 1;
}

function Canvas(Width: number, Height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
    const Sheet = document.createElement("canvas");
    Sheet.width = Width;
    Sheet.height = Height;
    return [Sheet, Sheet.getContext("2d")!];
}

function Texture(Sheet: HTMLCanvasElement, RepeatX = 1, RepeatY = 1): THREE.CanvasTexture {
    const Map = new THREE.CanvasTexture(Sheet);
    Map.colorSpace = THREE.SRGBColorSpace;
    Map.wrapS = Map.wrapT = THREE.RepeatWrapping;
    Map.repeat.set(RepeatX, RepeatY);
    Map.anisotropy = 8;
    return Map;
}

/** A base colour with a faint grain over it. */
function Grained(Base: string, Size: number, Contrast: number): HTMLCanvasElement {
    const [Sheet, Pen] = Canvas(Size, Size);
    Pen.fillStyle = Base;
    Pen.fillRect(0, 0, Size, Size);
    const Pixels = Pen.getImageData(0, 0, Size, Size);
    for (let Y = 0; Y < Size; Y++)
        for (let X = 0; X < Size; X++) {
            const At = (Y * Size + X) * 4, Tint = 1 + Contrast * Noise(X, Y);
            for (let C = 0; C < 3; C++) Pixels.data[At + C] = Math.min(255, Pixels.data[At + C] * Tint);
        }
    Pen.putImageData(Pixels, 0, 0);
    return Sheet;
}

/** A quiet satin finish, the Java edition's teal. */
export function Table(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ map: Texture(Grained("#195b5e", 256, 0.03), 4, 6), roughness: 0.55, metalness: 0 });
}

export function Solid(Colour: string, Roughness = 0.6, Metalness = 0): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ color: Colour, roughness: Roughness, metalness: Metalness });
}

/** Pimpled-in rubber: a soft sheen, never a mirror. */
export function Rubber(Colour: string): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ map: Texture(Grained(Colour, 128, 0.05)), roughness: 0.62, metalness: 0 });
}

/** Blade wood, with a gentle warp in its grain. */
export function Wood(): THREE.MeshStandardMaterial {
    const [Sheet, Pen] = Canvas(256, 128);
    const Pixels = Pen.createImageData(256, 128);
    for (let Y = 0; Y < 128; Y++)
        for (let X = 0; X < 256; X++) {
            const Warp = Math.sin(X * 0.03) * 5 + Math.sin(X * 0.094 + Y * 0.06) * 2;
            const Grain = 1 + Math.sin(Y * 1.24 + Warp) * 0.045 + Math.sin(Y * 3.4 + Warp) * 0.018 + Noise(X, Y) * 0.018;
            const At = (Y * 256 + X) * 4;
            Pixels.data[At] = 0xc2 * Grain; Pixels.data[At + 1] = 0x9a * Grain; Pixels.data[At + 2] = 0x67 * Grain; Pixels.data[At + 3] = 255;
        }
    Pen.putImageData(Pixels, 0, 0);
    return new THREE.MeshStandardMaterial({ map: Texture(Sheet), roughness: 0.7 });
}

/** A woven white tape for the net's top. */
export function Tape(): THREE.MeshStandardMaterial {
    return new THREE.MeshStandardMaterial({ map: Texture(Grained("#e2e5de", 64, 0.04), 8, 1), roughness: 0.9, emissive: "#424240" });
}

/**
 * A sprung sports floor of long boards, warm and a little darker than the table so the table
 * reads first, with a painted court line round each table's playing area.
 */
export function Floor(Width: number, Length: number): THREE.MeshStandardMaterial {
    const PerMetre = 96;
    const [Sheet, Pen] = Canvas(1024, 1024);
    const BoardWidth = 0.14, BoardLength = 1.25;
    const Across = 1024 / (BoardWidth * PerMetre), Along = 1024 / (BoardLength * PerMetre);
    for (let Row = 0; Row < Across; Row++)
        for (let Board = -1; Board < Along + 1; Board++) {
            const Offset = (Row % 4) * 0.25;
            const Tone = 0.6 + 0.05 * Noise(Row, Board);
            Pen.fillStyle = `rgb(${Math.round(0x8a * Tone)}, ${Math.round(0x5c * Tone)}, ${Math.round(0x3e * Tone)})`;
            Pen.fillRect(Row * BoardWidth * PerMetre, (Board + Offset) * BoardLength * PerMetre, BoardWidth * PerMetre - 1, BoardLength * PerMetre - 1);
        }
    const Map = Texture(Sheet, Width / (1024 / PerMetre), Length / (1024 / PerMetre));
    return new THREE.MeshStandardMaterial({ map: Map, roughness: 0.78 });
}

/** A painted block wall, quiet so the ball never loses itself against it. */
export function Wall(Width: number, Height: number): THREE.MeshStandardMaterial {
    const [Sheet, Pen] = Canvas(512, 512);
    Pen.fillStyle = "#24323a";
    Pen.fillRect(0, 0, 512, 512);
    Pen.strokeStyle = "rgba(0,0,0,0.18)";
    Pen.lineWidth = 2;
    for (let Row = 0; Row < 16; Row++) {
        Pen.beginPath(); Pen.moveTo(0, Row * 32); Pen.lineTo(512, Row * 32); Pen.stroke();
        for (let Block = 0; Block < 8; Block++) {
            const X = Block * 64 + (Row % 2) * 32;
            Pen.beginPath(); Pen.moveTo(X, Row * 32); Pen.lineTo(X, Row * 32 + 32); Pen.stroke();
        }
    }
    // A wainscot band at the bottom, darker, where balls strike it.
    return new THREE.MeshStandardMaterial({ map: Texture(Sheet, Width / 4, Height / 4), roughness: 0.92 });
}

/** A sign: a panel of colour with words on it. */
export function Sign(Words: string, Ink: string, Back: string, Width = 1024, Height = 128, Glow = 0.08): THREE.MeshStandardMaterial {
    const [Sheet, Pen] = Canvas(Width, Height);
    Pen.fillStyle = Back;
    Pen.fillRect(0, 0, Width, Height);
    Pen.fillStyle = Ink;
    Pen.font = `600 ${Math.round(Height * 0.42)}px "Segoe UI", system-ui, sans-serif`;
    Pen.textAlign = "center";
    Pen.textBaseline = "middle";
    Pen.fillText(Words, Width / 2, Height / 2 + Height * 0.03);
    const Map = new THREE.CanvasTexture(Sheet);
    Map.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshStandardMaterial({ map: Map, roughness: 0.8, emissive: "#ffffff", emissiveMap: Map, emissiveIntensity: Glow });
}

export { Canvas };
