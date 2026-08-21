export type CamFacing = "user" | "environment" | "unknown";

export type CamDevice = {
  deviceId: string;
  label: string;
  facing: CamFacing;
};

function inferFacing(label: string, facingMode?: string): CamFacing {
  const mode = (facingMode ?? "").toLowerCase();
  if (mode === "user") return "user";
  if (mode === "environment") return "environment";
  const text = label.toLowerCase();
  if (/back|rear|environment|sau|world/i.test(text)) return "environment";
  if (/front|user|face|trước|facetime/i.test(text)) return "user";
  return "unknown";
}

export function cameraLabel(cam: CamDevice, index: number) {
  if (cam.facing === "user") {
    return cam.label ? `Trước · ${cam.label}` : "Camera trước";
  }
  if (cam.facing === "environment") {
    return cam.label ? `Sau · ${cam.label}` : "Camera sau";
  }
  return cam.label || `Camera ${index + 1}`;
}

export async function listVideoInputs(): Promise<CamDevice[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === "videoinput" && d.deviceId)
    .map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label || `Camera ${i + 1}`,
      facing: inferFacing(d.label),
    }));
}

export function isMobileViewport() {
  return window.matchMedia("(max-width: 880px)").matches;
}

export async function openCameraStream(deviceId?: string) {
  const mobile = isMobileViewport();
  const video: MediaTrackConstraints = deviceId
    ? { deviceId: { exact: deviceId } }
    : { facingMode: { ideal: "user" } };

  if (mobile) {
    video.width = { ideal: 720 };
    video.height = { ideal: 1280 };
  } else {
    video.width = { ideal: 1280 };
    video.height = { ideal: 720 };
  }

  try {
    return await navigator.mediaDevices.getUserMedia({ video, audio: false });
  } catch {
    const fallback: MediaTrackConstraints = deviceId
      ? { deviceId: { exact: deviceId } }
      : { facingMode: "user" };
    return navigator.mediaDevices.getUserMedia({ video: fallback, audio: false });
  }
}

export function shouldMirror(
  track: MediaStreamTrack,
  cameras: CamDevice[],
) {
  const settings = track.getSettings();
  const facing = inferFacing(
    cameras.find((c) => c.deviceId === settings.deviceId)?.label ?? "",
    settings.facingMode,
  );
  if (facing === "environment") return false;
  return true;
}
