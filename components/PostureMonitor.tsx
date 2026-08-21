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
import {
  createFaceLandmarker,
  createPoseLandmarker,
  type FaceLandmarkerHandle,
  type PoseLandmarkerHandle,
} from "@/lib/pose-landmarker";
import {
  analyzeFace,
  EYES_HOLD_MS,
  SCORE_HOLD_MS,
  FACE_DOTS,
  FATIGUE_COPY,
  FatigueSession,
  PERCLOS_WINDOW_MS,
  YAWN_HOLD_MS,
  type FatigueSnapshot,
} from "@/lib/fatigue";
import {
  cameraLabel,
  listVideoInputs,
  openCameraStream,
  shouldMirror,
  type CamDevice,
} from "@/lib/cameras";
import {
  EMPTY_ALERT_COUNTS,
  EMPTY_COACH_STATS,
  type CoachStats,
} from "@/lib/coach";
import { CoachPanel } from "@/components/CoachPanel";

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

function statusColor(
  snapshot: SessionSnapshot | null,
  fatigue: FatigueSnapshot | null,
  holdMs: number,
) {
  if (!snapshot?.metrics.present) return "#7d8b84";
  if (snapshot.alert || fatigue?.alert) return "#ff6b4a";
  if (
    snapshot.headHoldMs > holdMs * 0.4 ||
    snapshot.shoulderHoldMs > holdMs * 0.4 ||
    (fatigue &&
      (fatigue.eyesHoldMs > EYES_HOLD_MS * 0.4 ||
        fatigue.yawnHoldMs > YAWN_HOLD_MS * 0.4 ||
        fatigue.score >= 45))
  ) {
    return "#f0b429";
  }
  return "#b7e38a";
}

function drawFaceDots(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  color: string,
) {
  const { width, height } = ctx.canvas;
  ctx.fillStyle = color;
  for (const i of FACE_DOTS) {
    const p = landmarks[i];
    if (!p) continue;
    ctx.beginPath();
    ctx.arc(p.x * width, p.y * height, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function PostureMonitor() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef(new PostureSession());
  const rafRef = useRef(0);
  const lastTsRef = useRef(-1);
  const lastUiRef = useRef(0);
  const landmarkerRef = useRef<PoseLandmarkerHandle | null>(null);
  const faceLandmarkerRef = useRef<FaceLandmarkerHandle | null>(null);
  const fatigueRef = useRef(new FatigueSession());
  const loopStartedRef = useRef(false);
  const deviceIdRef = useRef("");

  const [runState, setRunState] = useState<RunState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const [banner, setBanner] = useState<AlertEvent | null>(null);
  const [sitPreset, setSitPreset] = useState(SIT_PRESETS[0].ms);
  const [calibrating, setCalibrating] = useState(false);
  const [cameras, setCameras] = useState<CamDevice[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [mirrored, setMirrored] = useState(true);
  const [switching, setSwitching] = useState(false);
  const [fatigue, setFatigue] = useState<FatigueSnapshot | null>(null);
  const [faceReady, setFaceReady] = useState(false);
  const [alertCounts, setAlertCounts] = useState({ ...EMPTY_ALERT_COUNTS });
  const [sessionKey, setSessionKey] = useState(0);

  const stopTracks = useCallback(() => {
    const stream = videoRef.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startLoop = useCallback(() => {
    if (loopStartedRef.current) return;
    loopStartedRef.current = true;

    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      const v = videoRef.current;
      const canvas = canvasRef.current;
      const landmarker = landmarkerRef.current;
      if (!v || !canvas || !landmarker || v.readyState < 2) return;

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
        setCalibrating(
          sessionRef.current.isCalibrating || fatigueRef.current.isCalibrating,
        );

        let faceLandmarks: Landmark[] = [];
        let fatigueSnap: FatigueSnapshot | null = null;
        const faceLm = faceLandmarkerRef.current;
        let faceMetrics = {
          present: false,
          ear: 0,
          mar: 0,
          blink: -1,
          jawOpen: -1,
        };
        if (faceLm) {
          try {
            const face = faceLm.detectForVideo(v, ts);
            faceLandmarks = face.faceLandmarks[0] ?? [];
            faceMetrics = analyzeFace(
              faceLandmarks,
              face.faceBlendshapes?.[0]?.categories,
            );
          } catch {
            // Face model may skip a frame independently of pose.
          }
        }
        fatigueSnap = fatigueRef.current.step(faceMetrics, {
          bodyPresent: metrics.present,
          sittingMs: next.sittingMs,
          sitLimitMs: sessionRef.current.sitLimitMs,
          neckAngle: metrics.neckAngle,
        });

        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          const color = statusColor(next, fatigueSnap, HOLD_MS);
          if (landmarks.length) drawPose(ctx, landmarks, color);
          if (faceLandmarks.length) drawFaceDots(ctx, faceLandmarks, color);
        }

        const now = Date.now();
        if (now - lastUiRef.current > 120) {
          lastUiRef.current = now;
          setSnapshot({ ...next });
          setFatigue(fatigueSnap ? { ...fatigueSnap } : null);
        }

        const alert = fatigueSnap?.alert ?? next.alert;
        if (alert) {
          setBanner(alert);
          setAlerts((prev) => [alert, ...prev].slice(0, 8));
          setAlertCounts((prev) => ({
            ...prev,
            [alert.kind]: prev[alert.kind] + 1,
          }));
        }
      } catch {
        // Skip a dropped frame (timestamp or WASM hiccup).
      }
    };

    rafRef.current = requestAnimationFrame(loop);
  }, []);

  const attachStream = useCallback(
    async (nextDeviceId?: string) => {
      const video = videoRef.current;
      if (!video) throw new Error("Không tìm thấy thẻ video.");
      stopTracks();
      const stream = await openCameraStream(nextDeviceId || undefined);
      video.setAttribute("playsinline", "true");
      video.srcObject = stream;
      await video.play();

      const list = await listVideoInputs();
      setCameras(list);
      const track = stream.getVideoTracks()[0];
      const activeId = track?.getSettings().deviceId || nextDeviceId || "";
      deviceIdRef.current = activeId;
      setDeviceId(activeId);
      setMirrored(track ? shouldMirror(track, list) : true);
    },
    [stopTracks],
  );

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    loopStartedRef.current = false;
    lastTsRef.current = -1;
    stopTracks();
    setRunState("idle");
    setCalibrating(false);
    setSwitching(false);
  }, [stopTracks]);

  const startCamera = useCallback(async () => {
    setErrorMsg("");
    setRunState("loading");
    sessionRef.current = new PostureSession();
    sessionRef.current.sitLimitMs = sitPreset;
    fatigueRef.current = new FatigueSession();
    fatigueRef.current.sitLimitMs = sitPreset;
    setSnapshot(null);
    setFatigue(null);
    setAlertCounts({ ...EMPTY_ALERT_COUNTS });
    setAlerts([]);
    setBanner(null);

    try {
      await attachStream(deviceIdRef.current || undefined);
      if (!landmarkerRef.current) {
        landmarkerRef.current = await createPoseLandmarker();
      }
      if (!faceLandmarkerRef.current) {
        try {
          faceLandmarkerRef.current = await createFaceLandmarker();
          setFaceReady(true);
        } catch {
          setFaceReady(false);
        }
      } else {
        setFaceReady(true);
      }
      startLoop();
      setRunState("running");
      setSessionKey((k) => k + 1);
    } catch (err) {
      stopTracks();
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
  }, [attachStream, sitPreset, startLoop, stopTracks]);

  const switchCamera = useCallback(
    async (nextId: string) => {
      if (!nextId || nextId === deviceIdRef.current) return;
      if (!loopStartedRef.current) {
        deviceIdRef.current = nextId;
        setDeviceId(nextId);
        return;
      }
      setSwitching(true);
      setErrorMsg("");
      try {
        await attachStream(nextId);
      } catch (err) {
        setErrorMsg(
          err instanceof Error ? err.message : "Không đổi được camera.",
        );
      } finally {
        setSwitching(false);
      }
    },
    [attachStream],
  );

  const cycleCamera = useCallback(() => {
    if (cameras.length < 2) return;
    const idx = cameras.findIndex((c) => c.deviceId === deviceId);
    const next = cameras[(idx + 1) % cameras.length];
    void switchCamera(next.deviceId);
  }, [cameras, deviceId, switchCamera]);

  useEffect(() => {
    const video = videoRef.current;
    return () => {
      cancelAnimationFrame(rafRef.current);
      loopStartedRef.current = false;
      const stream = video?.srcObject as MediaStream | null;
      stream?.getTracks().forEach((t) => t.stop());
      landmarkerRef.current?.close();
      landmarkerRef.current = null;
      faceLandmarkerRef.current?.close();
      faceLandmarkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!banner) return;
    const id = window.setTimeout(() => setBanner(null), 8_000);
    return () => window.clearTimeout(id);
  }, [banner]);

  useEffect(() => {
    sessionRef.current.sitLimitMs = sitPreset;
    fatigueRef.current.sitLimitMs = sitPreset;
  }, [sitPreset]);

  const present = snapshot?.metrics.present ?? false;
  const headPct = Math.min(100, ((snapshot?.headHoldMs ?? 0) / HOLD_MS) * 100);
  const shoulderPct = Math.min(
    100,
    ((snapshot?.shoulderHoldMs ?? 0) / HOLD_MS) * 100,
  );
  const sitPct = Math.min(100, ((snapshot?.sittingMs ?? 0) / sitPreset) * 100);
  const eyesPct = Math.min(
    100,
    ((fatigue?.eyesHoldMs ?? 0) / EYES_HOLD_MS) * 100,
  );
  const yawnPct = Math.min(
    100,
    ((fatigue?.yawnHoldMs ?? 0) / YAWN_HOLD_MS) * 100,
  );
  const scorePct = Math.min(100, fatigue?.score ?? 0);
  const perclosPct = Math.min(100, (fatigue?.perclos ?? 0) * 100);
  const nodPct = Math.min(100, ((fatigue?.nods2min ?? 0) / 3) * 100);
  const scoreHoldPct = Math.min(
    100,
    ((fatigue?.scoreHoldMs ?? 0) / SCORE_HOLD_MS) * 100,
  );

  const coachStats: CoachStats = snapshot
    ? {
        running: runState === "running",
        bodyPresent: snapshot.metrics.present,
        facePresent: fatigue?.metrics.present ?? false,
        faceReady,
        calibrated: snapshot.calibrated || (fatigue?.calibrated ?? false),
        sittingMs: snapshot.sittingMs,
        sitLimitMs: sitPreset,
        neckAngle: snapshot.metrics.neckAngle,
        shoulderTilt: snapshot.metrics.shoulderTilt,
        headHoldMs: snapshot.headHoldMs,
        shoulderHoldMs: snapshot.shoulderHoldMs,
        perclos: fatigue?.perclos ?? 0,
        yawns10min: fatigue?.yawns10min ?? 0,
        nods2min: fatigue?.nods2min ?? 0,
        fatigueScore: fatigue?.score ?? 0,
        alertCounts,
      }
    : {
        ...EMPTY_COACH_STATS,
        running: runState === "running",
        faceReady,
        alertCounts,
        sitLimitMs: sitPreset,
      };

  return (
    <div className="workspace">
      <div className="monitor">
      {banner && (
        <div className={`toast toast-${banner.kind}`} role="alert">
          <strong>{banner.title}</strong>
          <span>{banner.hint}</span>
        </div>
      )}

      <section className="stage">
        <div className={`viewport ${mirrored ? "mirror" : ""}`}>
          <video ref={videoRef} playsInline muted autoPlay />
          <canvas ref={canvasRef} />
          {runState !== "running" && (
            <div className="overlay-msg">
              {runState === "idle" && (
                <>
                  <p className="kicker">Camera local · không gửi video</p>
                  <h2>Bật webcam để theo dõi dáng ngồi</h2>
                  <p>
                    MediaPipe chạy trên trình duyệt. Cảnh báo dáng ngồi, dấu
                    hiệu mệt, và Coach giải thích từ số liệu (không xem video).
                  </p>
                </>
              )}
              {runState === "loading" && <p>Đang tải mô hình pose &amp; mặt…</p>}
              {runState === "denied" && <p>{errorMsg}</p>}
              {runState === "error" && <p>{errorMsg}</p>}
            </div>
          )}
          {runState === "running" && (
            <div className="live-pill">
              <i /> {present ? "Đang theo dõi" : "Không thấy người"}
            </div>
          )}
          {runState === "running" && cameras.length > 1 && (
            <button
              className="cam-switch"
              onClick={cycleCamera}
              disabled={switching}
              type="button"
            >
              {switching ? "Đang đổi…" : "Đổi camera"}
            </button>
          )}
          {calibrating && (
            <div className="calib-banner">
              Ngồi thẳng, mắt mở, nhìn màn hình — đang lấy tư thế &amp; mắt chuẩn…
            </div>
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
            onClick={() => {
              sessionRef.current.startCalibration();
              fatigueRef.current.startCalibration();
            }}
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
        {cameras.length > 1 && (
          <label className="field camera-field">
            Camera
            <select
              value={deviceId}
              disabled={runState === "loading" || switching}
              onChange={(e) => void switchCamera(e.target.value)}
            >
              {cameras.map((cam, i) => (
                <option key={cam.deviceId} value={cam.deviceId}>
                  {cameraLabel(cam, i)}
                </option>
              ))}
            </select>
          </label>
        )}
        {errorMsg && runState === "running" && (
          <p className="muted">{errorMsg}</p>
        )}
      </section>

      <aside className="panel">
        <h2>Tín hiệu tư thế &amp; mệt</h2>
        <p className="muted">
          {snapshot?.calibrated || fatigue?.calibrated
            ? "Đã hiệu chỉnh tư thế / mắt. Điểm mệt gồm PERCLOS 60s, ngáp, gật gù và ngồi lâu."
            : "Chưa hiệu chỉnh — dùng ngưỡng mặc định. Nên bấm hiệu chỉnh khi ngồi thẳng, mắt mở."}
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
        <Metric
          label="Điểm mệt"
          hint={FATIGUE_COPY.fatigue.hint}
          value={fatigue ? `${fatigue.score}/100` : "—"}
          pct={Math.max(scorePct, scoreHoldPct)}
          warn={(fatigue?.score ?? 0) >= 45}
        />
        <Metric
          label={`PERCLOS (${Math.round(PERCLOS_WINDOW_MS / 1000)}s)`}
          hint="Tỷ lệ thời gian mắt nhắm trong 60 giây gần nhất. Cần ~15 giây dữ liệu mặt."
          value={
            !faceReady
              ? "chưa tải model mặt"
              : fatigue && fatigue.perclos > 0
                ? `${Math.round(fatigue.perclos * 100)}%`
                : "đang lấy mẫu"
          }
          pct={perclosPct}
          warn={perclosPct >= 8}
        />
        <Metric
          label="Gật gù / 2 phút"
          hint="Cúi đầu rồi ngẩng lại trong ~2 giây. Khác với cúi làm việc liên tục."
          value={fatigue ? `${fatigue.nods2min} lần` : "—"}
          pct={nodPct}
          warn={nodPct >= 50}
        />
        <Metric
          label="Mắt (mệt)"
          hint={FATIGUE_COPY.eyes.hint}
          value={
            !faceReady
              ? "chưa tải model mặt"
              : fatigue?.metrics.present
                ? fatigue.metrics.blink >= 0
                  ? `nhắm ${(fatigue.metrics.blink * 100).toFixed(0)}%`
                  : `EAR ${fatigue.metrics.ear.toFixed(2)}`
                : "—"
          }
          pct={eyesPct}
          warn={eyesPct > 40}
        />
        <Metric
          label="Ngáp"
          hint={FATIGUE_COPY.yawn.hint}
          value={
            fatigue?.metrics.present
              ? `há miệng ${fatigue.metrics.mar.toFixed(2)}`
              : "—"
          }
          pct={yawnPct}
          warn={yawnPct > 40}
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
          <p className="muted">
            Chưa có cảnh báo. Mắt ~2s, ngáp ~1s, điểm mệt ≥55 giữ ~8s (PERCLOS 60s + ngáp + gật + ngồi lâu).
          </p>
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
      <CoachPanel stats={coachStats} sessionKey={sessionKey} />
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
