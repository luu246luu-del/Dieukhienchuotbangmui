// frontend/src/utils/OneEuroFilter.ts
// 1€ Filter (Casiez, Roussel, Vogel — CHI 2012)
// Adaptive low-pass filter: aggressive smoothing when the signal is slow
// (kills jitter), lighter smoothing when it moves fast (kills lag).

interface OneEuroFilterOptions {
  minCutoff?: number;
  beta?: number;
  dCutoff?: number;
}

class LowPassFilter {
  private yPrev: number | null = null;
  private initialized = false;

  filter(value: number, alpha: number): number {
    if (!this.initialized) {
      this.yPrev = value;
      this.initialized = true;
      return value;
    }
    const result = alpha * value + (1 - alpha) * (this.yPrev as number);
    this.yPrev = result;
    return result;
  }

  lastValue(): number | null {
    return this.yPrev;
  }

  reset(): void {
    this.yPrev = null;
    this.initialized = false;
  }
}

function computeAlpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

/**
 * Scalar 1€ Filter. Instantiate one per axis (or use OneEuroFilter2D below
 * for screen-space x/y pointer tracking).
 */
export class OneEuroFilter {
  private minCutoff: number;
  private beta: number;
  private dCutoff: number;

  private xFilter = new LowPassFilter();
  private dxFilter = new LowPassFilter();

  private lastTimestamp: number | null = null;

  constructor(options: OneEuroFilterOptions = {}) {
    this.minCutoff = options.minCutoff ?? 1.0;
    this.beta = options.beta ?? 0.007;
    this.dCutoff = options.dCutoff ?? 1.0;
  }

  /**
   * @param value raw noisy sample
   * @param timestampMs monotonic timestamp in milliseconds (e.g. performance.now())
   */
  filter(value: number, timestampMs: number): number {
    if (this.lastTimestamp === null) {
      this.lastTimestamp = timestampMs;
      this.xFilter.filter(value, 1.0);
      this.dxFilter.filter(0, 1.0);
      return value;
    }

    let dt = (timestampMs - this.lastTimestamp) / 1000;
    if (dt <= 0) {
      dt = 1 / 60;
    }
    this.lastTimestamp = timestampMs;

    const prevX = this.xFilter.lastValue() ?? value;
    const dx = (value - prevX) / dt;

    const edx = this.dxFilter.filter(dx, computeAlpha(this.dCutoff, dt));

    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    const alpha = computeAlpha(cutoff, dt);

    return this.xFilter.filter(value, alpha);
  }

  updateParams(options: OneEuroFilterOptions): void {
    if (options.minCutoff !== undefined) this.minCutoff = options.minCutoff;
    if (options.beta !== undefined) this.beta = options.beta;
    if (options.dCutoff !== undefined) this.dCutoff = options.dCutoff;
  }

  reset(): void {
    this.xFilter.reset();
    this.dxFilter.reset();
    this.lastTimestamp = null;
  }
}

export interface Point2D {
  x: number;
  y: number;
}

/**
 * Convenience wrapper running two independent 1€ filters for screen-space
 * pointer coordinates (nose-tip landmark -> mapped OS cursor position).
 */
export class OneEuroFilter2D {
  private fx: OneEuroFilter;
  private fy: OneEuroFilter;

  constructor(options: OneEuroFilterOptions = {}) {
    this.fx = new OneEuroFilter(options);
    this.fy = new OneEuroFilter(options);
  }

  filter(point: Point2D, timestampMs: number): Point2D {
    return {
      x: this.fx.filter(point.x, timestampMs),
      y: this.fy.filter(point.y, timestampMs),
    };
  }

  updateParams(options: OneEuroFilterOptions): void {
    this.fx.updateParams(options);
    this.fy.updateParams(options);
  }

  reset(): void {
    this.fx.reset();
    this.fy.reset();
  }
}
