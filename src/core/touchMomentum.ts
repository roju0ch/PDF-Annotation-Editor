import type { Point } from "./viewport";

// Distances are in CSS pixels and times are in milliseconds.
const SAMPLE_WINDOW = 90;
const MAX_SAMPLES = 16;
const SAMPLE_INTERVAL_GRACE = 24;
const RELEASE_IDLE_LIMIT = 70;
const MIN_TRAVEL = 8;
const MIN_RELEASE_SPEED = 0.12;
const MAX_SPEED = 6;
const FRICTION = 0.005;
const STOP_SPEED = 0.035;
export const MAX_MOMENTUM_FRAME_GAP = 100;

type Sample = Point & { time: number };

export class TouchVelocity {
  private samples: Sample[] = [];

  record(x: number, y: number, time: number) {
    const last = this.samples.at(-1);
    if (last && (time < last.time || (x === last.x && y === last.y))) return;
    if (last && time === last.time) this.samples.pop();
    this.samples.push({ x, y, time });
    if (this.samples.length > MAX_SAMPLES) this.samples.shift();
  }

  release(time: number): Point | null {
    const last = this.samples.at(-1);
    const previous = this.samples.at(-2);
    if (
      !last ||
      !previous ||
      time < last.time ||
      time - last.time >= RELEASE_IDLE_LIMIT
    )
      return null;

    const latestX = previous.x - last.x;
    const latestY = previous.y - last.y;
    const cutoff = time - SAMPLE_WINDOW;
    let x = 0;
    let y = 0;
    let start = last.time;
    for (let i = this.samples.length - 1; i > 0; i--) {
      const to = this.samples[i];
      const from = this.samples[i - 1];
      if (to.time <= cutoff) break;
      const dx = from.x - to.x;
      const dy = from.y - to.y;
      // A reversal should fling in the new direction, even after a fast swipe.
      if (dx * latestX + dy * latestY < 0) break;
      start = Math.max(from.time, cutoff);
      const fraction = (to.time - start) / (to.time - from.time);
      x += dx * fraction;
      y += dy * fraction;
    }

    const travel = Math.hypot(x, y);
    const duration = time - start;
    if (travel < MIN_TRAVEL || duration <= 0) return null;
    // Allow normal spacing between events and fade out if the finger paused.
    const idle = time - last.time;
    const freshness = Math.min(
      1,
      (RELEASE_IDLE_LIMIT - idle) /
        (RELEASE_IDLE_LIMIT - SAMPLE_INTERVAL_GRACE),
    );
    const speed = Math.min(travel / duration, MAX_SPEED) * freshness ** 2;
    if (speed < MIN_RELEASE_SPEED) return null;
    const factor = speed / travel;
    return { x: x * factor, y: y * factor };
  }
}

export function momentumStep(velocity: Point, elapsed: number) {
  const remaining = Math.max(
    0,
    Math.log(Math.hypot(velocity.x, velocity.y) / STOP_SPEED) / FRICTION,
  );
  const decay = -Math.expm1(-FRICTION * Math.min(elapsed, remaining));
  const duration = decay / FRICTION;
  const next = elapsed >= remaining ? 0 : 1 - decay;
  return {
    dx: velocity.x * duration,
    dy: velocity.y * duration,
    velocity: { x: velocity.x * next, y: velocity.y * next },
  };
}
