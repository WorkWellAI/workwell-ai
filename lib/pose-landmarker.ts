import type { Landmark } from "./posture";

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

export type PoseLandmarkerHandle = {
  detectForVideo: (
    video: HTMLVideoElement,
    timestamp: number,
  ) => { landmarks: Landmark[][] };
  close: () => void;
};

type VisionBridge = {
  FilesetResolver: {
    forVisionTasks: (path: string) => Promise<unknown>;
  };
  PoseLandmarker: {
    createFromOptions: (
      fileset: unknown,
      options: Record<string, unknown>,
    ) => Promise<PoseLandmarkerHandle>;
  };
};

async function loadBridge(): Promise<VisionBridge> {
  const url = `${window.location.origin}/mediapipe-bridge.js`;
  // Native import() so Next/Turbopack does not bundle the CDN MediaPipe module.
  const dynamicImport = new Function("u", "return import(u)") as (
    u: string,
  ) => Promise<VisionBridge>;
  return dynamicImport(url);
}

export async function createPoseLandmarker(): Promise<PoseLandmarkerHandle> {
  const { FilesetResolver, PoseLandmarker } = await loadBridge();

  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
  const base = {
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  };

  try {
    return await PoseLandmarker.createFromOptions(fileset, {
      ...base,
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
    });
  } catch {
    return PoseLandmarker.createFromOptions(fileset, {
      ...base,
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
    });
  }
}
