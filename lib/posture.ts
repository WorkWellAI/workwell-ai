export type Landmark = {
  x: number;
  y: number;
  z: number;
  visibility?: number;
};

export const LM = {
  NOSE: 0,
  LEFT_EYE: 2,
  RIGHT_EYE: 5,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
} as const;

export type PostureMetrics = {
  present: boolean;
  headDrop: number;
  neckAngle: number;
  shoulderTilt: number;
  torsoLean: number;
  hipsVisible: boolean;
};

export type AlertKind = "head" | "shoulder" | "sit" | "eyes" | "yawn";

export type AlertEvent = {
  kind: AlertKind;
  at: number;
  title: string;
  hint: string;
};

export type SessionSnapshot = {
  metrics: PostureMetrics;
  sittingMs: number;
  headHoldMs: number;
  shoulderHoldMs: number;
  calibrated: boolean;
  alert: AlertEvent | null;
};

const VIS_MIN = 0.45;

function vis(lm: Landmark | undefined) {
  if (!lm) return 0;
  return lm.visibility ?? 1;
}

function midpoint(a: Landmark, b: Landmark): Landmark {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
    visibility: Math.min(vis(a), vis(b)),
  };
}

function dist(a: Landmark, b: Landmark) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Angle in degrees between (from → to) and image-up (0, -1). */
function angleFromVertical(from: Landmark, to: Landmark) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return 0;
  const cos = Math.max(-1, Math.min(1, -dy / len));
  return (Math.acos(cos) * 180) / Math.PI;
}

export function analyzePosture(landmarks: Landmark[]): PostureMetrics {
  const nose = landmarks[LM.NOSE];
  const lEar = landmarks[LM.LEFT_EAR];
  const rEar = landmarks[LM.RIGHT_EAR];
  const lSh = landmarks[LM.LEFT_SHOULDER];
  const rSh = landmarks[LM.RIGHT_SHOULDER];
  const lHip = landmarks[LM.LEFT_HIP];
  const rHip = landmarks[LM.RIGHT_HIP];

  const present = vis(nose) > VIS_MIN && vis(lSh) > VIS_MIN && vis(rSh) > VIS_MIN;
  if (!present || !nose || !lSh || !rSh) {
    return {
      present: false,
      headDrop: 0,
      neckAngle: 0,
      shoulderTilt: 0,
      torsoLean: 0,
      hipsVisible: false,
    };
  }

  const midSh = midpoint(lSh, rSh);
  const shoulderWidth = Math.max(dist(lSh, rSh), 0.08);
  const headDrop = (nose.y - midSh.y) / shoulderWidth;

  const ear =
    vis(lEar) >= vis(rEar) ? lEar : rEar;
  const neckAnchor = ear && vis(ear) > 0.3 ? ear : nose;
  const neckAngle = angleFromVertical(midSh, neckAnchor);

  const shoulderTilt = Math.abs(lSh.y - rSh.y) / shoulderWidth;

  const hipsVisible = vis(lHip) > 0.5 && vis(rHip) > 0.5;
  let torsoLean = 0;
  if (hipsVisible && lHip && rHip) {
    const midHip = midpoint(lHip, rHip);
    torsoLean = angleFromVertical(midHip, midSh);
  }

  return { present, headDrop, neckAngle, shoulderTilt, torsoLean, hipsVisible };
}

export const COPY: Record<
  Extract<AlertKind, "head" | "shoulder" | "sit">,
  { title: string; hint: string }
> = {
  head: {
    title: "Đầu đang cúi về phía trước",
    hint: "Nâng màn hình lên, kéo cằm nhẹ ra sau, tai thẳng hàng với vai.",
  },
  shoulder: {
    title: "Vai đang lệch, không cân",
    hint: "Thả hai vai xuống, ngồi cân đều trên ghế, tránh tựa một bên.",
  },
  sit: {
    title: "Bạn đã ngồi liên tục quá lâu",
    hint: "Đứng dậy 1–2 phút, đi lại hoặc xoay vai trước khi ngồi tiếp.",
  },
};

type Baseline = { headDrop: number; shoulderTilt: number };

export class PostureSession {
  sitLimitMs = 60_000;
  holdMs = 7_000;
  cooldownMs = 75_000;
  absentResetMs = 4_000;

  private baseline: Baseline | null = null;
  private calibSamples: Baseline[] = [];
  private calibratingUntil = 0;

  private headBadSince: number | null = null;
  private shoulderBadSince: number | null = null;
  private presentSince: number | null = null;
  private lastPresentAt: number | null = null;
  private lastAlertAt: Record<Extract<AlertKind, "head" | "shoulder" | "sit">, number> = {
    head: 0,
    shoulder: 0,
    sit: 0,
  };

  get calibrated() {
    return this.baseline !== null;
  }

  startCalibration(now = Date.now(), durationMs = 3_000) {
    this.calibSamples = [];
    this.calibratingUntil = now + durationMs;
    this.baseline = null;
  }

  get isCalibrating() {
    return Date.now() < this.calibratingUntil;
  }

  step(metrics: PostureMetrics, now = Date.now()): SessionSnapshot {
    if (this.isCalibrating && metrics.present) {
      this.calibSamples.push({
        headDrop: metrics.headDrop,
        shoulderTilt: metrics.shoulderTilt,
      });
      if (now >= this.calibratingUntil) this.commitCalibration();
    } else if (this.isCalibrating && now >= this.calibratingUntil) {
      this.commitCalibration();
    }

    let sittingMs = 0;
    let headHoldMs = 0;
    let shoulderHoldMs = 0;
    let alert: AlertEvent | null = null;

    if (!metrics.present) {
      if (
        this.lastPresentAt !== null &&
        now - this.lastPresentAt > this.absentResetMs
      ) {
        this.presentSince = null;
      }
      this.headBadSince = null;
      this.shoulderBadSince = null;
    } else {
      this.lastPresentAt = now;
      if (this.presentSince === null) this.presentSince = now;
      sittingMs = now - this.presentSince;

      const headBad = this.isHeadBad(metrics);
      const shoulderBad = this.isShoulderBad(metrics);

      if (headBad) {
        if (this.headBadSince === null) this.headBadSince = now;
        headHoldMs = now - this.headBadSince;
      } else {
        this.headBadSince = null;
      }

      if (shoulderBad) {
        if (this.shoulderBadSince === null) this.shoulderBadSince = now;
        shoulderHoldMs = now - this.shoulderBadSince;
      } else {
        this.shoulderBadSince = null;
      }

      if (headHoldMs >= this.holdMs) {
        alert = this.tryAlert("head", now);
      }
      if (!alert && shoulderHoldMs >= this.holdMs) {
        alert = this.tryAlert("shoulder", now);
      }
      if (!alert && sittingMs >= this.sitLimitMs) {
        alert = this.tryAlert("sit", now);
      }
    }

    return {
      metrics,
      sittingMs,
      headHoldMs,
      shoulderHoldMs,
      calibrated: this.calibrated,
      alert,
    };
  }

  markBreak(now = Date.now()) {
    this.presentSince = now;
    this.lastAlertAt.sit = now;
  }

  private isHeadBad(m: PostureMetrics) {
    if (this.baseline) {
      return m.headDrop > this.baseline.headDrop + 0.32 || m.neckAngle > 32;
    }
    return m.headDrop > -0.38 || m.neckAngle > 30;
  }

  private isShoulderBad(m: PostureMetrics) {
    if (this.baseline) {
      return m.shoulderTilt > Math.max(this.baseline.shoulderTilt + 0.12, 0.14);
    }
    return m.shoulderTilt > 0.16;
  }

  private tryAlert(
    kind: Extract<AlertKind, "head" | "shoulder" | "sit">,
    now: number,
  ): AlertEvent | null {
    if (now - this.lastAlertAt[kind] < this.cooldownMs) return null;
    this.lastAlertAt[kind] = now;
    if (kind === "head") this.headBadSince = null;
    if (kind === "shoulder") this.shoulderBadSince = null;
    if (kind === "sit") this.presentSince = now;
    const copy = COPY[kind];
    return { kind, at: now, title: copy.title, hint: copy.hint };
  }

  private commitCalibration() {
    this.calibratingUntil = 0;
    if (this.calibSamples.length < 8) return;
    const n = this.calibSamples.length;
    this.baseline = {
      headDrop:
        this.calibSamples.reduce((s, x) => s + x.headDrop, 0) / n,
      shoulderTilt:
        this.calibSamples.reduce((s, x) => s + x.shoulderTilt, 0) / n,
    };
  }
}

export function formatDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export const POSE_LINES: Array<[number, number]> = [
  [LM.LEFT_SHOULDER, LM.RIGHT_SHOULDER],
  [LM.LEFT_SHOULDER, LM.LEFT_ELBOW],
  [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW],
  [LM.LEFT_SHOULDER, LM.LEFT_HIP],
  [LM.RIGHT_SHOULDER, LM.RIGHT_HIP],
  [LM.LEFT_HIP, LM.RIGHT_HIP],
  [LM.NOSE, LM.LEFT_EAR],
  [LM.NOSE, LM.RIGHT_EAR],
  [LM.LEFT_EAR, LM.LEFT_SHOULDER],
  [LM.RIGHT_EAR, LM.RIGHT_SHOULDER],
];
