// frontend/src/components/FaceController.tsx
// Integrates MediaPipe FaceLandmarker (fully on-device, no video leaves
// the browser) with the 1€ pointer filter and asymmetric wink detector,
// and streams the resulting cursor/keypress intents to the local OS
// bridge over WebSocket.

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FaceLandmarker,
  FilesetResolver,
  GestureRecognizer,
  type FaceLandmarkerResult,
  type GestureRecognizerResult,
} from "@mediapipe/tasks-vision";
import { OneEuroFilter2D, type Point2D } from "../utils/OneEuroFilter";
import { WinkDetector, type WinkEvent } from "../utils/WinkDetector";

const NOSE_TIP_LANDMARK_INDEX = 1;
const BRIDGE_WS_URL = "ws://127.0.0.1:8787";
const WS_RECONNECT_DELAY_MS = 1500;
const UPPER_LIP_INDEX = 13;
const LOWER_LIP_INDEX = 14;
const LEFT_MOUTH_INDEX = 61;
const RIGHT_MOUTH_INDEX = 291;

const MOUTH_OPEN_RATIO = 0.18;
const MOUTH_TRIGGER_COOLDOWN_MS = 1500;
// Fraction of the camera frame (centered) that maps to the full screen.
// Keeping this smaller than 1.0 means the user doesn't need to move their
// head to the physical frame edges to reach the screen edges.
const ACTIVE_REGION = { widthFrac: 0.5, heightFrac: 0.4 };

export interface FaceControllerConfig {
  mouseSensitivity: number;
  deadZoneRadius: number;
  invertX: boolean;
  invertY: boolean;
  oneEuroMinCutoff: number;
  oneEuroBeta: number;
  oneEuroDCutoff: number;
  earCalibrationSec: number;
  earThresholdRatio: number;
  winkDebounceMs: number;
}

interface FaceControllerProps {
  config: FaceControllerConfig;
  modelAssetPath: string;
  wasmBasePath: string;
  onWink?: (event: WinkEvent) => void;
  onStatusChange?: (status: ConnectionStatus) => void;
}

export type ConnectionStatus =
  | "INITIALIZING"
  | "CAMERA_READY"
  | "CALIBRATING"
  | "TRACKING"
  | "BRIDGE_DISCONNECTED"
  | "ERROR";

type BridgeMessage =
  | {
      action: "move";
      x: number;
      y: number;
    }
  | {
      action: "keypress";
      key: "enter";
    }
  | {
      action: "click";
      button: "left";
    };
function screenToBridgeSpace(norm: Point2D): { x: number; y: number } {
  const width = window.screen.width;
  const height = window.screen.height;
  return {
    x: Math.round(clamp(norm.x, 0, 1) * width),
    y: Math.round(clamp(norm.y, 0, 1) * height),
  };
}
function distance2D(
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  return Math.hypot(
    a.x - b.x,
    a.y - b.y
  );
}

function getMouthOpenRatio(
  landmarks: Array<{
    x: number;
    y: number;
    z?: number;
  }>
): number {
  const upperLip = landmarks[UPPER_LIP_INDEX];
  const lowerLip = landmarks[LOWER_LIP_INDEX];
  const leftMouth = landmarks[LEFT_MOUTH_INDEX];
  const rightMouth = landmarks[RIGHT_MOUTH_INDEX];

  if (
    !upperLip ||
    !lowerLip ||
    !leftMouth ||
    !rightMouth
  ) {
    return 0;
  }

  const mouthHeight = distance2D(
    upperLip,
    lowerLip
  );

  const mouthWidth = distance2D(
    leftMouth,
    rightMouth
  );

  if (mouthWidth <= 0) {
    return 0;
  }

  return mouthHeight / mouthWidth;
}
function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export const FaceController: React.FC<FaceControllerProps> = ({
  config,
  modelAssetPath,
  wasmBasePath,
  onWink,
  onStatusChange,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const landmarkerRef = useRef<FaceLandmarker | null>(null);
  const gestureRecognizerRef =
  useRef<GestureRecognizer | null>(null);

const thumbUpStartRef =
  useRef<number | null>(null);

const thumbUpLatchedRef =
  useRef(false);

const lastLeftClickRef =
  useRef(0);


  const filterRef = useRef<OneEuroFilter2D | null>(null);
  const winkDetectorRef = useRef<WinkDetector | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const rafHandleRef = useRef<number | null>(null);
  const lastVideoTimeRef = useRef(-1);
  const mouthOpenRef = useRef(false);
const lastMouthTriggerRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const [status, setStatus] = useState<ConnectionStatus>("INITIALIZING");
  const [lastWink, setLastWink] = useState<WinkEvent | null>(null);

  const updateStatus = useCallback(
    (next: ConnectionStatus) => {
      setStatus(next);
      onStatusChange?.(next);
    },
    [onStatusChange]
  );

  const connectBridge = useCallback(() => {
    const ws = new WebSocket(BRIDGE_WS_URL);

    ws.onopen = () => {
      if (!mountedRef.current) return;
      if (status === "CALIBRATING" || status === "INITIALIZING") {
        // leave status as-is, tracking loop will promote it
      } else {
        updateStatus("TRACKING");
      }
    };

    ws.onclose = () => {
      if (!mountedRef.current) return;
      updateStatus("BRIDGE_DISCONNECTED");
      reconnectTimerRef.current = setTimeout(connectBridge, WS_RECONNECT_DELAY_MS);
    };

    ws.onerror = () => {
      ws.close();
    };

    wsRef.current = ws;
  }, [status, updateStatus]);

  const sendToBridge = useCallback((message: BridgeMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }, []);

  const handleWinkEvent = useCallback(
    (event: WinkEvent) => {
      setLastWink(event);
      onWink?.(event);
      sendToBridge({ action: "keypress", key: "enter" });
    },
    [onWink, sendToBridge]
  );
const processHandGesture = useCallback(
  (
    result: GestureRecognizerResult,
    timestampMs: number
  ) => {
    const detectedGesture =
      result.gestures?.[0]?.[0];

    const isThumbUp =
      detectedGesture?.categoryName === "Thumb_Up" &&
      (detectedGesture.score ?? 0) >= 0.55;

    if (!isThumbUp) {
      thumbUpStartRef.current = null;
      thumbUpLatchedRef.current = false;
      return;
    }

    if (thumbUpStartRef.current === null) {
      thumbUpStartRef.current = timestampMs;
      return;
    }

    const heldDuration =
      timestampMs - thumbUpStartRef.current;

    const timeSinceLastClick =
      timestampMs - lastLeftClickRef.current;

    if (
      heldDuration >= 600 &&
      timeSinceLastClick >= 1200 &&
      !thumbUpLatchedRef.current
    ) {
      thumbUpLatchedRef.current = true;
      lastLeftClickRef.current = timestampMs;

      sendToBridge({
        action: "click",
        button: "left",
      });

      console.log(
        "Đã nhận diện Thumb_Up, gửi chuột trái",
        detectedGesture.score
      );
    }
  },
  [sendToBridge]
);

  const processResult = useCallback(
    (result: FaceLandmarkerResult, timestampMs: number) => {
      const landmarks = result.faceLandmarks?.[0];
      if (!landmarks || landmarks.length === 0) return;
const mouthRatio =
  getMouthOpenRatio(landmarks);

const isMouthOpen =
  mouthRatio >= MOUTH_OPEN_RATIO;

const now = performance.now();

if (
  isMouthOpen &&
  !mouthOpenRef.current &&
  now - lastMouthTriggerRef.current >=
    MOUTH_TRIGGER_COOLDOWN_MS
) {
  lastMouthTriggerRef.current = now;

  console.log(
    "Phát hiện há miệng, gửi Enter:",
    mouthRatio.toFixed(3)
  );

  sendToBridge({
    action: "keypress",
    key: "enter",
  });
}

mouthOpenRef.current = isMouthOpen;
      const noseTip = landmarks[NOSE_TIP_LANDMARK_INDEX];
      if (!noseTip) return;

      // Normalize nose position within the configured active region,
      // centered on the frame, then map to [0,1] screen space.
      const centeredX = noseTip.x - 0.5;
      const centeredY = noseTip.y - 0.5;

      let normX = 0.5 + (centeredX / ACTIVE_REGION.widthFrac) * config.mouseSensitivity;
      let normY = 0.5 + (centeredY / ACTIVE_REGION.heightFrac) * config.mouseSensitivity;

      if (config.invertX) normX = 1 - normX;
      if (config.invertY) normY = 1 - normY;

      normX = clamp(normX, 0, 1);
      normY = clamp(normY, 0, 1);

      const distFromCenter = Math.hypot(normX - 0.5, normY - 0.5);
      if (distFromCenter < config.deadZoneRadius) {
        return;
      }

      const filter = filterRef.current as OneEuroFilter2D;
      const smoothed = filter.filter({ x: normX, y: normY }, timestampMs);
      const bridgeCoords = screenToBridgeSpace(smoothed);
      sendToBridge({ action: "move", x: bridgeCoords.x, y: bridgeCoords.y });

      const detector = winkDetectorRef.current as WinkDetector;
      if (detector.getState() === "CALIBRATING") {
        updateStatus("CALIBRATING");
      } else if (status !== "TRACKING") {
        updateStatus("TRACKING");
      }

const winkEvent = detector.update(
  landmarks,
  timestampMs
);

if (winkEvent) {
  setLastWink(winkEvent);
  onWink?.(winkEvent);
}    },
    [config, handleWinkEvent, sendToBridge, status, updateStatus]
  );

  const trackingLoop = useCallback(() => {
    const video = videoRef.current;
    const landmarker = landmarkerRef.current;
    const gestureRecognizer =
  gestureRecognizerRef.current;
    if (!video || !landmarker || video.readyState < 2) {
      rafHandleRef.current = requestAnimationFrame(trackingLoop);
      return;
    }

    if (video.currentTime !== lastVideoTimeRef.current) {
      lastVideoTimeRef.current = video.currentTime;
      const timestampMs = performance.now();
      const result = landmarker.detectForVideo(video, timestampMs);
      processResult(result, timestampMs);
      if (gestureRecognizer) {
  const gestureResult =
    gestureRecognizer.recognizeForVideo(
      video,
      timestampMs
    );

  processHandGesture(
    gestureResult,
    timestampMs
  );
}
    }

    rafHandleRef.current = requestAnimationFrame(trackingLoop);
}, [
  processResult,
  processHandGesture,
]);
  useEffect(() => {
    mountedRef.current = true;
    filterRef.current = new OneEuroFilter2D({
      minCutoff: config.oneEuroMinCutoff,
      beta: config.oneEuroBeta,
      dCutoff: config.oneEuroDCutoff,
    });
    winkDetectorRef.current = new WinkDetector({
      calibrationSeconds: config.earCalibrationSec,
      thresholdRatio: config.earThresholdRatio,
      debounceMs: config.winkDebounceMs,
    });

    let cancelled = false;

    async function init() {
      try {
        const vision = await FilesetResolver.forVisionTasks(wasmBasePath);
        const landmarker = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath,
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numFaces: 1,
          minFaceDetectionConfidence: 0.5,
          minFacePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        const gestureRecognizer =
  await GestureRecognizer.createFromOptions(
    vision,
    {
      baseOptions: {
        modelAssetPath:
          "/models/gesture_recognizer.task",
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numHands: 1,
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      cannedGesturesClassifierOptions: {
        categoryAllowlist: ["Thumb_Up"],
        scoreThreshold: 0.55,
      },
    }
  );
if (cancelled) {
  landmarker.close();
  gestureRecognizer.close();
  return;
}

landmarkerRef.current = landmarker;
gestureRecognizerRef.current = gestureRecognizer;        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, facingMode: "user" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        updateStatus("CAMERA_READY");
        connectBridge();
        updateStatus("CALIBRATING");
        rafHandleRef.current = requestAnimationFrame(trackingLoop);
      } catch (err) {
        console.error("[FaceController] initialization failed", err);
        if (!cancelled) updateStatus("ERROR");
      }
    }

    init();

    return () => {
      cancelled = true;
      mountedRef.current = false;
      if (rafHandleRef.current !== null) {
        cancelAnimationFrame(rafHandleRef.current);
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      landmarkerRef.current?.close();
      gestureRecognizerRef.current?.close();
``
      wsRef.current?.close();
      const stream = videoRef.current?.srcObject as MediaStream | null;
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    filterRef.current?.updateParams({
      minCutoff: config.oneEuroMinCutoff,
      beta: config.oneEuroBeta,
      dCutoff: config.oneEuroDCutoff,
    });
  }, [config.oneEuroMinCutoff, config.oneEuroBeta, config.oneEuroDCutoff]);

  return (
    <div className="face-controller">
      <video ref={videoRef} className="face-controller__video" muted playsInline />
      <div className="face-controller__status" data-status={status}>
        {statusLabel(status)}
        {lastWink && (
          <span className="face-controller__last-wink">
            {" "}
            · last wink: {lastWink.eye} ({lastWink.ear.toFixed(3)})
          </span>
        )}
      </div>
    </div>
  );
};

function statusLabel(status: ConnectionStatus): string {
  switch (status) {
    case "INITIALIZING":
      return "Đang khởi tạo camera & mô hình AI...";
    case "CAMERA_READY":
      return "Camera sẵn sàng";
    case "CALIBRATING":
      return "Đang hiệu chỉnh ngưỡng mắt — giữ mắt mở bình thường trong vài giây";
    case "TRACKING":
      return "Đang theo dõi";
    case "BRIDGE_DISCONNECTED":
      return "Mất kết nối tới OS Bridge — đang thử kết nối lại...";
    case "ERROR":
      return "Lỗi khởi tạo — kiểm tra quyền camera";
    default:
      return "";
  }
}

export default FaceController;
