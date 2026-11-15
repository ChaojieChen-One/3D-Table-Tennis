import { Make } from "./Dom";

/** The controls, as the README's table has them: what to press, and what it does. */
const Groups: ReadonlyArray<{ Title: string; Keys: ReadonlyArray<readonly [string[], string]> }> = [
    { Title: "RACKET", Keys: [
        [["MOUSE"], "Move the racket; swing through the ball to hit"],
        [["W", "S"], "Tilt the face down / up"],
        [["A", "D"], "Turn the face right / left, to aim"],
    ] },
    { Title: "RALLY", Keys: [
        [["SPACE"], "New ball"],
        [["[", "]"], "Slower / faster"],
        [["P"], "Pause"],
        [["ESC"], "Menu"],
    ] },
    { Title: "VIEW & SOUND", Keys: [
        [["1", "–", "8"], "Camera views"],
        [["DRAG"], "Orbit; scroll to zoom; R resets"],
        [["F"], "Follow camera on / off"],
        [["N"], "Sound on / off"],
        [["M"], "Online match"],
        [["H"], "Hide the HUD"],
    ] },
];

/** The controls card's contents: Compact leaves the camera group's rarer keys to the full card in the menu. */
export function ControlsList(Compact = false): HTMLElement {
    const List = Make("div", "keys");
    for (const Group of Groups) {
        const Block = Make("div", "keys-group");
        Block.append(Make("div", "keys-title", Group.Title));
        for (const [Keys, Does] of Compact ? Group.Keys.slice(0, 4) : Group.Keys) {
            const Line = Make("div", "keys-line");
            const Caps = Make("span", "keys-caps");
            for (const Each of Keys) Caps.append(Each === "–" ? Make("span", "keys-to", "–") : Make("kbd", "", Each));
            Line.append(Caps, Make("span", "keys-does", Does));
            Block.append(Line);
        }
        List.append(Block);
    }
    return List;
}
