"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  analyzePosture,
  COPY,
  formatDuration,
  POSE_LINES,
  PostureSession,
  type AlertEvent,
  type Landmark,
  type SessionSnapshot,
} from "@/lib/posture";
import { createPoseLandmarker } from "@/lib/pose-landmarker";

type RunState = "idle" | "loading" | "running" | "denied" | "error";

const SIT_PRESETS = [
  { label: "1 phút (demo)", ms: 60_000 },
  { label: "5 phút", ms: 5 * 60_000 },
  { label: "45 phút", ms: 45 * 60_000 },
];

function drawPose(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  color: string,
) {
  const { width, height } = ctx.canvas;
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = "round";

  for (const [a, b] of POSE_LINES) {
    const p = landmarks[a];
    const q = landmarks[b];
    if (!p || !q) continue;
    if ((p.visibility ?? 1) < 0.4 || (q.visibility ?? 1) < 0.4) continue;
    ctx.beginPath();
    ctx.moveTo(p.x * width, p.y * height);
    ctx.lineTo(q.x * width, q.y * height);
    ctx.stroke();
  }

  for (const i of [0, 7, 8, 11, 12, 23, 24]) {
    const p = landmarks[i];
    if (!p || (p.visibility ?? 1) < 0.4) continue;
    ctx.beginPath();
    ctx.arc(p.x * width, p.y * height, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

const HOLD_MS = 7_000;

function statusColor(snapshot: SessionSnapshot | null, holdMs: number) {
  if (!snapshot?.metrics.present) return "#7d8b84";
  if (snapshot.alert) return "#ff6b4a";
  if (snapshot.headHoldMs > holdMs * 0.4 || snapshot.shoulderHoldMs > holdMs * 0.4) {
    return "#f0b429";
  }
  return "#b7e38a";
}

export function PostureMonitor() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef(new PostureSession());
  const rafRef = useRef(0);
  const lastTsRef = useRef(-1);
  const lastUiRef = useRef(0);

  const [runState, setRunState] = useState<RunState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const [banner, setBanner] = useState<AlertEvent | null>(null);
  const [sitPreset, setSitPreset] = useState(SIT_PRESETS[0].ms);
  const [calibrating, setCalibrating] = useState(false);

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    lastTsRef.current = -1;
    setRunState("idle");
    setSnapshot(null);
    setCalibrating(false);
  }, []);

  const startCamera = useCallback(async () => {
    setErrorMsg("");
    setRunState("loading");
    sessionRef.current = new PostureSession();
    sessionRef.current.sitLimitMs = sitPreset;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      const video = videoRef.current;
      if (!video) throw new Error("Không tìm thấy thẻ video.");
      video.srcObject = stream;
      await video.play();

      const landmarker = await createPoseLandmarker();
      setRunState("running");

      const loop = () => {
        rafRef.current = requestAnimationFrame(loop);
        const v = videoRef.current;
        const canvas = canvasRef.current;
        if (!v || !canvas || v.readyState < 2) return;

        if (canvas.width !== v.videoWidth || canvas.height !== v.videoHeight) {
          canvas.width = v.videoWidth;
          canvas.height = v.videoHeight;
        }

        let ts = performance.now();
        if (ts <= lastTsRef.current) ts = lastTsRef.current + 1;
        lastTsRef.current = ts;

        try {
          const result = landmarker.detectForVideo(v, ts);
          const landmarks = result.landmarks[0] ?? [];
          const metrics = analyzePosture(landmarks);
          const next = sessionRef.current.step(metrics);
          setCalibrating(sessionRef.current.isCalibrating);

          const ctx = canvas.getContext("2d");
          if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            if (landmarks.length) {
              drawPose(ctx, landmarks, statusColor(next, HOLD_MS));
            }
          }

          const now = Date.now();
          if (now - lastUiRef.current > 120) {
            lastUiRef.current = now;
            setSnapshot({ ...next });
          }

          if (next.alert) {
            setBanner(next.alert);
            setAlerts((prev) => [next.alert!, ...prev].slice(0, 8));
          }
        } catch {
          // Skip a dropped frame (timestamp or WASM hiccup).
        }
      };

      rafRef.current = requestAnimationFrame(loop);
    } catch (err) {
      const leaked = videoRef.current?.srcObject as MediaStream | null;
      leaked?.getTracks().forEach((t) => t.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "PermissionDeniedError") {
        setRunState("denied");
        setErrorMsg("Cần quyền camera để theo dõi tư thế. Video chỉ xử lý trên máy này.");
      } else {
        setRunState("error");
        setErrorMsg(
          err instanceof Error ? err.message : "Không khởi động được camera hoặc mô hình pose.",
        );
      }
    }
  }, [sitPreset]);

  useEffect(() => {
    const video = videoRef.current;
    return () => {
      cancelAnimationFrame(rafRef.current);
      const stream = video?.srcObject as MediaStream | null;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  useEffect(() => {
    if (!banner) return;
    const id = window.setTimeout(() => setBanner(null), 8_000);
    return () => window.clearTimeout(id);
  }, [banner]);

  useEffect(() => {
    sessionRef.current.sitLimitMs = sitPreset;
  }, [sitPreset]);

  const present = snapshot?.metrics.present ?? false;
  const headPct = Math.min(100, ((snapshot?.headHoldMs ?? 0) / HOLD_MS) * 100);
  const shoulderPct = Math.min(
    100,
    ((snapshot?.shoulderHoldMs ?? 0) / HOLD_MS) * 100,
  );
  const sitPct = Math.min(100, ((snapshot?.sittingMs ?? 0) / sitPreset) * 100);

  return (
    <div className="monitor">
      {banner && (
        <div className={`toast toast-${banner.kind}`} role="alert">
          <strong>{banner.title}</strong>
          <span>{banner.hint}</span>
        </div>
      )}

      <section className="stage">
        <div className="viewport">
          <video ref={videoRef} playsInline muted autoPlay />
          <canvas ref={canvasRef} />
          {runState !== "running" && (
            <div className="overlay-msg">
              {runState === "idle" && (
                <>
                  <p className="kicker">Camera local · không gửi video</p>
                  <h2>Bật webcam để theo dõi dáng ngồi</h2>
                  <p>
                    MediaPipe Pose chạy ngay trên trình duyệt. Cảnh báo khi cúi
                    đầu, vai lệch, hoặc ngồi quá lâu.
                  </p>
                </>
              )}
              {runState === "loading" && <p>Đang tải mô hình pose…</p>}
              {runState === "denied" && <p>{errorMsg}</p>}
              {runState === "error" && <p>{errorMsg}</p>}
            </div>
          )}
          {runState === "running" && (
            <div className="live-pill">
              <i /> {present ? "Đang theo dõi" : "Không thấy người"}
            </div>
          )}
          {calibrating && (
            <div className="calib-banner">Ngồi thẳng, nhìn màn hình — đang lấy tư thế chuẩn…</div>
          )}
        </div>

        <div className="controls">
          {runState !== "running" ? (
            <button
              className="btn primary"
              onClick={startCamera}
              disabled={runState === "loading"}
            >
              {runState === "loading" ? "Đang tải mô hình…" : "Bật camera"}
            </button>
          ) : (
            <button className="btn" onClick={stopCamera}>
              Tắt camera
            </button>
          )}
          <button
            className="btn"
            disabled={runState !== "running"}
            onClick={() => sessionRef.current.startCalibration()}
          >
            Hiệu chỉnh tư thế chuẩn
          </button>
          <button
            className="btn"
            disabled={runState !== "running"}
            onClick={() => {
              sessionRef.current.markBreak();
              setSnapshot((s) =>
                s ? { ...s, sittingMs: 0 } : s,
              );
            }}
          >
            Tôi đã nghỉ
          </button>
        </div>
      </section>

      <aside className="panel">
        <h2>Tín hiệu tư thế</h2>
        <p className="muted">
          {snapshot?.calibrated
            ? "Đã hiệu chỉnh theo tư thế chuẩn của bạn."
            : "Chưa hiệu chỉnh — dùng ngưỡng mặc định. Nên bấm hiệu chỉnh khi ngồi thẳng."}
        </p>

        <Metric
          label="Cổ & đầu"
          hint={COPY.head.hint}
          value={
            present
              ? `góc cổ ${snapshot!.metrics.neckAngle.toFixed(0)}°`
              : "—"
          }
          pct={headPct}
          warn={headPct > 40}
        />
        <Metric
          label="Cân vai"
          hint={COPY.shoulder.hint}
          value={
            present
              ? `lệch ${(snapshot!.metrics.shoulderTilt * 100).toFixed(0)}%`
              : "—"
          }
          pct={shoulderPct}
          warn={shoulderPct > 40}
        />
        <Metric
          label="Ngồi liên tục"
          hint={COPY.sit.hint}
          value={formatDuration(snapshot?.sittingMs ?? 0)}
          pct={sitPct}
          warn={sitPct > 70}
        />

        <label className="field">
          Cảnh báo ngồi quá lâu
          <select
            value={sitPreset}
            onChange={(e) => setSitPreset(Number(e.target.value))}
          >
            {SIT_PRESETS.map((p) => (
              <option key={p.ms} value={p.ms}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <h3>Cảnh báo gần đây</h3>
        {alerts.length === 0 ? (
          <p className="muted">Chưa có cảnh báo. Giữ tư thế khoảng 7 giây khi sai mới báo, tránh spam.</p>
        ) : (
          <ul className="log">
            {alerts.map((a) => (
              <li key={`${a.kind}-${a.at}`}>
                <em>{new Date(a.at).toLocaleTimeString()}</em>
                <span>{a.title}</span>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  pct,
  warn,
}: {
  label: string;
  value: string;
  hint: string;
  pct: number;
  warn: boolean;
}) {
  return (
    <div className={`metric ${warn ? "warn" : ""}`} title={hint}>
      <div className="metric-head">
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <div className="bar">
        <i style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
