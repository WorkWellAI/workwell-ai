import type { Landmark } from "./posture";

const WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm";
const POSE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
const FACE_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

export type PoseLandmarkerHandle = {
  detectForVideo: (
    video: HTMLVideoElement,
    timestamp: number,
  ) => { landmarks: Landmark[][] };
  close: () => void;
};

export type FaceLandmarkerHandle = {
  detectForVideo: (
    video: HTMLVideoElement,
    timestamp: number,
  ) => {
    faceLandmarks: Landmark[][];
    faceBlendshapes?: Array<{
      categories: Array<{ categoryName: string; score: number }>;
    }>;
  };
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
  FaceLandmarker: {
    createFromOptions: (
      fileset: unknown,
      options: Record<string, unknown>,
    ) => Promise<FaceLandmarkerHandle>;
  };
};

let filesetPromise: Promise<unknown> | null = null;

async function loadBridge(): Promise<VisionBridge> {
  const url = `${window.location.origin}/mediapipe-bridge.js`;
  // Native import() so Next/Turbopack does not bundle the CDN MediaPipe module.
  const dynamicImport = new Function("u", "return import(u)") as (
    u: string,
  ) => Promise<VisionBridge>;
  return dynamicImport(url);
}

async function getFileset() {
  if (!filesetPromise) {
    const { FilesetResolver } = await loadBridge();
    filesetPromise = FilesetResolver.forVisionTasks(WASM_URL);
  }
  return filesetPromise;
}

async function withDelegate<T>(
  create: (delegate: "GPU" | "CPU") => Promise<T>,
): Promise<T> {
  try {
    return await create("GPU");
  } catch {
    return create("CPU");
  }
}

export async function createPoseLandmarker(): Promise<PoseLandmarkerHandle> {
  const { PoseLandmarker } = await loadBridge();
  const fileset = await getFileset();
  const base = {
    runningMode: "VIDEO",
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  };
  return withDelegate((delegate) =>
    PoseLandmarker.createFromOptions(fileset, {
      ...base,
      baseOptions: { modelAssetPath: POSE_MODEL_URL, delegate },
    }),
  );
}

export async function createFaceLandmarker(): Promise<FaceLandmarkerHandle> {
  const { FaceLandmarker } = await loadBridge();
  const fileset = await getFileset();
  const base = {
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: true,
  };
  return withDelegate((delegate) =>
    FaceLandmarker.createFromOptions(fileset, {
      ...base,
      baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate },
    }),
  );
}
