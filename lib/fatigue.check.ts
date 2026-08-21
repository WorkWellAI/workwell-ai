import {
  analyzeFace,
  EMPTY_FATIGUE_CTX,
  FatigueSession,
  fatigueScoreParts,
  type Landmark,
} from "./fatigue.ts";

function lm(x: number, y: number): Landmark {
  return { x, y, z: 0 };
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function face(opts?: { eyeOpen?: number; mouthOpen?: number }): Landmark[] {
  const pts: Landmark[] = Array.from({ length: 478 }, () => lm(0, 0));
  const eyeOpen = opts?.eyeOpen ?? 0.06;
  const mouthOpen = opts?.mouthOpen ?? 0.02;
  pts[33] = lm(0.3, 0.4);
  pts[133] = lm(0.4, 0.4);
  pts[160] = lm(0.33, 0.4 - eyeOpen);
  pts[158] = lm(0.37, 0.4 - eyeOpen);
  pts[153] = lm(0.37, 0.4 + eyeOpen);
  pts[144] = lm(0.33, 0.4 + eyeOpen);
  pts[263] = lm(0.7, 0.4);
  pts[362] = lm(0.6, 0.4);
  pts[385] = lm(0.63, 0.4 - eyeOpen);
  pts[387] = lm(0.67, 0.4 - eyeOpen);
  pts[373] = lm(0.67, 0.4 + eyeOpen);
  pts[380] = lm(0.63, 0.4 + eyeOpen);
  pts[13] = lm(0.5, 0.55);
  pts[14] = lm(0.5, 0.55 + mouthOpen);
  pts[61] = lm(0.4, 0.56);
  pts[291] = lm(0.6, 0.56);
  return pts;
}

const open = analyzeFace(face({ eyeOpen: 0.06, mouthOpen: 0.02 }));
assert(open.present, "face present");
assert(open.ear > 0.5, `open EAR should be high, got ${open.ear}`);
assert(open.mar < 0.2, `closed mouth MAR should be low, got ${open.mar}`);

const closed = analyzeFace(face({ eyeOpen: 0.008, mouthOpen: 0.02 }));
assert(closed.ear < 0.2, `closed EAR should be low, got ${closed.ear}`);

const yawn = analyzeFace(face({ eyeOpen: 0.06, mouthOpen: 0.14 }));
assert(yawn.mar > 0.55, `yawn MAR should be high, got ${yawn.mar}`);

const session = new FatigueSession();
session.eyesHoldMsNeeded = 50;
session.yawnHoldMsNeeded = 50;
session.cooldownMs = 1;
session.minPerclosSamples = 10_000;
const t0 = 1_000_000;
let snap = session.step(closed, EMPTY_FATIGUE_CTX, t0);
assert(!snap.alert, "no instant eye alert");
snap = session.step(closed, EMPTY_FATIGUE_CTX, t0 + 60);
assert(snap.alert?.kind === "eyes", `expected eyes, got ${snap.alert?.kind}`);

snap = session.step(yawn, EMPTY_FATIGUE_CTX, t0 + 80);
snap = session.step(yawn, EMPTY_FATIGUE_CTX, t0 + 140);
assert(snap.alert?.kind === "yawn", `expected yawn, got ${snap.alert?.kind}`);
assert(snap.yawns10min >= 1, "yawn should count even after alert");

const parts = fatigueScoreParts({
  perclos: 0.15,
  yawns10min: 3,
  nods2min: 3,
  sittingMs: 60_000,
  sitLimitMs: 60_000,
});
assert(parts.score === 100, `full signals should be 100, got ${parts.score}`);

const perclosS = new FatigueSession();
perclosS.minPerclosSamples = 8;
perclosS.sampleGapMs = 50;
perclosS.eyesHoldMsNeeded = 60_000;
perclosS.yawnHoldMsNeeded = 60_000;
perclosS.scoreHoldMsNeeded = 60_000;
const t1 = 2_000_000;
for (let i = 0; i < 12; i++) {
  snap = perclosS.step(
    i < 6 ? closed : open,
    EMPTY_FATIGUE_CTX,
    t1 + i * 50,
  );
}
assert(
  snap.perclos > 0.4 && snap.perclos < 0.7,
  `PERCLOS around 50%, got ${snap.perclos}`,
);

const nodS = new FatigueSession();
nodS.minPerclosSamples = 10_000;
nodS.eyesHoldMsNeeded = 60_000;
const ctx = { ...EMPTY_FATIGUE_CTX, bodyPresent: true };
let t = 3_000_000;
snap = nodS.step(open, { ...ctx, neckAngle: 12 }, t);
t += 40;
snap = nodS.step(open, { ...ctx, neckAngle: 30 }, t);
t += 400;
snap = nodS.step(open, { ...ctx, neckAngle: 14 }, t);
assert(snap.nods2min === 1, `one nod expected, got ${snap.nods2min}`);
t += 800;
snap = nodS.step(open, { ...ctx, neckAngle: 31 }, t);
t += 350;
snap = nodS.step(open, { ...ctx, neckAngle: 13 }, t);
assert(snap.nods2min === 2, `two nods expected, got ${snap.nods2min}`);

t += 40;
snap = nodS.step(open, { ...ctx, neckAngle: 32 }, t);
t += 3_000;
snap = nodS.step(open, { ...ctx, neckAngle: 12 }, t);
assert(
  snap.nods2min === 2,
  `sustained drop is posture, still 2 nods, got ${snap.nods2min}`,
);

const scoreS = new FatigueSession();
scoreS.minPerclosSamples = 6;
scoreS.sampleGapMs = 50;
scoreS.eyesHoldMsNeeded = 60_000;
scoreS.yawnHoldMsNeeded = 60_000;
scoreS.scoreHoldMsNeeded = 400;
scoreS.scoreAlertAt = 40;
scoreS.scoreCooldownMs = 1;
const t2 = 4_000_000;
for (let i = 0; i < 8; i++) {
  snap = scoreS.step(closed, EMPTY_FATIGUE_CTX, t2 + i * 50);
}
assert(!snap.alert, "score should need hold time");
snap = scoreS.step(closed, EMPTY_FATIGUE_CTX, t2 + 800);
assert(
  snap.alert?.kind === "fatigue",
  `expected composite fatigue, got ${snap.alert?.kind} score=${snap.score}`,
);

console.log("fatigue checks passed");
