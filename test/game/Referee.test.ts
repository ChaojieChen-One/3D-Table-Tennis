import { expect, test } from "vitest";
import { BallState } from "../../src/engine/BallState";
import { CollisionResult } from "../../src/engine/Collisions";
import { Vec3 } from "../../src/engine/math/Vec3";
import { FixedClock } from "../../src/game/FixedClock";
import { Rally } from "../../src/game/Rally";
import { Point, Referee } from "../../src/game/Referee";
import { Side } from "../../src/game/Side";

/**
 * The ITTF Laws of Table Tennis as the referee applies them, one event at a time. The near
 * (player's) court is z > 0 and the far (computer's) is z < 0; the feed counts as the far stroke.
 */
const Step = FixedClock.Step;

const PlayersCourt = new Vec3(0, 0.02, 0.8), ComputersCourt = new Vec3(0, 0.02, -0.8);
const OverPlayersCourt = new Vec3(0, 0.3, 0.8), BehindPlayer = new Vec3(0, 0.3, 2.0);
const BehindComputer = new Vec3(0, 0.3, -2.0), Floor = new Vec3(0, -0.74, 2.5);

let Umpire: Referee;

function Fed(): Referee {
    Umpire = new Referee();
    Umpire.Begin("Far");
    return Umpire;
}

function Event(At: Vec3, Table: boolean, Net: boolean, OnFloor: boolean, Racket: number): CollisionResult {
    return { Ball: new BallState(At, Vec3.Zero, Vec3.Zero), Table, Net, Floor: OnFloor, Racket };
}

const Bounce = (At: Vec3) => Umpire.Judge(Event(At, true, false, false, -1), false, Step);
const Strike = (By: Side, At: Vec3) => Umpire.Judge(Event(At, false, false, false, By === "Near" ? Rally.PlayerRacket : Rally.OpponentRacket), false, Step);
const Net = (At: Vec3) => Umpire.Judge(Event(At, false, true, false, -1), false, Step);
const FloorAt = () => Umpire.Judge(Event(Floor, false, false, true, -1), false, Step);
function Wait(Seconds: number): Point | null {
    let Decided: Point | null = null;
    for (let T = 0; T < Seconds && Decided === null; T += Step) Decided = Umpire.Judge(Event(OverPlayersCourt, false, false, false, -1), false, Step);
    return Decided;
}

function Expect(Winner: Side, Decided: Point | null): void {
    expect(Decided, "no point was decided").not.toBeNull();
    expect(Decided!.Winner, "point to the wrong side: " + Decided).toBe(Winner);
    console.log(String(Decided));
}

test("AGoodExchangeGoesOn", () => {
    Fed();
    expect(Bounce(PlayersCourt), "the feed lands on the player's court").toBeNull();
    expect(Wait(0.3)).toBeNull();
    expect(Strike("Near", BehindPlayer), "the player returns it after one bounce").toBeNull();
    expect(Wait(0.3)).toBeNull();
    expect(Net(new Vec3(0, 0.16, 0)), "a net touch in a rally is play on").toBeNull();
    expect(Bounce(ComputersCourt), "and lands on the computer's court").toBeNull();
    expect(Wait(0.3)).toBeNull();
    expect(Strike("Far", BehindComputer), "the computer returns it").toBeNull();
    expect(Bounce(PlayersCourt)).toBeNull();
});

test("ASecondBounceOnTheReceiversCourtIsThePoint", () => {
    Fed();
    Bounce(PlayersCourt);
    Wait(0.3);
    Expect("Far", Bounce(PlayersCourt));
});

test("AReturnThatLandsOnTheStrikersOwnCourtLosesThePoint", () => {
    Fed();
    Bounce(PlayersCourt);
    Wait(0.3);
    Strike("Near", BehindPlayer);
    Wait(0.2);
    Expect("Far", Bounce(PlayersCourt));
});

test("AShotThatMissesTheTableLosesThePoint", () => {
    Fed();
    Bounce(PlayersCourt);
    Wait(0.3);
    Strike("Near", BehindPlayer);
    Wait(0.3);
    Expect("Far", FloorAt());
});

test("ABallNotReturnedAfterItsBounceLosesTheReceiverThePoint", () => {
    Fed();
    Bounce(PlayersCourt);
    Wait(0.3);
    Expect("Far", FloorAt());
});

/** Law 2.10.1.5: touching the ball above one's own court before it has bounced there is obstruction. */
test("HittingTheBallOverYourCourtBeforeItBouncesIsObstruction", () => {
    Fed();
    Wait(0.2);
    Expect("Far", Strike("Near", OverPlayersCourt));
});

/** Law 2.10.1.4: a ball that passed the player's end line without touching their court is the player's point, even if they hit it. */
test("HittingABallThatHasAlreadyMissedYourCourtWinsThePoint", () => {
    Fed();
    Wait(0.3);
    Expect("Near", Strike("Near", BehindPlayer));
});

/** Law 2.10.1.6: striking again before the opponent has, after the stroke is over, loses the point; two touches in one stroke are one. */
test("StrikingTwiceInSuccessionLosesThePointButOneStrokeIsOne", () => {
    Fed();
    Bounce(PlayersCourt);
    Wait(0.3);
    Strike("Near", BehindPlayer);
    expect(Strike("Near", BehindPlayer), "a second touch in the same stroke").toBeNull();
    Wait(0.3);
    Expect("Far", Strike("Near", BehindPlayer));
});

test("ABallThatStopsOrLeavesEndsTheRally", () => {
    Fed();
    Bounce(PlayersCourt);
    const Decided = Umpire.Judge(Event(OverPlayersCourt, false, false, false, -1), true, Step);
    Expect("Far", Decided);
});

/** Nothing can loop for ever: a rally with no stroke for too long ends, as a let if nothing decided it. */
test("ARallyThatStallsEndsAsALet", () => {
    Fed();
    const Decided = Wait(Referee.LongestWait + 0.1);
    expect(Decided !== null && Decided.Winner === null, "decided: " + Decided).toBe(true);
});

test("NothingIsJudgedOnceThePointIsOver", () => {
    Fed();
    Bounce(PlayersCourt);
    Wait(0.3);
    Expect("Far", FloorAt());
    expect(Bounce(PlayersCourt), "the point was already decided").toBeNull();
});

/** The reasons name each end as the machine reading them does; the other end's machine sees the call mirrored. */
test("APointReadsTheSameFromEitherEnd", () => {
    Fed();
    Bounce(PlayersCourt);
    Wait(0.3);
    const Decided = FloorAt()!;
    const Here = Decided.Describe({ Near: "Ann", Far: "Bo" });
    const There = Decided.Mirrored().Describe({ Near: "Bo", Far: "Ann" });
    console.log(Here + " | " + There);
    expect(There).toBe(Here);
    expect(Decided.Mirrored().Winner).toBe("Near");
});

/** Any racket of an end strikes for that end: a doubles pair at the near end shares its strokes. */
test("ARacketStrikesForTheEndItsSeatPlaysFor", () => {
    const Doubles = new Referee(Index => (Index === 0 || Index === 2) ? "Near" : "Far");
    Umpire = Doubles;
    Doubles.Begin("Far");
    Bounce(PlayersCourt);
    Wait(0.3);
    expect(Doubles.Judge(Event(BehindPlayer, false, false, false, 2), false, Step), "the partner returns it").toBeNull();
    Wait(0.3);
    Expect("Far", FloorAt());
});
