# 🏓 3D Table Tennis

Table tennis with real physics, where every shot comes from your swing. This is the TypeScript edition: it runs in the browser, with [Three.js](https://threejs.org) for the 3D and a small Node relay for online matches. It's a port of the [Java edition](https://gitlab.com/Chaojie.Chen.TX/3d-table-tennis-java-edition) (Java 21 + JavaFX), with the same physics, rules and computer opponent.

You control the paddle with your mouse, and the ball follows *real physics*. Nothing about a shot is chosen from a menu or a button press. Its speed, direction and spin all come from how the paddle is moving when it meets the ball.

> **Status:** early development, like the Java edition. There are no serves yet: each point starts with a ball fed to one of the players.

## Contents

- [Game modes](#game-modes)
- [Running it](#running-it)
- [How to play](#how-to-play)
- [Playing a match online](#playing-a-match-online)
- [For developers](#for-developers)
- [Roadmap](#roadmap)

## Game modes

**Practice.** Play against the computer. It feeds you one ball after another, working through five drills in turn: a plain *warm-up* ball, *topspin*, *backspin*, and *sidespin* curving each way. Every point is scored, so practice is also a full match against the computer.

**Match.** Play another person over the internet or your local network. One of you hosts and reads out a four-letter room code; the other types it in. See [Playing a match online](#playing-a-match-online).

## Running it

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
git clone https://github.com/ChaojieChen-One/3D-Table-Tennis.git
cd 3D-Table-Tennis
npm install
npm run dev
```

Then open the address it prints (usually http://localhost:5173).

## How to play

The camera is where you stand, behind your end of the table. Move the mouse to move your paddle around your end, and swing it through the ball to hit it.

- **Direction.** Hold `A` or `D` (and swipe that way) to send the ball right or left. Aim too wide and it goes out.
- **Power.** Push the paddle forward through the ball. A gentle push drops short or into the net, an ordinary one lands mid-court, a harder one lands deep and fast, and too hard a one flies past the end.
- **Spin.** Swipe sideways through the ball to spin it. The faster the swipe, the more sidespin. The ball curves but still lands on the line you aimed.
- **Height.** Once the ball has bounced on your side, your paddle rises to its height by itself.

A ball met near the edge of the paddle follows your aim less than one met in the middle. The display on the left shows the score, who won the last point and why, and the spin on the ball.

> **Note:** While hitting is being developed, the game starts at half speed. Press `[` and `]` to make it slower or faster.

### Controls

Input | Action
:-- | :--
Mouse movement | Move the paddle
Swing through the ball | Hit the ball
`W` / `S` | Tilt the paddle face down / up
`A` / `D` | Tilt the paddle face right / left
`Space` | New ball now (practice)
`[` / `]` | Slower / faster game
`P` | Pause
`M` | Open the Match page
`Esc` | Close the Match page
Left mouse button + drag | Rotate the camera
Scroll wheel | Zoom
`1` to `8` | Camera views: player, courtside, overhead, reverse, left wall, right wall, hall, paddle close-up
`F` | Turn the follow camera off or on
`R` | Reset the camera
`H` | Hide or show the on-screen display

The player camera follows the rally: it moves in after your shot, widens as the ball comes back, and pans a little with the ball. Rotating or zooming the camera stops this, and `1` or `R` brings it back. **DISPLAY SETTINGS**, in the bottom right corner, sets the court's brightness.

### Rules

The game uses official table tennis scoring: the first player to **11 points** wins a game, but only with a lead of at least **2**. A match is the best of **5** games.

In a rally, the ball must cross the net and bounce once on the opponent's side. **You lose the point if:**

- You miss the ball
- Your shot misses the table
- Your shot hits the floor
- Your shot bounces on your own side
- You hit the ball over your half of the table before it has bounced there

**Net balls.** A ball that clips the net but still lands on the opponent's side stays in play.

## Playing a match online

Browsers can't open raw network sockets, so both players connect through a small relay server that passes their messages along. It knows nothing about table tennis: each player's own browser runs the game and decides its own hits.

**On the same network** (same home or school Wi-Fi), one machine runs both the game and the relay:

1. Build the game and start the relay:
   ```bash
   npm run build
   ```
   ```bash
   npm run relay
   ```
2. Both players open `http://<that machine's IP>:26780` (the relay serves the game too). On Windows, `ipconfig` shows the IPv4 address; allow Node through the firewall on private networks if Windows asks.
3. One player presses `M` and clicks **HOST A MATCH**, then reads out the room code.
4. The other presses `M`, types the code, and clicks **JOIN**.

**Over the internet**, run the relay somewhere both players can reach. Static hosts like GitHub Pages or Vercel can serve the game, but they can't run the relay, so it goes on a Node host. On [Render](https://render.com)'s free plan:

1. **New > Web Service**, connect this repository, and pick a region near the players.
2. Runtime **Node**, build command `npm ci`, start command `npm start`, instance type **Free**. Render sets `PORT`; the relay reads it.
3. Once it's live, note its address, e.g. `https://3d-table-tennis-relay.onrender.com`.
4. In the Vercel project, add the environment variable `VITE_RELAY_URL` = `wss://3d-table-tennis-relay.onrender.com` (`wss://`, same host) and redeploy. The Match page then uses it with nothing to type.

A free Render service sleeps after 15 minutes without traffic and takes about a minute to wake; opening the Match page starts waking it. A [playit.gg](https://playit.gg) tunnel to local port `26780` also works, typed under **CONNECTION** on the Match page.

A match runs at half speed on both computers, and if one player leaves, the other goes back to practice.

## For developers

Command | What it does
:-- | :--
`npm run dev` | Dev server with hot reload (`npm run dev -- --host` to reach it from other machines)
`npm test` | All tests (physics, rules, AI, controls, netcode, relay)
`npm run typecheck` | TypeScript, no emit
`npm run build` | Typecheck and build to `dist/`
`npm run relay` | Match relay on port 26780 (`PORT=8080 npm run relay` for another), serving `dist/` if it's built

**URL options**, the Java edition's command-line flags as query parameters, for example `http://localhost:5173/?speed=0.8&view=courtside`:

Option | Effect
:-- | :--
`speed=0.8` | Game speed, from 0.1 to 1 (default 0.5)
`follow=off` | Start with the follow camera off
`lift=off` | Turn off the automatic paddle lift
`assist=off` | Leave every hit to the raw physics, without the aimed direction and power
`aimhelp=0.8` | Turn on the aim help, from 0 (off, the default) to 1
`view=courtside` | Start in another camera view: `player`, `courtside`, `overhead`, `reverse`, `left`, `right`, `hall` or `racket`
`aim=x,z` | Pin your paddle at that spot, in metres from the table's centre (`+z` toward you)
`ball=x,y,z` | Hold the ball still there (`+y` up from the tabletop), with no feeds
`settings` | Open the display settings at launch

**Layout.** `src/engine` is pure ball physics, `src/game` the rules, players and controls, `src/net` the online play, and `src/app` the Three.js shell. The dependency runs one way, `app → net → game → engine`, and only `app` touches the browser or Three.js. `CLAUDE.md` explains the architecture in detail.

**Ready for more than two players.** The rally takes a list of *seats* (each a side of the table, a racket driver and whether this machine simulates it), the referee and scoreboard work by end of the table rather than by player, and relay rooms hold up to five seats with every message tagged by who sent it. Doubles still needs its order-of-play rule (ITTF 2.8.3) in the referee and the match code to fill the extra seats.

**One known failing test.** `APushingPlayerRallies` measures 2.98 returns per feed against a threshold of 3, exactly as it does in the Java edition, since the computer was made beatable there. It's skipped by default; `RUN_KNOWN_FAILING=1 npm test` runs it. Per the project's rule, the threshold isn't loosened to make it pass: re-baselining it is the owner's call.

## Roadmap

Carried over from the Java edition, in rough order:

Step | Feature | Details
:--: | :-- | :--
1 | Better hits | Shots depend even more on your swing, and the game assists less
2 | Faster game | A slightly faster game speed
3 | New graphics | Improved lighting, paddles and playing hall
4 | Serving | Double-click to toss the ball and hit it as it falls, following official serve rules
5 | Match mode | First version done: online play against another person. Serves still to come
6 | Doubles (2v2) | The seat-based rally and the relay's rooms are the groundwork

**Planned for later**: `sound`, `tournaments`.

## Team

- **Chaojie Chen**: creator
