"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  COACH_PROMPTS,
  answerCoach,
  buildCoachInsight,
  type CoachMessage,
  type CoachStats,
} from "@/lib/coach";

export function CoachPanel({
  stats,
  sessionKey,
}: {
  stats: CoachStats;
  sessionKey: number;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<CoachMessage[]>(() => [
    {
      role: "coach",
      text: "Xin chào — tôi là Coach. Tôi chỉ đọc số phiên (ngồi, PERCLOS, ngáp, gật, cổ/vai, cảnh báo). Không xem video, không chẩn đoán y khoa.",
    },
  ]);

  const insight = useMemo(() => buildCoachInsight(stats), [stats]);
  const firstKey = useRef(true);

  useEffect(() => {
    if (firstKey.current) {
      firstKey.current = false;
      return;
    }
    setMessages([
      {
        role: "coach",
        text: "Phiên mới. Hỏi “vì sao bị cảnh báo?” khi có số liệu — tôi không xem camera.",
      },
    ]);
    setInput("");
  }, [sessionKey]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  const ask = (question: string) => {
    const q = question.trim();
    if (!q) return;
    const reply = answerCoach(q, stats);
    setMessages((prev) => [
      ...prev,
      { role: "user", text: q },
      { role: "coach", text: reply },
    ]);
    setInput("");
  };

  return (
    <section className="coach" aria-label="AI Coach">
      <div className="coach-head">
        <div>
          <h2>AI Coach</h2>
          <p className="muted">
            Chỉ đọc số đã tổng hợp trên máy · không gửi video · không chẩn đoán y khoa
          </p>
        </div>
        <div className={`wellness ${insight.wellness < 55 ? "low" : ""}`}>
          <span>Wellness</span>
          <strong>{insight.wellness}</strong>
        </div>
      </div>

      <div className="coach-grid">
        <div className="coach-insight">
          <p className="coach-headline">{insight.headline}</p>
          <div className="bar">
            <i style={{ width: `${insight.wellness}%` }} />
          </div>
          <ul>
            {insight.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <p className="coach-actions">{insight.actions.join(" ")}</p>
          <p className="muted">{insight.disclaimer}</p>
        </div>

        <div className="coach-chat">
          <div className="coach-msgs" ref={listRef}>
            {messages.map((m, i) => (
              <p key={`${m.role}-${i}`} className={`coach-msg ${m.role}`}>
                {m.text}
              </p>
            ))}
          </div>
          <div className="coach-chips">
            {COACH_PROMPTS.map((p) => (
              <button key={p} type="button" className="chip" onClick={() => ask(p)}>
                {p}
              </button>
            ))}
          </div>
          <form
            className="coach-form"
            onSubmit={(e) => {
              e.preventDefault();
              ask(input);
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Hỏi vì sao bị cảnh báo, có mệt không, nên nghỉ thế nào…"
              aria-label="Câu hỏi cho Coach"
            />
            <button className="btn primary" type="submit">
              Hỏi
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}
