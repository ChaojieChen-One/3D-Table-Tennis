import { FixedClock } from "../game/FixedClock";
import { Rally } from "../game/Rally";
import { RallyView } from "../game/RallyView";
import { CursorFollower } from "../game/control/CursorFollower";
import { NetSession } from "../net/NetSession";
import { CameraRig } from "./camera/CameraRig";
import { CourtOverlay } from "./CourtOverlay";
import { RallyEvents } from "./RallyEvents";
import { TableScene } from "./scene/TableScene";
import { SpinLine } from "./SpinLine";

/**
 * The game's heartbeat, once per animation frame: real time, scaled by the game speed, becomes
 * whole fixed steps of the rally, then the scene is drawn between the last two steps. The game
 * never sees a frame time. What each step's ball struck is passed to the scene for its impact marks.
 */
export class GameLoop {
    /**
     * TUNED: game seconds per real second at launch, 1/2 while the hitting is being developed, at
     * the owner's request; play has run at 4/5 (3/5 was not intense enough). Everything slows
     * alike: the ball, every racket and every pause, so the physics is unchanged, only watched
     * slower. "?speed=" and the [ and ] keys change it.
     */
    static readonly DefaultSpeed = 0.5;

    /** The speeds [ and ] step through, game seconds per real second. */
    private static readonly Speeds = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0];

    /** Further than this in one step, m, the ball did not fly there: it was put there. */
    private static readonly Jump = 0.2;

    private readonly Clock = new FixedClock();
    private GameSpeed = GameLoop.DefaultSpeed;
    private Paused = false;

    /** The link to the other machine in a match, or null against the computer. */
    private Net: NetSession | null = null;
    private OnOpponentLost: () => void = () => {};

    private Before: RallyView;
    private After: RallyView;
    private LastFrame = -1;

    /** Whoever shows or sounds the rally (RallyEvents), and the last call they were told of. */
    private readonly Listeners: RallyEvents[] = [];
    private ToldPoint: unknown = null;

    constructor(private Game: Rally,
                private readonly Hand: CursorFollower,
                private readonly World: TableScene,
                private readonly Rig: CameraRig,
                private readonly Hud: CourtOverlay,
                private readonly Render: () => void) {
        Hand.SetStance(Rig.Eye(), Rig.Looking());
        this.Before = this.After = Game.View();
        this.Draw(this.After);
        this.ShowSpeed();
    }

    Start(): void {
        const Frame = (Now: number) => { this.Handle(Now); requestAnimationFrame(Frame); };
        requestAnimationFrame(Frame);
    }

    /** Tells Listener what happens in the rally from now on. */
    Listen(Listener: RallyEvents): void { this.Listeners.push(Listener); }

    /** One frame at Now, ms. */
    Handle(Now: number): void {
        const RealSeconds = this.LastFrame < 0 ? 0 : (Now - this.LastFrame) / 1000;
        const Seconds = this.Paused ? 0 : RealSeconds * this.GameSpeed;
        this.LastFrame = Now;
        // The follow camera eases on real time, so it stays crisp in slow motion.
        this.Rig.Follow(RealSeconds, this.After.Ball.Position, this.After.Ball.Velocity);
        // Footwork is the camera: the player stands where it is and faces the way it looks.
        this.Hand.SetStance(this.Rig.Eye(), this.Rig.Looking());
        if (this.Net !== null) {
            this.Net.Pump(Seconds);
            if (!this.Net.Connected()) {
                this.Net = null;
                this.ShowSpeed();
                this.OnOpponentLost();
            }
        }
        for (let Due = this.Clock.Advance(Seconds); Due > 0; Due--) {
            this.Before = this.After;
            this.Game.Step();
            this.After = this.Game.View();
            this.World.RecordBall(this.After.Ball, FixedClock.Step);
            this.MarkContacts();
            this.TellStep();
        }
        const Drawn = RallyView.Between(this.Before, this.After, this.Clock.Alpha());
        this.Draw(Drawn);
        // After drawing, so a mark riding on a racket follows where it was just drawn.
        this.World.Advance(Seconds);
        for (const Each of this.Listeners) Each.Frame?.(RealSeconds, Seconds, Drawn);
        this.Render();
    }

    /** The rally being played now. */
    Current(): Rally { return this.Game; }

    /** Plays Next from now on, in place of the current rally. */
    SetGame(Next: Rally): void {
        this.Game = Next;
        this.Before = this.After = Next.View();
        this.ToldPoint = Next.LastPoint();
        this.World.SetRacketCount(this.After.Rackets.length);
    }

    /**
     * Pumps Session every frame from now on (null to stop), and runs OnLost if the other machine goes.
     * A match runs at DefaultSpeed on both machines and can't be paused, since each machine flies
     * the other's strokes on its own clock.
     */
    SetNet(Session: NetSession | null, OnLost: () => void): void {
        this.Net = Session;
        this.OnOpponentLost = OnLost;
        if (Session !== null) {
            this.GameSpeed = GameLoop.DefaultSpeed;
            this.Paused = false;
        }
        this.ShowSpeed();
    }

    /** Leaves the match: hangs up on the other machine, without running its OnLost. */
    EndNet(): void {
        this.Net?.Close();
        this.Net = null;
        this.ShowSpeed();
    }

    /** In a match: the speed is fixed and pausing is off. */
    Online(): boolean { return this.Net !== null; }

    /** Sets the game speed, game seconds per real second, held between the slowest and fastest of Speeds. */
    SetSpeed(Speed: number): void {
        if (this.Online()) return;
        const All = GameLoop.Speeds;
        if (Number.isFinite(Speed)) this.GameSpeed = Math.max(All[0], Math.min(All[All.length - 1], Speed));
        this.ShowSpeed();
    }

    /** The next speed down (Steps -1) or up (+1) from the current one. */
    StepSpeed(Steps: number): void {
        if (this.Online()) return;
        const All = GameLoop.Speeds;
        let Index = 0;
        while (Index < All.length - 1 && All[Index] < this.GameSpeed - 1e-9) Index++;
        if (Steps > 0 && All[Index] <= this.GameSpeed + 1e-9) Index++;
        if (Steps < 0) Index--;
        this.SetSpeed(All[Math.max(0, Math.min(All.length - 1, Index))]);
    }

    TogglePause(): void {
        if (this.Online()) return;
        this.Paused = !this.Paused;
        this.ShowSpeed();
    }

    private ShowSpeed(): void {
        const Speed = this.Paused ? "PAUSED" : `SPEED  ${(this.GameSpeed * 100).toFixed(0)}%`;
        this.Hud.ShowSpeed(this.Online() ? Speed + "  ·  ONLINE MATCH" : Speed);
    }

    /** An impact mark wherever the last step's ball struck the table or a racket, as strong as the contact was hard. */
    private MarkContacts(): void {
        const Struck = this.Game.LastStep();
        if (!Struck.Table && Struck.Racket < 0) return;
        const Ball = this.After.Ball.Position;
        const SpeedChange = this.After.Ball.Velocity.Minus(this.Before.Ball.Velocity).Length();
        if (Struck.Table) this.World.TableImpact(Ball, SpeedChange);
        if (Struck.Racket >= 0) this.World.RacketImpact(Struck.Racket, Ball, SpeedChange);
    }

    /** Tells the listeners what the last step's ball struck, a new ball, and a new call. */
    private TellStep(): void {
        if (this.Listeners.length === 0) return;
        const Struck = this.Game.LastStep(), Ball = this.After.Ball, At = Ball.Position;
        const SpeedChange = Ball.Velocity.Minus(this.Before.Ball.Velocity).Length();
        // A ball that jumped further than any flight covers in one step is a new one.
        const Fresh = At.Minus(this.Before.Ball.Position).Length() > GameLoop.Jump;
        for (const Each of this.Listeners) {
            if (Fresh) Each.NewBall?.(Ball);
            if (Struck.Table) Each.Bounce?.(At, SpeedChange, Ball);
            if (Struck.Racket >= 0) Each.Hit?.(Struck.Racket, At, SpeedChange, Ball);
            if (Struck.Net) Each.Net?.(At, SpeedChange);
            if (Struck.Floor) Each.Floor?.(At, SpeedChange);
        }
        const Called = this.Game.LastPoint();
        if (Called !== this.ToldPoint) {
            this.ToldPoint = Called;
            if (Called !== null) for (const Each of this.Listeners) Each.Point?.(Called, this.Game.Score());
        }
    }

    private Draw(View: RallyView): void {
        View.Rackets.forEach((Each, Index) => this.World.PoseRacket(Index, Each.Centre, Each.Normal, Each.Roll));
        this.World.PlaceBall(View.Ball.Position);
        this.Hud.ShowSpin(SpinLine.Describe(View.Ball));
        this.Hud.ShowScore(this.Game.Score(), this.Game.LastPoint());
    }
}
