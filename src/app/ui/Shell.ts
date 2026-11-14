import { SoundEngine } from "../audio/SoundEngine";
import { CourtOverlay } from "../CourtOverlay";
import { GameLoop } from "../GameLoop";
import { RacketControl } from "../input/RacketControl";
import { MatchPage } from "../MatchPage";

/** What main hands over so the menus and the sound can be joined to the game. */
export interface ShellParts {
    readonly Hud: CourtOverlay;
    readonly Sound: SoundEngine;
    readonly Loop: GameLoop;
    readonly Page: MatchPage;
    readonly Racket: RacketControl;
    /** The URL's options: "menu=off", or any of the scripted-check options, starts in play. */
    readonly Options: URLSearchParams;
    /** A fresh practice rally against the computer, from love-all. */
    readonly Restart: () => void;
}

/**
 * Joins the menus and the sound to the game, so main needs only a few lines: the game is held
 * while a menu is open and its keys go to the menu; PLAY starts a fresh rally; Esc opens the
 * pause menu and N turns the sound off and on; buttons tick under the pointer; and the title is
 * shown at launch unless the URL asks to start in play.
 */
export function InstallShell({ Hud, Sound, Loop, Page, Racket, Options, Restart }: ShellParts): void {
    const Menu = Hud.Menu;

    // A match cannot be paused (each machine flies the other's strokes on its own clock), so online a menu only covers the game.
    const Hold = (On: boolean) => { if (!Loop.Online() && Hud.Paused() !== On) Loop.TogglePause(); };
    Menu.IsOnline = () => Loop.Online();
    Menu.OnOpened = () => { Racket.ReleaseAll(); Hold(true); };
    Menu.OnClosed = () => Hold(false);
    Menu.OnPlay = () => { Restart(); Menu.Close(); };
    Menu.OnOnline = () => Hud.OpenMatch();
    Menu.OnPlayAgain = () => { if (!Loop.Online()) Restart(); Menu.Close(); };
    Menu.OnMainMenu = () => {
        // In a match the way out is the Match page's LEAVE; the title belongs to practice.
        if (Loop.Online()) { Menu.Close(); Hud.OpenMatch(); return; }
        Restart();
        Menu.Show("Title");
    };
    Hud.OnSpeed(Value => Loop.SetSpeed(Value));

    // Before the game's own key handler: a menu takes every key while it is open, and Esc and N are this layer's.
    window.addEventListener("keydown", Event => {
        if (Page.IsOpen()) return;
        if (Menu.IsOpen()) {
            Menu.Key(Event);
            Event.stopImmediatePropagation();
            return;
        }
        if (Event.ctrlKey || Event.metaKey || Event.altKey) return;
        if (Event.code === "Escape") Menu.Show("Pause");
        else if (Event.code === "KeyN") Sound.ToggleMute();
        else return;
        Event.preventDefault();
        Event.stopImmediatePropagation();
    }, { capture: true });

    // Every button answers the pointer: a tick as it comes over, a firmer one when pressed.
    for (const Each of [Hud.Root, Page.Root]) {
        Each.addEventListener("pointerover", Event => {
            const Over = (Event.target as Element).closest("button"), From = Event.relatedTarget as Element | null;
            if (Over !== null && !Over.contains(From)) Sound.Tick();
        });
        Each.addEventListener("click", Event => { if ((Event.target as Element).closest("button") !== null) Sound.Click(); });
    }

    Menu.SetTitleArt("./art/keyart.jpg");
    const StartInPlay = Options.get("menu") === "off" || ["view", "aim", "ball"].some(Each => Options.has(Each));
    // "?settings" opened Settings before these callbacks existed: hold the game for it now.
    if (Menu.IsOpen()) Menu.OnOpened();
    else if (!StartInPlay) Menu.Show("Title");
}
