import type { AlertKind } from "./posture";

function formatDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export const COACH_DISCLAIMER =
  "Đây không phải chẩn đoán y khoa — chỉ gợi ý thói quen từ số liệu phiên.";

export const COACH_PROMPTS = [
  "Vì sao tôi bị cảnh báo?",
  "Tôi có đang mệt không?",
  "Nên nghỉ thế nào?",
  "Tư thế cổ và vai ra sao?",
] as const;

export const EMPTY_ALERT_COUNTS: Record<AlertKind, number> = {
  head: 0,
  shoulder: 0,
  sit: 0,
  eyes: 0,
  yawn: 0,
  fatigue: 0,
};

const KIND_LABEL: Record<AlertKind, string> = {
  head: "cổ/đầu",
  shoulder: "vai",
  sit: "ngồi lâu",
  eyes: "mắt nhắm",
  yawn: "ngáp",
  fatigue: "điểm mệt",
};

export type CoachStats = {
  running: boolean;
  bodyPresent: boolean;
  facePresent: boolean;
  faceReady: boolean;
  calibrated: boolean;
  sittingMs: number;
  sitLimitMs: number;
  neckAngle: number;
  shoulderTilt: number;
  headHoldMs: number;
  shoulderHoldMs: number;
  perclos: number;
  yawns10min: number;
  nods2min: number;
  fatigueScore: number;
  alertCounts: Record<AlertKind, number>;
};

export const EMPTY_COACH_STATS: CoachStats = {
  running: false,
  bodyPresent: false,
  facePresent: false,
  faceReady: false,
  calibrated: false,
  sittingMs: 0,
  sitLimitMs: 60_000,
  neckAngle: 0,
  shoulderTilt: 0,
  headHoldMs: 0,
  shoulderHoldMs: 0,
  perclos: 0,
  yawns10min: 0,
  nods2min: 0,
  fatigueScore: 0,
  alertCounts: { ...EMPTY_ALERT_COUNTS },
};

export type CoachInsight = {
  headline: string;
  reasons: string[];
  actions: string[];
  wellness: number;
  disclaimer: string;
};

export type CoachMessage = {
  role: "user" | "coach";
  text: string;
};

export function totalAlerts(counts: Record<AlertKind, number>) {
  return (
    counts.head +
    counts.shoulder +
    counts.sit +
    counts.eyes +
    counts.yawn +
    counts.fatigue
  );
}

export function formatAlertCounts(counts: Record<AlertKind, number>) {
  const parts = (Object.keys(KIND_LABEL) as AlertKind[])
    .filter((k) => counts[k] > 0)
    .map((k) => `${KIND_LABEL[k]} ${counts[k]}`);
  return parts.length ? parts.join(", ") : "chưa có cảnh báo";
}

export function wellnessScore(stats: CoachStats) {
  const sitN =
    stats.sitLimitMs > 0
      ? Math.min(1, stats.sittingMs / stats.sitLimitMs)
      : 0;
  const fatigueN = Math.min(1, stats.fatigueScore / 100);
  const alertN = Math.min(1, totalAlerts(stats.alertCounts) / 8);
  const neckN = Math.min(1, Math.max(0, (stats.neckAngle - 12) / 30));
  return Math.round(
    100 * (1 - 0.25 * sitN - 0.35 * fatigueN - 0.25 * alertN - 0.15 * neckN),
  );
}

export function coachFacts(stats: CoachStats) {
  const facts = [
    `ngồi liên tục ${formatDuration(stats.sittingMs)} / ngưỡng ${formatDuration(stats.sitLimitMs)}`,
    `điểm mệt ${stats.fatigueScore}/100`,
    `góc cổ ${Math.round(stats.neckAngle)}°`,
    `vai lệch ${Math.round(stats.shoulderTilt * 100)}%`,
    `cảnh báo phiên: ${formatAlertCounts(stats.alertCounts)}`,
  ];
  if (stats.faceReady) {
    facts.splice(
      2,
      0,
      `PERCLOS ${Math.round(stats.perclos * 100)}% (60s)`,
      `ngáp ${stats.yawns10min} lần / 10 phút`,
      `gật gù ${stats.nods2min} lần / 2 phút`,
    );
  } else {
    facts.splice(2, 0, "chưa có số liệu mặt");
  }
  return facts;
}

export function buildCoachInsight(stats: CoachStats): CoachInsight {
  const wellness = wellnessScore(stats);
  const reasons: string[] = [];
  const actions: string[] = [];

  if (!stats.running && totalAlerts(stats.alertCounts) === 0 && stats.sittingMs === 0) {
    return {
      headline: "Bật camera để Coach đọc số liệu phiên.",
      reasons: [
        "Coach không xem video. Chỉ dùng số: ngồi, PERCLOS, ngáp, gật gù, góc cổ, cảnh báo.",
      ],
      actions: ["Bật webcam, hiệu chỉnh khi ngồi thẳng, mắt mở."],
      wellness,
      disclaimer: COACH_DISCLAIMER,
    };
  }

  if (stats.running && !stats.bodyPresent) {
    return {
      headline: "Không thấy người trong khung hình.",
      reasons: coachFacts(stats).slice(0, 4),
      actions: ["Ngồi vào khung, để vai và mặt hiện rõ."],
      wellness,
      disclaimer: COACH_DISCLAIMER,
    };
  }

  if (stats.sittingMs >= stats.sitLimitMs) {
    reasons.push(
      `Ngồi liên tục ${formatDuration(stats.sittingMs)}, đã quá ngưỡng ${formatDuration(stats.sitLimitMs)}.`,
    );
    actions.push("Đứng dậy đi lại 1–2 phút rồi bấm “Tôi đã nghỉ”.");
  } else if (stats.sittingMs >= stats.sitLimitMs * 0.7) {
    reasons.push(
      `Ngồi ${formatDuration(stats.sittingMs)} — gần ngưỡng ${formatDuration(stats.sitLimitMs)}.`,
    );
  }

  if (stats.fatigueScore >= 55) {
    reasons.push(`Điểm mệt ${stats.fatigueScore}/100 đang cao.`);
  } else if (stats.fatigueScore >= 40) {
    reasons.push(`Điểm mệt ${stats.fatigueScore}/100, bắt đầu tăng.`);
  }

  if (stats.faceReady && stats.perclos >= 0.08) {
    reasons.push(
      `PERCLOS ${Math.round(stats.perclos * 100)}% trong 60 giây (mắt nhắm nhiều hơn bình thường).`,
    );
    actions.push("Nhìn xa ~20 giây hoặc chớp mắt chủ động, uống nước.");
  }
  if (stats.yawns10min >= 1) {
    reasons.push(`${stats.yawns10min} lần ngáp trong 10 phút.`);
    actions.push("Tạm dừng 1–2 phút, hít sâu vài hơi.");
  }
  if (stats.nods2min >= 1) {
    reasons.push(`${stats.nods2min} lần gật gù trong 2 phút (cúi rồi ngẩng, khác cúi gõ phím).`);
  }

  if (stats.alertCounts.head >= 1) {
    reasons.push(`Cổ/đầu đã cảnh báo ${stats.alertCounts.head} lần.`);
    actions.push("Nâng màn hình ngang mắt, kéo cằm nhẹ ra sau.");
  }
  if (stats.alertCounts.shoulder >= 1) {
    reasons.push(`Vai lệch đã cảnh báo ${stats.alertCounts.shoulder} lần.`);
    actions.push("Thả hai vai, ngồi cân đều trên ghế.");
  }
  if (stats.alertCounts.eyes >= 1) {
    reasons.push(`Mắt nhắm giữ lâu: ${stats.alertCounts.eyes} lần.`);
  }

  if (!stats.calibrated) {
    actions.push("Nên hiệu chỉnh khi ngồi thẳng, mắt mở.");
  }

  if (!reasons.length) {
    reasons.push(
      `Chưa có tín hiệu vượt ngưỡng. ${coachFacts(stats).slice(0, 3).join(" · ")}`,
    );
    actions.push("Giữ nhịp nghỉ ngắn; Coach sẽ giải thích khi có cảnh báo.");
  }

  let headline = "Phiên đang ổn — giữ nhịp nghỉ.";
  if (stats.fatigueScore >= 55 || stats.alertCounts.fatigue >= 1) {
    headline = `Điểm mệt ${stats.fatigueScore}/100 — nên đứng dậy ngay.`;
  } else if (stats.sittingMs >= stats.sitLimitMs) {
    headline = "Ngồi liên tục quá ngưỡng.";
  } else if (stats.alertCounts.head + stats.alertCounts.shoulder >= 2) {
    headline = "Tư thế cổ/vai bị cảnh báo nhiều lần.";
  } else if (stats.yawns10min >= 2 || stats.perclos >= 0.12) {
    headline = `Dấu hiệu mệt trên số liệu: PERCLOS ${Math.round(stats.perclos * 100)}%, ngáp ${stats.yawns10min} lần.`;
  } else if (reasons.length && wellness < 75) {
    headline = "Có vài tín hiệu cần chỉnh trong phiên này.";
  }

  const uniqueActions = [...new Set(actions)].slice(0, 3);
  return {
    headline,
    reasons: reasons.slice(0, 5),
    actions: uniqueActions,
    wellness,
    disclaimer: COACH_DISCLAIMER,
  };
}

export function insightToProse(insight: CoachInsight) {
  return [
    insight.headline,
    insight.reasons.length ? `Số liệu: ${insight.reasons.join(" ")}` : "",
    insight.actions.length ? `Gợi ý: ${insight.actions.join(" ")}` : "",
    insight.disclaimer,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function fold(q: string) {
  return q
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d")
    .trim();
}

export function answerCoach(question: string, stats: CoachStats) {
  const q = fold(question);
  const insight = buildCoachInsight(stats);
  const facts = coachFacts(stats).join("; ");
  const numbers = `Số liệu hiện tại: ${facts}.`;

  if (
    /chan doan|benh|bac si|y khoa|sleep apnea|roi loan/.test(q) ||
    /toi co bi/.test(q)
  ) {
    return [
      "WorkWell không chẩn đoán bệnh và không thay thế bác sĩ.",
      numbers,
      "Nếu khó chịu kéo dài, hãy nghỉ ngơi và hỏi chuyên gia y tế. Coach chỉ giải thích thói quen ngồi/mắt trên máy này.",
    ].join("\n\n");
  }

  if (/vi sao|canh bao|nhieu/.test(q)) {
    const n = totalAlerts(stats.alertCounts);
    const lead =
      n === 0
        ? "Phiên này chưa có cảnh báo. Các thanh bên phải là tín hiệu đang đo, chưa vượt ngưỡng giữ."
        : `Bạn có ${n} cảnh báo trong phiên: ${formatAlertCounts(stats.alertCounts)}.`;
    return [lead, numbers, insight.actions[0] ?? "", COACH_DISCLAIMER]
      .filter(Boolean)
      .join("\n\n");
  }

  if (/met|ngap|perclos|mat nham|buon ngu|gat/.test(q)) {
    const lead = stats.faceReady
      ? `Điểm mệt ${stats.fatigueScore}/100 · PERCLOS ${Math.round(stats.perclos * 100)}% · ngáp ${stats.yawns10min}/10 phút · gật ${stats.nods2min}/2 phút.`
      : "Chưa có số liệu mặt (model mặt chưa sẵn sàng), nên chưa kết luận mệt từ mắt/miệng.";
    return [
      lead,
      "Mệt ở đây là tổ hợp số, không phải chứng ngủ. Cúi gõ phím không tính là gật gù.",
      insight.actions[0] ?? "Đứng dậy 2 phút, nhìn xa 20 giây.",
      COACH_DISCLAIMER,
    ].join("\n\n");
  }

  if (/ngoi|nghi|dung day|break/.test(q)) {
    return [
      `Bạn đã ngồi liên tục ${formatDuration(stats.sittingMs)} (ngưỡng ${formatDuration(stats.sitLimitMs)}).`,
      numbers,
      stats.sittingMs >= stats.sitLimitMs * 0.7
        ? "Nên đứng dậy 1–2 phút, xoay vai, rồi bấm “Tôi đã nghỉ” để reset đồng hồ ngồi."
        : "Chưa tới ngưỡng. Vẫn nên nghỉ ngắn mỗi 30–45 phút.",
      COACH_DISCLAIMER,
    ].join("\n\n");
  }

  if (/co|dau|cui|vai|tu the|dang ngoi/.test(q)) {
    return [
      `Góc cổ ${Math.round(stats.neckAngle)}°, vai lệch ${Math.round(stats.shoulderTilt * 100)}%. Cảnh báo cổ ${stats.alertCounts.head}, vai ${stats.alertCounts.shoulder}.`,
      "Cúi giữ ~7 giây mới báo tư thế. Gật gù là cúi rồi ngẩng trong ~2 giây.",
      stats.alertCounts.head || stats.neckAngle > 28
        ? "Nâng màn hình, tai thẳng hàng vai."
        : "Tư thế cổ/vai đang trong ngưỡng.",
      COACH_DISCLAIMER,
    ].join("\n\n");
  }

  return insightToProse(insight);
}
