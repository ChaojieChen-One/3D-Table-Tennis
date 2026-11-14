/** The few DOM helpers the 2D layer shares. */

export function Make<K extends keyof HTMLElementTagNameMap>(Tag: K, Class: string, Text = ""): HTMLElementTagNameMap[K] {
    const Made = document.createElement(Tag);
    if (Class) Made.className = Class;
    if (Text) Made.textContent = Text;
    return Made;
}

/**
 * A button of the in-play HUD. It is never focused: the keys belong to the game there, so a
 * click must not leave Space or Enter pressing it again.
 */
export function HudButton(Title: string, Action: () => void, Class = "hud-button"): HTMLButtonElement {
    const Made = Make("button", Class, Title);
    Made.type = "button";
    Made.tabIndex = -1;
    Made.addEventListener("click", Event => { Action(); (Event.currentTarget as HTMLElement).blur(); });
    return Made;
}

/** A button of a menu, reached by Tab and the arrow keys like any other. */
export function MenuButton(Title: string, Action: () => void, Class = "menu-button"): HTMLButtonElement {
    const Made = Make("button", Class, Title);
    Made.type = "button";
    Made.addEventListener("click", Action);
    return Made;
}

/** An inline SVG icon drawn on a 24-unit grid from path data, stroked in the text colour. */
export function Icon(Paths: string, Class = "icon"): SVGSVGElement {
    const Space = "http://www.w3.org/2000/svg";
    const Drawn = document.createElementNS(Space, "svg");
    Drawn.setAttribute("viewBox", "0 0 24 24");
    Drawn.setAttribute("class", Class);
    Drawn.setAttribute("aria-hidden", "true");
    const Path = document.createElementNS(Space, "path");
    Path.setAttribute("d", Paths);
    Drawn.append(Path);
    return Drawn;
}

/** Plays a CSS animation again from its start: the class is taken off, the layout read, and the class put back. */
export function Replay(Element: HTMLElement, Class: string): void {
    Element.classList.remove(Class);
    void Element.offsetWidth;
    Element.classList.add(Class);
}
