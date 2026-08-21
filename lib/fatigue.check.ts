import { analyzeFace, FatigueSession, type Landmark } from "./fatigue.ts";

function lm(x: number, y: number): Landmark {
  return { x, y, z: 0 };
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

/** Build a 478-point face with open eyes and closed mouth. */
function face(opts?: { eyeOpen?: number; mouthOpen?: number }): Landmark[] {
  const pts: Landmark[] = Array.from({ length: 478 }, () => lm(0, 0));
  const eyeOpen = opts?.eyeOpen ?? 0.06;
  const mouthOpen = opts?.mouthOpen ?? 0.02;
  // RIGHT_EYE = [33, 160, 158, 133, 153, 144] outer, up, up, inner, low, low
  pts[33] = lm(0.3, 0.4);
  pts[133] = lm(0.4, 0.4);
  pts[160] = lm(0.33, 0.4 - eyeOpen);
  pts[158] = lm(0.37, 0.4 - eyeOpen);
  pts[153] = lm(0.37, 0.4 + eyeOpen);
  pts[144] = lm(0.33, 0.4 + eyeOpen);
  // LEFT_EYE = [263, 385, 387, 362, 373, 380]
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
const t0 = 1_000_000;
let snap = session.step(closed, t0);
assert(!snap.alert, "no instant eye alert");
snap = session.step(closed, t0 + 60);
assert(snap.alert?.kind === "eyes", `expected eyes, got ${snap.alert?.kind}`);

snap = session.step(yawn, t0 + 80);
snap = session.step(yawn, t0 + 140);
assert(snap.alert?.kind === "yawn", `expected yawn, got ${snap.alert?.kind}`);

console.log("fatigue checks passed");
