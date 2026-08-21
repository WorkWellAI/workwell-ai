import type { AlertEvent, Landmark } from "./posture";

/** 6-point EAR: outer, upper, upper, inner, lower, lower */
const RIGHT_EYE = [33, 160, 158, 133, 153, 144] as const;
const LEFT_EYE = [263, 385, 387, 362, 373, 380] as const;
const MOUTH_UP = 13;
const MOUTH_DOWN = 14;
const MOUTH_LEFT = 61;
const MOUTH_RIGHT = 291;

export const FACE_DOTS = [
  ...RIGHT_EYE,
  ...LEFT_EYE,
  MOUTH_UP,
  MOUTH_DOWN,
  MOUTH_LEFT,
  MOUTH_RIGHT,
];

export const EYES_HOLD_MS = 2_000;
export const YAWN_HOLD_MS = 1_200;

export type FatigueKind = "eyes" | "yawn";

export type FaceMetrics = {
  present: boolean;
  ear: number;
  mar: number;
  blink: number;
  jawOpen: number;
};

export type FatigueSnapshot = {
  metrics: FaceMetrics;
  eyesHoldMs: number;
  yawnHoldMs: number;
  calibrated: boolean;
  alert: AlertEvent | null;
};

export const FATIGUE_COPY: Record<FatigueKind, { title: string; hint: string }> = {
  eyes: {
    title: "Mắt đang nhắm — có dấu hiệu mệt",
    hint: "Mở mắt, nhìn xa 20 giây, hoặc đứng dậy uống nước.",
  },
  yawn: {
    title: "Phát hiện ngáp",
    hint: "Tạm dừng 1–2 phút, hít sâu vài hơi trước khi làm tiếp.",
  },
};

function dist(a: Landmark, b: Landmark) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function sixPointEar(
  landmarks: Landmark[],
  idx: readonly [number, number, number, number, number, number],
) {
  const pts = idx.map((i) => landmarks[i]);
  if (pts.some((p) => !p)) return 0;
  const [p1, p2, p3, p4, p5, p6] = pts as Landmark[];
  const width = dist(p1, p4);
  if (width < 1e-5) return 0;
  return (dist(p2, p6) + dist(p3, p5)) / (2 * width);
}

function blendscore(
  categories: Array<{ categoryName: string; score: number }> | undefined,
  name: string,
) {
  if (!categories) return -1;
  const hit = categories.find(
    (c) => c.categoryName.toLowerCase() === name.toLowerCase(),
  );
  return hit ? hit.score : -1;
}

export function analyzeFace(
  landmarks: Landmark[] | undefined,
  blendshapes?: Array<{ categoryName: string; score: number }>,
): FaceMetrics {
  if (!landmarks || landmarks.length < 400) {
    return { present: false, ear: 0, mar: 0, blink: -1, jawOpen: -1 };
  }

  const left = sixPointEar(landmarks, LEFT_EYE);
  const right = sixPointEar(landmarks, RIGHT_EYE);
  const ear = (left + right) / 2;

  const up = landmarks[MOUTH_UP];
  const down = landmarks[MOUTH_DOWN];
  const ml = landmarks[MOUTH_LEFT];
  const mr = landmarks[MOUTH_RIGHT];
  let mar = 0;
  if (up && down && ml && mr) {
    const width = dist(ml, mr);
    if (width > 1e-5) mar = dist(up, down) / width;
  }

  const blinkL = blendscore(blendshapes, "eyeBlinkLeft");
  const blinkR = blendscore(blendshapes, "eyeBlinkRight");
  const blink =
    blinkL >= 0 && blinkR >= 0 ? (blinkL + blinkR) / 2 : Math.max(blinkL, blinkR);
  const jawOpen = blendscore(blendshapes, "jawOpen");

  return { present: true, ear, mar, blink, jawOpen };
}

export class FatigueSession {
  eyesHoldMsNeeded = EYES_HOLD_MS;
  yawnHoldMsNeeded = YAWN_HOLD_MS;
  cooldownMs = 40_000;

  private earBaseline: number | null = null;
  private calibSamples: number[] = [];
  private calibratingUntil = 0;
  private eyesSince: number | null = null;
  private yawnSince: number | null = null;
  private lastAlertAt: Record<FatigueKind, number> = { eyes: 0, yawn: 0 };

  get calibrated() {
    return this.earBaseline !== null;
  }

  get isCalibrating() {
    return Date.now() < this.calibratingUntil;
  }

  startCalibration(now = Date.now(), durationMs = 3_000) {
    this.calibSamples = [];
    this.calibratingUntil = now + durationMs;
    this.earBaseline = null;
  }

  step(metrics: FaceMetrics, now = Date.now()): FatigueSnapshot {
    if (this.isCalibrating && metrics.present && metrics.ear > 0.12) {
      this.calibSamples.push(metrics.ear);
      if (now >= this.calibratingUntil) this.commitCalibration();
    } else if (this.isCalibrating && now >= this.calibratingUntil) {
      this.commitCalibration();
    }

    let eyesHoldMs = 0;
    let yawnHoldMs = 0;
    let alert: AlertEvent | null = null;

    if (!metrics.present) {
      this.eyesSince = null;
      this.yawnSince = null;
    } else {
      if (this.isEyesClosed(metrics)) {
        if (this.eyesSince === null) this.eyesSince = now;
        eyesHoldMs = now - this.eyesSince;
      } else {
        this.eyesSince = null;
      }

      if (this.isYawn(metrics)) {
        if (this.yawnSince === null) this.yawnSince = now;
        yawnHoldMs = now - this.yawnSince;
      } else {
        this.yawnSince = null;
      }

      if (eyesHoldMs >= this.eyesHoldMsNeeded) {
        alert = this.tryAlert("eyes", now);
      }
      if (!alert && yawnHoldMs >= this.yawnHoldMsNeeded) {
        alert = this.tryAlert("yawn", now);
      }
    }

    return {
      metrics,
      eyesHoldMs,
      yawnHoldMs,
      calibrated: this.calibrated,
      alert,
    };
  }

  private isEyesClosed(m: FaceMetrics) {
    if (m.blink >= 0.52) return true;
    if (this.earBaseline && this.earBaseline > 0.12) {
      return m.ear > 0 && m.ear < this.earBaseline * 0.62;
    }
    return m.ear > 0 && m.ear < 0.19;
  }

  private isYawn(m: FaceMetrics) {
    if (m.jawOpen >= 0.42) return true;
    return m.mar >= 0.55;
  }

  private tryAlert(kind: FatigueKind, now: number): AlertEvent | null {
    if (now - this.lastAlertAt[kind] < this.cooldownMs) return null;
    this.lastAlertAt[kind] = now;
    if (kind === "eyes") this.eyesSince = null;
    if (kind === "yawn") this.yawnSince = null;
    const copy = FATIGUE_COPY[kind];
    return { kind, at: now, title: copy.title, hint: copy.hint };
  }

  private commitCalibration() {
    this.calibratingUntil = 0;
    if (this.calibSamples.length < 8) return;
    this.earBaseline =
      this.calibSamples.reduce((s, x) => s + x, 0) / this.calibSamples.length;
  }
}
