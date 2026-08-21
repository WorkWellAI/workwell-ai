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
export const SCORE_HOLD_MS = 8_000;
export const PERCLOS_WINDOW_MS = 60_000;

export type FatigueKind = "eyes" | "yawn" | "fatigue";

export type FaceMetrics = {
  present: boolean;
  ear: number;
  mar: number;
  blink: number;
  jawOpen: number;
};

export type FatigueContext = {
  bodyPresent: boolean;
  sittingMs: number;
  sitLimitMs: number;
  neckAngle: number;
};

export const EMPTY_FATIGUE_CTX: FatigueContext = {
  bodyPresent: false,
  sittingMs: 0,
  sitLimitMs: 60_000,
  neckAngle: 0,
};

export type FatigueSnapshot = {
  metrics: FaceMetrics;
  eyesHoldMs: number;
  yawnHoldMs: number;
  scoreHoldMs: number;
  perclos: number;
  yawns10min: number;
  nods2min: number;
  score: number;
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
  fatigue: {
    title: "Điểm mệt mỏi đang cao",
    hint: "Đứng dậy, đi lại 2 phút và nhìn xa. Không phải chẩn đoán y khoa.",
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

export function fatigueScoreParts(input: {
  perclos: number;
  yawns10min: number;
  nods2min: number;
  sittingMs: number;
  sitLimitMs: number;
}) {
  const perclosN = Math.min(1, input.perclos / 0.15);
  const yawnN = Math.min(1, input.yawns10min / 3);
  const nodN = Math.min(1, input.nods2min / 3);
  const sitN =
    input.sitLimitMs <= 0
      ? 0
      : Math.min(1, input.sittingMs / input.sitLimitMs);
  const score = Math.round(
    100 * (0.45 * perclosN + 0.25 * yawnN + 0.2 * nodN + 0.1 * sitN),
  );
  return { perclosN, yawnN, nodN, sitN, score };
}

export class FatigueSession {
  eyesHoldMsNeeded = EYES_HOLD_MS;
  yawnHoldMsNeeded = YAWN_HOLD_MS;
  scoreHoldMsNeeded = SCORE_HOLD_MS;
  cooldownMs = 40_000;
  scoreCooldownMs = 90_000;
  perclosWindowMs = PERCLOS_WINDOW_MS;
  minPerclosSamples = 150;
  sampleGapMs = 100;
  sitLimitMs = 60_000;
  scoreAlertAt = 55;

  private earBaseline: number | null = null;
  private calibSamples: number[] = [];
  private calibratingUntil = 0;
  private eyesSince: number | null = null;
  private yawnSince: number | null = null;
  private scoreSince: number | null = null;
  private lastAlertAt: Record<FatigueKind, number> = {
    eyes: 0,
    yawn: 0,
    fatigue: 0,
  };

  private lastSampleAt = 0;
  private closedSamples: Array<{ t: number; closed: boolean }> = [];
  private yawnTimes: number[] = [];
  private yawnCounted = false;
  private nodTimes: number[] = [];
  private nodPhase: "idle" | "dropped" = "idle";
  private dropStartedAt: number | null = null;
  private lastNodAt = 0;

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

  step(
    metrics: FaceMetrics,
    ctx: FatigueContext = EMPTY_FATIGUE_CTX,
    now = Date.now(),
  ): FatigueSnapshot {
    if (this.isCalibrating && metrics.present && metrics.ear > 0.12) {
      this.calibSamples.push(metrics.ear);
      if (now >= this.calibratingUntil) this.commitCalibration();
    } else if (this.isCalibrating && now >= this.calibratingUntil) {
      this.commitCalibration();
    }

    let eyesHoldMs = 0;
    let yawnHoldMs = 0;
    let scoreHoldMs = 0;
    let alert: AlertEvent | null = null;

    if (metrics.present) {
      this.recordPerclos(this.isEyesClosed(metrics), now);
    }
    if (ctx.bodyPresent) this.updateNod(ctx.neckAngle, now);

    if (!metrics.present) {
      this.eyesSince = null;
      this.yawnSince = null;
      this.yawnCounted = false;
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
        this.yawnCounted = false;
      }

      if (yawnHoldMs >= this.yawnHoldMsNeeded && !this.yawnCounted) {
        this.yawnTimes.push(now);
        this.yawnCounted = true;
      }
    }

    const perclos = this.computePerclos();
    const yawns10min = this.countSince(this.yawnTimes, now - 10 * 60_000);
    const nods2min = this.countSince(this.nodTimes, now - 2 * 60_000);
    const { score } = fatigueScoreParts({
      perclos,
      yawns10min,
      nods2min,
      sittingMs: ctx.sittingMs,
      sitLimitMs: ctx.sitLimitMs || this.sitLimitMs,
    });

    if (score >= this.scoreAlertAt) {
      if (this.scoreSince === null) this.scoreSince = now;
      scoreHoldMs = now - this.scoreSince;
    } else {
      this.scoreSince = null;
    }

    if (eyesHoldMs >= this.eyesHoldMsNeeded) {
      alert = this.tryAlert("eyes", now);
    }
    if (!alert && yawnHoldMs >= this.yawnHoldMsNeeded) {
      alert = this.tryAlert("yawn", now);
    }
    if (!alert && scoreHoldMs >= this.scoreHoldMsNeeded) {
      alert = this.tryAlert("fatigue", now, {
        perclos,
        yawns10min,
        nods2min,
        score,
      });
    }

    return {
      metrics,
      eyesHoldMs,
      yawnHoldMs,
      scoreHoldMs,
      perclos,
      yawns10min,
      nods2min,
      score,
      calibrated: this.calibrated,
      alert,
    };
  }

  private recordPerclos(closed: boolean, now: number) {
    if (now - this.lastSampleAt < this.sampleGapMs) return;
    this.lastSampleAt = now;
    this.closedSamples.push({ t: now, closed });
    const cutoff = now - this.perclosWindowMs;
    while (this.closedSamples[0] && this.closedSamples[0].t < cutoff) {
      this.closedSamples.shift();
    }
  }

  private computePerclos() {
    if (this.closedSamples.length < this.minPerclosSamples) return 0;
    let closed = 0;
    for (const s of this.closedSamples) if (s.closed) closed += 1;
    return closed / this.closedSamples.length;
  }

  private updateNod(angle: number, now: number) {
    const DROP = 26;
    const RECOVER = 20;
    const MIN_MS = 180;
    const MAX_MS = 2_200;

    if (this.nodPhase === "idle") {
      if (angle >= DROP) {
        this.nodPhase = "dropped";
        this.dropStartedAt = now;
      }
      return;
    }

    const dur = now - (this.dropStartedAt ?? now);
    if (angle <= RECOVER) {
      if (
        dur >= MIN_MS &&
        dur <= MAX_MS &&
        now - this.lastNodAt > 500
      ) {
        this.nodTimes.push(now);
        this.lastNodAt = now;
      }
      this.nodPhase = "idle";
      this.dropStartedAt = null;
    } else if (dur > MAX_MS) {
      this.nodPhase = "idle";
      this.dropStartedAt = null;
    }

    const cutoff = now - 2 * 60_000;
    while (this.nodTimes[0] && this.nodTimes[0] < cutoff) this.nodTimes.shift();
  }

  private countSince(times: number[], cutoff: number) {
    while (times[0] && times[0] < cutoff) times.shift();
    return times.length;
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

  private tryAlert(
    kind: FatigueKind,
    now: number,
    extra?: {
      perclos: number;
      yawns10min: number;
      nods2min: number;
      score: number;
    },
  ): AlertEvent | null {
    const wait = kind === "fatigue" ? this.scoreCooldownMs : this.cooldownMs;
    if (now - this.lastAlertAt[kind] < wait) return null;
    this.lastAlertAt[kind] = now;
    if (kind === "eyes") this.eyesSince = null;
    if (kind === "yawn") this.yawnSince = null;
    if (kind === "fatigue") this.scoreSince = null;
    if (kind === "fatigue" && extra) {
      const perclosPct = Math.round(extra.perclos * 100);
      return {
        kind,
        at: now,
        title: `Điểm mệt mỏi ${extra.score}/100`,
        hint: `PERCLOS ${perclosPct}%, ngáp ${extra.yawns10min} lần/10 phút, gật ${extra.nods2min} lần/2 phút. Đứng dậy nghỉ ngắn.`,
      };
    }
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
