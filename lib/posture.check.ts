import { analyzePosture, PostureSession, type Landmark } from "./posture.ts";

function lm(x: number, y: number, visibility = 1): Landmark {
  return { x, y, z: 0, visibility };
}

function skeleton(overrides: Partial<Record<number, Landmark>> = {}): Landmark[] {
  const pts: Landmark[] = Array.from({ length: 33 }, () => lm(0, 0, 0));
  pts[0] = lm(0.5, 0.28);
  pts[7] = lm(0.46, 0.3);
  pts[8] = lm(0.54, 0.3);
  pts[11] = lm(0.4, 0.45);
  pts[12] = lm(0.6, 0.45);
  pts[23] = lm(0.44, 0.8);
  pts[24] = lm(0.56, 0.8);
  for (const [i, p] of Object.entries(overrides)) pts[Number(i)] = p;
  return pts;
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const upright = analyzePosture(skeleton());
assert(upright.present, "upright person should be detected");
assert(upright.headDrop < -0.5, `upright headDrop expected low, got ${upright.headDrop}`);

const chinDown = analyzePosture(skeleton({ 0: lm(0.5, 0.5) }));
assert(chinDown.headDrop > upright.headDrop, "chin down should increase headDrop");

const uneven = analyzePosture(
  skeleton({ 11: lm(0.4, 0.4), 12: lm(0.6, 0.52) }),
);
assert(uneven.shoulderTilt > 0.16, `uneven shoulders, tilt=${uneven.shoulderTilt}`);

const session = new PostureSession();
session.holdMs = 50;
session.cooldownMs = 1;
session.sitLimitMs = 200;

const t0 = 1_000_000;
let snap = session.step(chinDown, t0);
assert(!snap.alert, "should not alert immediately");
snap = session.step(chinDown, t0 + 60);
assert(snap.alert?.kind === "head", `expected head alert, got ${snap.alert?.kind}`);

session.markBreak(t0 + 70);
session.sitLimitMs = 30;
snap = session.step(upright, t0 + 80);
snap = session.step(upright, t0 + 120);
assert(snap.alert?.kind === "sit", `expected sit alert, got ${snap.alert?.kind}`);

console.log("posture checks passed");
