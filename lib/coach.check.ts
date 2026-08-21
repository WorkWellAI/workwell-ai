import {
  EMPTY_ALERT_COUNTS,
  EMPTY_COACH_STATS,
  answerCoach,
  buildCoachInsight,
  coachFacts,
  wellnessScore,
  type CoachStats,
} from "./coach.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const idle = buildCoachInsight(EMPTY_COACH_STATS);
assert(idle.headline.includes("Bật camera"), idle.headline);
assert(idle.disclaimer.includes("không phải chẩn đoán"), idle.disclaimer);

const tired: CoachStats = {
  ...EMPTY_COACH_STATS,
  running: true,
  bodyPresent: true,
  faceReady: true,
  facePresent: true,
  sittingMs: 90_000,
  sitLimitMs: 60_000,
  neckAngle: 18,
  fatigueScore: 62,
  perclos: 0.18,
  yawns10min: 4,
  nods2min: 2,
  alertCounts: { ...EMPTY_ALERT_COUNTS, yawn: 2, fatigue: 1, sit: 1 },
};

const insight = buildCoachInsight(tired);
assert(insight.headline.includes("62"), insight.headline);
assert(
  insight.reasons.some((r) => r.includes("PERCLOS") && r.includes("18")),
  insight.reasons.join(" | "),
);
assert(
  insight.reasons.some((r) => r.includes("4 lần ngáp")),
  insight.reasons.join(" | "),
);
assert(insight.wellness < 55, `wellness should drop, got ${insight.wellness}`);

const why = answerCoach("Vì sao tôi bị cảnh báo nhiều?", tired);
assert(why.includes("ngáp 2"), why);
assert(why.includes("PERCLOS 18%"), why);
assert(/không phải chẩn đoán/i.test(why), why);

const med = answerCoach("Tôi có bị bệnh gì không?", tired);
assert(med.includes("không chẩn đoán"), med);
assert(med.includes("4 lần"), med);

const rest = answerCoach("Nên nghỉ thế nào?", tired);
assert(rest.includes("1:30") || rest.includes("ngồi liên tục"), rest);

const postureQ = answerCoach("Tư thế cổ và vai ra sao?", {
  ...tired,
  neckAngle: 34,
  shoulderTilt: 0.2,
  alertCounts: { ...EMPTY_ALERT_COUNTS, head: 3 },
});
assert(postureQ.includes("34"), postureQ);
assert(postureQ.includes("cổ 3"), postureQ);

const good: CoachStats = {
  ...EMPTY_COACH_STATS,
  running: true,
  bodyPresent: true,
  faceReady: true,
  calibrated: true,
  sittingMs: 20_000,
  sitLimitMs: 45 * 60_000,
  neckAngle: 10,
  fatigueScore: 8,
};
assert(wellnessScore(good) >= 85, `good wellness ${wellnessScore(good)}`);
assert(coachFacts(tired).some((f) => f.includes("ngáp 4")));

const missing = buildCoachInsight({
  ...EMPTY_COACH_STATS,
  running: true,
  bodyPresent: false,
});
assert(missing.headline.includes("Không thấy người"), missing.headline);

console.log("coach checks passed");
