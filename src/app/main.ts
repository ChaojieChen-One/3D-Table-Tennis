import * as THREE from "three";
import { Vec3 } from "../engine/math/Vec3";
import { CursorFollower } from "../game/control/CursorFollower";
import { ReachEnvelope } from "../game/control/ReachEnvelope";
import { Opponent } from "../game/Opponent";
import { Rally } from "../game/Rally";
import { RemoteRacket } from "../game/RemoteRacket";
import { NetSession } from "../net/NetSession";
import { WebSocketTransport } from "../net/WebSocketTransport";
import { CameraRig } from "./camera/CameraRig";
import { CourtOverlay } from "./CourtOverlay";
import { GameLoop } from "./GameLoop";
import { RacketControl } from "./input/RacketControl";
import { MatchPage } from "./MatchPage";
import { TableScene } from "./scene/TableScene";
import "./style.css";

/**
 * 3D Table Tennis. The composition root: it builds the scene, the camera and the player's controls,
 * fills the page and starts the game loop. The Java edition's command-line options are URL
 * parameters here, e.g. ?speed=0.8&view=courtside&aim=0.2,1.5&ball=0,0.3,1.0.
 */
const Options = new URLSearchParams(location.search);
const Numbers = (Name: string): number[] | null => {
    const Raw = Options.get(Name);
    if (Raw === null) return null;
    const Parts = Raw.split(",").map(Number);
    return Parts.every(Number.isFinite) ? Parts : null;
};

const Stage = document.getElementById("stage")!;
const Renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
Renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
Renderer.shadowMap.enabled = true;
Renderer.shadowMap.type = THREE.PCFSoftShadowMap;
Renderer.outputColorSpace = THREE.SRGBColorSpace;
Renderer.toneMapping = THREE.ACESFilmicToneMapping;
Renderer.toneMappingExposure = 1.05;
Stage.append(Renderer.domElement);

const World = new TableScene();
const Scene = new THREE.Scene();
Scene.background = new THREE.Color("#17232e");
Scene.add(World.Root);

const Rig = new CameraRig();
Rig.View(Options.get("view") ?? "player");
// "?follow=off" keeps the player view still instead of following the rally.
if (Options.get("follow") === "off") Rig.SetFollowing(false);
Rig.Attach(Renderer.domElement);

const Hand = new CursorFollower(ReachEnvelope.Neutral);
const Racket = new RacketControl(Hand, Rig.Camera);

/**
 * The hitting helps as the URL sets them, for a practice rally and a match alike. "lift=off"
 * switches off the help that raises the racket to a bounced ball's height; "assist=off" leaves the
 * player's contact to the engine alone; "aimhelp=0.8" turns on the help that turns the face.
 */
function Configured(Game: Rally): Rally {
    if (Options.get("lift") === "off") Game.SetAutoLift(false);
    if (Options.get("assist") === "off") Game.SetShotAssist(false);
    const AimHelp = Options.get("aimhelp");
    if (AimHelp !== null) Game.SetAimHelp(AimHelp === "off" ? 0 : Number(AimHelp));
    return Game;
}

const Game = Configured(new Rally(Hand));
// Repeatable visual checks: "ball=x,y,z" in metres holds the ball still there, unfed.
const HeldBall = Numbers("ball");
if (HeldBall !== null && HeldBall.length === 3) Game.Hold(new Vec3(HeldBall[0], HeldBall[1], HeldBall[2]));
// "aim=x,z" in metres pins the racket there, and the mouse is left unattached.
const Aim = Numbers("aim");
if (Aim !== null && Aim.length === 2) Hand.AimAt(new Vec3(Aim[0], 0, Aim[1]));
else Racket.Attach(Renderer.domElement);

// A neutral exposure overlay dims the rendered world without dimming the HUD.
const Dimmer = document.getElementById("dimmer")!;
const Saved = (() => { try { return Number(localStorage.getItem("courtBrightness") ?? 75); } catch { return 75; } })();
let Brightness = Number.isFinite(Saved) ? Math.max(30, Math.min(100, Saved)) : 75;
const ShowBrightness = () => { Dimmer.style.opacity = String(1 - Brightness / 100); };
ShowBrightness();
const Hud = new CourtOverlay(Rig, {
    Get: () => Brightness,
    Set: Percent => {
        Brightness = Math.max(30, Math.min(100, Percent));
        ShowBrightness();
        try { localStorage.setItem("courtBrightness", String(Brightness)); } catch { /* not kept */ }
    },
});
if (Options.has("settings")) Hud.ShowDisplaySettings();
document.getElementById("ui")!.append(Hud.Root);

function Resize(): void {
    const Width = Stage.clientWidth, Height = Stage.clientHeight;
    Renderer.setSize(Width, Height, false);
    Rig.Camera.aspect = Width / Math.max(1, Height);
    Rig.Camera.updateProjectionMatrix();
}
window.addEventListener("resize", Resize);
Resize();

const Loop = new GameLoop(Game, Hand, World, Rig, Hud, () => Renderer.render(Scene, Rig.Camera));
// "speed=0.8" sets the game speed, game seconds per real second; [ and ] step it while playing.
const Speed = Options.get("speed");
if (Speed !== null) Loop.SetSpeed(Number(Speed));

/** Back to the computer, from love-all. */
function BackToPractice(): void {
    Loop.SetGame(Configured(new Rally(Hand)));
    Hud.SetOpponent("CPU", "Computer");
}

/** Turns the rally into a match over Link: the far racket becomes the other machine's player, relayed by a NetSession the loop pumps. */
function StartMatch(Link: WebSocketTransport, AsHost: boolean, Badge: string): void {
    const Remote = new RemoteRacket(new Vec3(0, 0.2, Opponent.StandZ));
    const Match = Configured(new Rally(Hand, Remote, true));
    Loop.SetGame(Match);
    Loop.SetNet(new NetSession(Link, Hand, Remote, Match, AsHost), () => {
        BackToPractice();
        Page.Ended("Your opponent left the match.");
    });
    Link.OnRoom = State => { if (State.Count < 2) Link.Close(); };
    Hud.SetOpponent(Badge, "Opponent");
}

const Page: MatchPage = new MatchPage(StartMatch, () => { Loop.EndNet(); BackToPractice(); });
document.getElementById("ui")!.append(Page.Root);
Hud.SetOnMatch(() => { Racket.ReleaseAll(); Page.Open(); });

window.addEventListener("keydown", Event => {
    // While the Match page is open, typing goes to it; only Esc reaches the game, to close it.
    if (Page.IsOpen()) {
        if (Event.code === "Escape") Page.Close();
        return;
    }
    if (Event.ctrlKey || Event.metaKey || Event.altKey) return;
    if (Racket.KeyPressed(Event.code)) { Event.preventDefault(); return; }
    switch (Event.code) {
        case "KeyR": case "Digit1": Rig.Reset(); break;
        case "Digit2": Rig.View("courtside"); break;
        case "Digit3": Rig.View("overhead"); break;
        case "Digit4": Rig.View("reverse"); break;
        case "Digit5": Rig.View("left"); break;
        case "Digit6": Rig.View("right"); break;
        case "Digit7": Rig.View("hall"); break;
        case "Digit8": Rig.View("racket"); break;
        case "KeyH": Hud.ToggleVisible(); break;
        // In a match the host puts every ball in play, so a new ball on demand is practice only.
        case "Space": if (!Loop.Online()) Loop.Current().FeedNow(); Event.preventDefault(); break;
        case "KeyM": Event.preventDefault(); Racket.ReleaseAll(); Page.Open(); break;
        case "BracketLeft": Loop.StepSpeed(-1); break;
        case "BracketRight": Loop.StepSpeed(+1); break;
        case "KeyP": Loop.TogglePause(); break;
        case "KeyF": Rig.ToggleFollow(); break;
        default: return;
    }
});
window.addEventListener("keyup", Event => Racket.KeyReleased(Event.code));
window.addEventListener("blur", () => Racket.ReleaseAll());

Loop.Start();
// For automated checks (Playwright): the loop and rally, read-only by convention.
(window as unknown as { TableTennis: unknown }).TableTennis = { Loop, Rig, Hand };
