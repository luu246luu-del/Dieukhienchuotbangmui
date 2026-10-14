// frontend/src/utils/WinkDetector.ts
// Asymmetric wink detection for "Enter" activation.
// Computes Eye Aspect Ratio (EAR) independently per eye, calibrates a
// dynamic per-user baseline over the first N seconds, then fires an
// event when exactly one eye closes while the other stays open,
// debounced to avoid false triggers on blinks/noise.

export interface Landmark {
  x: number;
  y: number;
  z?: number;
}

export type Eye = "left" | "right";

export interface WinkEvent {
  eye: Eye;
  ear: number;
  threshold: number;
  timestampMs: number;
}

export interface WinkDetectorOptions {
  /** How many seconds of initial frames to use for baseline calibration. */
  calibrationSeconds?: number;
  /** Fraction of the calibrated baseline EAR that counts as "closed". */
  thresholdRatio?: number;
  /** Minimum time between fired wink events, in ms. */
  debounceMs?: number;
  /** Minimum number of consecutive closed frames required (extra denoise). */
  consecutiveFramesRequired?: number;
}

// MediaPipe FaceLandmarker (478-point face mesh) canonical EAR landmark sets.
export const LEFT_EYE_EAR_INDICES: [number, number, number, number, number, number] = [
  362, 385, 387, 263, 373, 380,
];
export const RIGHT_EYE_EAR_INDICES: [number, number, number, number, number, number] = [
  33, 160, 158, 133, 153, 144,
];

function dist(a: Landmark, b: Landmark): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Eye Aspect Ratio, per Soukupová & Čech (2016):
 * EAR = (||p2-p6|| + ||p3-p5||) / (2 * ||p1-p4||)
 * where p1..p6 are the 6 eye-contour landmarks in order
 * [left corner, top-left, top-right, right corner, bottom-right, bottom-left].
 */
export function computeEAR(points: Landmark[]): number {
  if (points.length !== 6) {
    throw new Error(`computeEAR expects exactly 6 landmarks, received ${points.length}`);
  }
  const [p1, p2, p3, p4, p5, p6] = points;
  const vertical1 = dist(p2, p6);
  const vertical2 = dist(p3, p5);
  const horizontal = dist(p1, p4);
  if (horizontal === 0) return 0;
  return (vertical1 + vertical2) / (2 * horizontal);
}

type CalibrationState = "CALIBRATING" | "READY";

export class WinkDetector {
  private readonly calibrationSeconds: number;
  private readonly thresholdRatio: number;
  private readonly debounceMs: number;
  private readonly consecutiveFramesRequired: number;

  private state: CalibrationState = "CALIBRATING";
  private calibrationStartMs: number | null = null;
  private leftSamples: number[] = [];
  private rightSamples: number[] = [];

  private leftBaseline = 0;
  private rightBaseline = 0;
  private leftThreshold = 0;
  private rightThreshold = 0;

  private leftClosedStreak = 0;
  private rightClosedStreak = 0;

  private lastFiredMs = 0;

  constructor(options: WinkDetectorOptions = {}) {
    this.calibrationSeconds = options.calibrationSeconds ?? 3;
    this.thresholdRatio = options.thresholdRatio ?? 0.75;
    this.debounceMs = options.debounceMs ?? 300;
    this.consecutiveFramesRequired = options.consecutiveFramesRequired ?? 2;
  }

  getState(): CalibrationState {
    return this.state;
  }

  getBaselines(): { left: number; right: number; leftThreshold: number; rightThreshold: number } {
    return {
      left: this.leftBaseline,
      right: this.rightBaseline,
      leftThreshold: this.leftThreshold,
      rightThreshold: this.rightThreshold,
    };
  }

  /**
   * Feed one frame's face landmarks in. Returns a WinkEvent if an
   * asymmetric wink was just detected on this frame, otherwise null.
   */
  update(allLandmarks: Landmark[], timestampMs: number): WinkEvent | null {
    const leftPoints = LEFT_EYE_EAR_INDICES.map((i) => allLandmarks[i]);
    const rightPoints = RIGHT_EYE_EAR_INDICES.map((i) => allLandmarks[i]);

    if (leftPoints.some((p) => !p) || rightPoints.some((p) => !p)) {
      return null;
    }

    const leftEAR = computeEAR(leftPoints);
    const rightEAR = computeEAR(rightPoints);

    if (this.state === "CALIBRATING") {
      return this.runCalibrationStep(leftEAR, rightEAR, timestampMs);
    }

    return this.runDetectionStep(leftEAR, rightEAR, timestampMs);
  }

  private runCalibrationStep(leftEAR: number, rightEAR: number, timestampMs: number): null {
    if (this.calibrationStartMs === null) {
      this.calibrationStartMs = timestampMs;
    }
    this.leftSamples.push(leftEAR);
    this.rightSamples.push(rightEAR);

    const elapsedSec = (timestampMs - this.calibrationStartMs) / 1000;
    if (elapsedSec >= this.calibrationSeconds && this.leftSamples.length > 0) {
      this.leftBaseline = average(this.leftSamples);
      this.rightBaseline = average(this.rightSamples);
      this.leftThreshold = this.leftBaseline * this.thresholdRatio;
      this.rightThreshold = this.rightBaseline * this.thresholdRatio;
      this.state = "READY";
      this.leftSamples = [];
      this.rightSamples = [];
    }
    return null;
  }

  private runDetectionStep(leftEAR: number, rightEAR: number, timestampMs: number): WinkEvent | null {
    const leftClosed = leftEAR < this.leftThreshold;
    const rightClosed = rightEAR < this.rightThreshold;

    this.leftClosedStreak = leftClosed ? this.leftClosedStreak + 1 : 0;
    this.rightClosedStreak = rightClosed ? this.rightClosedStreak + 1 : 0;

    const leftWinking =
      this.leftClosedStreak >= this.consecutiveFramesRequired && !rightClosed;
    const rightWinking =
      this.rightClosedStreak >= this.consecutiveFramesRequired && !leftClosed;

    // Both eyes closed simultaneously = a blink, not a wink. Ignore it.
    if (leftClosed && rightClosed) {
      return null;
    }

    if (!leftWinking && !rightWinking) {
      return null;
    }

    if (timestampMs - this.lastFiredMs < this.debounceMs) {
      return null;
    }

    this.lastFiredMs = timestampMs;
    this.leftClosedStreak = 0;
    this.rightClosedStreak = 0;

    if (leftWinking) {
      return { eye: "left", ear: leftEAR, threshold: this.leftThreshold, timestampMs };
    }
    return { eye: "right", ear: rightEAR, threshold: this.rightThreshold, timestampMs };
  }

  /** Force re-calibration, e.g. after the user repositions or on demand. */
  recalibrate(): void {
    this.state = "CALIBRATING";
    this.calibrationStartMs = null;
    this.leftSamples = [];
    this.rightSamples = [];
    this.leftClosedStreak = 0;
    this.rightClosedStreak = 0;
  }
}

function average(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
