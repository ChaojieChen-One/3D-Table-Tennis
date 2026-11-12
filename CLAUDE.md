# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A browser table tennis game in TypeScript + Three.js, ported from the Java edition
(https://gitlab.com/Chaojie.Chen.TX/3d-table-tennis-java-edition, Java 21 + JavaFX). Every shot
starts from real contact physics between the swung racket and the ball, and the spin stays the
contact's. At the owner's request, the player's shot direction follows their aim, and its power
follows their forward push (`ShotAssist`). Nothing makes a shot land. `?assist=off` leaves the
player's hits fully physical. The Java edition's `docs/PLAN.md` and `docs/HANDOFF.md` hold the
roadmap's history and the owner's queued requests (see "Open work" below).

## Commands

```bash
npm run dev                          # dev server, http://localhost:5173
npm test                             # all vitest tests (verbose: each prints what it measured)
npx vitest run test/game/Referee.test.ts
npx vitest run -t TopspinDipsAndBackspinFloats
npm run typecheck
npm run build                        # to dist/
npm run relay                        # the match relay on :26780, serving dist/ if built
RUN_KNOWN_FAILING=1 npm test         # include APushingPlayerRallies (see below)
```

No linter or formatter is configured. Visual QA: Playwright (preinstalled in cloud sessions)
against `npm run dev`, with the URL options in the README (`?view=courtside&aim=0.2,1.5&ball=0,0.3,1.0`);
`window.TableTennis` exposes `{ Loop, Rig, Hand }` for scripted checks.

## Architecture

Four layers with a one-way dependency: **`app -> net -> game -> engine`**, plus `server/relay.ts`.
Only `app` touches the DOM or Three.js; only `server` touches Node.

- **`src/engine`**: pure ball physics, no game rules.
  - `Flight`: an RK4 step under `Air` (gravity, quadratic drag, Magnus lift with a capped lift coefficient).
    Spin decays by distance flown (`Air.SpinDecayPerMetre`).
  - `Contact.Bounce`: one impulse solver for every surface: normal restitution plus friction against
    the contact-point slip. Rubber's grip springs back (`Surface.SpringBack`), so incoming spin
    reverses off a racket, and spin about the face's normal is damped.
  - `Collisions.Resolve`: swept tests from the step-start state to the flown state, in a fixed order:
    rackets (any number, in order), then net (netting or cord), then table top (from above only), then floor.
  - `RacketSweep`: a racket's start and end centre over one step; its implied velocity makes a swing hit like a swing.
  - `LaunchSolver`: the launch that lands a ball of a given speed and spin on a spot; `Landing` also serves the AI.
  - `SpinVector`: rev/s of topspin and sidespin relative to the heading, to and from angular velocity.
  - `Specs.ts` is the only source of physical sizes (table, net, ball, racket).
- **`src/game`**: rules, players and controls.
  - `Side` is an *end* of the table, `"Near"` (z > 0, this machine's player) or `"Far"`. Every rule
    is about ends, so a side can hold one player or two.
  - `Rally` is the per-step orchestrator. Racket 0 is this machine's `CursorFollower`; every other
    racket is a `Seat { Side, Agent, Swept }`. `new Rally(Hand)` is practice against `Opponent`;
    `new Rally(Hand, Agent, true)` is networked singles; pass a seat list for anything else.
    `Step()` advances the player, flies the ball, moves every seat, resolves collisions against the
    swept rackets, then asks the `Referee`.
  - `Referee` decides points under the ITTF Laws and cites law numbers. It maps racket index to end
    through the rally's seats. Reasons are templates with `{Near}`/`{Far}` placeholders:
    `Point.Reason(Names)` names them, and `Point.Mirrored()` gives the other end's view. Feeds count
    as the far end's stroke. A stalled rally is a let after 4 s. Doubles order of play (2.8.3) is not judged.
  - `Scoreboard` keeps the score by end under ITTF 2.11.1 and 2.12.1: games to 11 (win by 2 from 10-all), best of five.
  - `Feeder` cycles its five `Drills`, each solved once by `LaunchSolver` (lazily, on first use).
  - `ShotAssist`: direction from `KeyAim` (20°) per held A/D plus `SwipeAim` (3°) per m/s of sideways
    motion; power is pace = `PaceAtRest` + `PacePerPush` × forward push on the arc that lands a
    `RefPace` ball mid-court; both blended with the raw contact by contact quality; spin from a real
    `Contact.Bounce` brushed by the whole sideways motion. Rejected by the owner: the earlier
    version's target box, landing search and rescue.
  - `Opponent` (always written for the far end) reacts after `ReactionTime`, moves at `MoveSpeed`,
    steps in for short balls, and aims by scanning face angles through `Aiming` (contact + flight)
    until a return clears the net onto its target. `Mirrored` wraps any far-end agent to play the near end.
  - `RemoteRacket` shows another machine's racket from its pose messages; it is never swept.
  - `RallyView` is the immutable snapshot the screen draws: the ball and `Rackets[]`.
- **`src/net`**: online play. `Message` + `Codec` (one text line each), `NetMirror` (the half turn
  between ends, (x, y, z) → (−x, y, −z), roll negated for poses), `Transport` (+ `MemoryTransport`
  for tests, with latency and jitter), `WebSocketTransport` (a seat in a relay room), `NetSession`
  (pumped every frame), `Relay.ts` (the relay's protocol and room codes).
  - Hitter authority: each machine decides its own player's hits and sends `Hit`; the host
    referees, spawns each ball (`Spawn`) toward a random end and sends each call (`Point`). A point
    the host wins is held `RemoteGrace` (0.15 game s) in case the other stroke is still coming.
  - Rooms hold 2 to 5 seats; the relay tags every relayed line with the sender's seat (`From`).
- **`server/relay.ts`**: pairs players by room code and relays lines; serves `dist/` on the same port.
- **`src/app`**: the Three.js shell. `main.ts` is the composition root and reads the URL options.
  `GameLoop` (requestAnimationFrame) turns frame time into whole fixed steps. `camera/CameraRig`
  holds the views, orbit/zoom and the follow camera. `input/` maps the mouse (`CursorRay`) and the
  face keys to the racket. `CourtOverlay` is the HUD, `MatchPage` hosts or joins. `scene/` holds
  the geometry and materials; it only reads game state.

### Fixed clock

Physics runs only on `FixedClock` steps of 1/480 s, with each frame clamped to 0.25 s. The game
speed (`GameLoop.DefaultSpeed` 0.5 while hitting is in development) slows real time before it
reaches the clock. Every constant in `game` and `engine` is in game seconds. The loop draws
`RallyView.Between(Before, After, Clock.Alpha())`. Game and engine code never see frame time.

### Coordinates

Metres, right-handed, origin at the centre of the table surface, `+Y` up, `+Z` toward the player.
Three.js uses the same frame, so there is no conversion layer (the Java edition's `Xform` existed
only for JavaFX's flipped, scaled space). Never hard-code a size in scene code; read `Specs.ts`.

### Player control chain

1. `CursorRay.OnPlane` meets the cursor ray with the plane at `ReachEnvelope.HitY`.
2. `ReachEnvelope.Clamp` limits it to where the racket may be.
3. `CursorFollower` moves the racket toward it at `TrackSpeed`, eases the face toward the held tilt,
   and rolls the grip with `PlayerGrip`.
4. The lift: while `Referee.Awaiting("Near")`, `Rally` passes the ball's height to `LiftToward`
   (clamped to `HitY`..`HighestLift`). `?lift=off` disables it.
5. The swing: `Swing.Read` turns the smoothed motion into the contact's swing: forward saturates
   toward `MostForward` (2 m/s), sideways is cut to `SideShare` (25%), vertical passes whole.
6. `ShotAssist` replaces the struck ball after a player hit (on by default).
7. The aim help (`Rally.AimPlayer`, off by default, `?aimhelp=0.8`) turns the untouched face toward
   `Aiming.FaceToward`'s face as a bounced ball comes within 0.8 m.

The camera is the player's stance: `GameLoop` calls `Hand.SetStance(Rig.Eye(), Rig.Looking())` every frame.

## Conventions

- **PascalCase for everything**, including methods, fields, parameters and locals, as the Java
  edition writes it (`Game.Step()`, `const PlayerFrom`). Match this; don't "fix" it to camelCase.
- Immutable classes for state (`Vec3`, `BallState`, `RacketPose`, `RallyView`, `Score`), modules of
  functions for stateless helpers (`Flight`, `Contact`, `Aiming`).
- Every hand-chosen constant carries a comment stating its units, tagged `TUNED` when picked by play
  or sweep rather than derived. Values from rules or measurements cite their source (`[ITTF] Laws 2.1`).
- Comments explain the physical or rules reasoning in plain prose. Keep that density.
- Identity matters in the engine: `Contact.Bounce` returns the same instance when the ball is
  separating, and `Collisions` uses `!==` to see whether anything was struck.

## Testing rules

- Physics and rules tests are anchored to published measurements, closed-form laws or ITTF rules,
  never to the code's own output.
- Each test prints the number it measured and passes that same string as the assertion message
  (`Check(Passed, Measured)` in `test/Measure.ts`).
- **Never loosen a test threshold to make a regression pass.** `APushingPlayerRallies` measures
  2.98 against 3, exactly as in the Java edition; it is skipped unless `RUN_KNOWN_FAILING=1`, and
  re-baselining it is the owner's decision.
- The port is checked against the Java edition's measured values: the computer returns 81 of 81
  ordinary shots and 361 of 385 spun ones. A physics change that moves those should be deliberate.

## Open work (from the Java edition's HANDOFF.md)

1. Racket tilt: the owner wants about 45° again; two held keys give atan(√2) ≈ 55°. Ask whether to
   cap the combined tilt or lower `CursorFollower.FaceTilt`.
2. The player's own shots don't seem to spin: measure before changing anything (the display's
   `BallView.MostShownRevs` squash, the mostly horizontal swing, `ShotAssist`'s curve correction and blend).
3. Serving, to the owner's design: double-click tosses the ball (≥16 cm, struck on the way down,
   [ITTF] 2.6); serve bounces on the server's side first; lets on net serves; service rotates every
   2 points and every point from 10-all. `ServeAssist` is ported and waits for it.
4. Doubles: order of play (2.8.3) in the `Referee`, and the match code to fill four seats.
