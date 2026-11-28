import { describe, expect, it } from "vitest";
import { momentumStep, TouchVelocity } from "../src/core/touchMomentum";

function release(
  samples: [number, number, number][],
  time = samples.at(-1)![2],
) {
  const velocity = new TouchVelocity();
  for (const sample of samples) velocity.record(...sample);
  return velocity.release(time);
}

describe("touch release velocity", () => {
  it("uses recent movement to distinguish small, slow and fast swipes", () => {
    expect(
      release([
        [0, 0, 0],
        [0, -7, 4],
      ]),
    ).toBeNull();
    expect(
      release([
        [0, 0, 0],
        [0, -12, 120],
      ]),
    ).toBeNull();
    const slow = release([
      [0, 0, 0],
      [0, -8, 40],
      [0, -16, 80],
    ])!;
    const fast = release([
      [0, 0, 0],
      [0, -60, 30],
      [0, -140, 70],
    ])!;
    expect(slow).toEqual({ x: 0, y: 0.2 });
    expect(fast).toEqual({ x: 0, y: 2 });
    expect(momentumStep(fast, 2000).dy).toBeGreaterThan(
      10 * momentumStep(slow, 2000).dy,
    );
  });

  it("bounds diagonal speed, ignores stale samples and handles equal timestamps", () => {
    const capped = release([
      [0, 0, 0],
      [-40, -40, 10],
      [-90, -120, 10],
    ])!;
    expect(Math.hypot(capped.x, capped.y)).toBeCloseTo(6);
    expect(capped.x / capped.y).toBeCloseTo(0.75);
    expect(
      release([
        [0, 0, 0],
        [-100, 0, 10],
        [-150, 0, 9],
      ]),
    ).toBeNull();
    expect(
      release([
        [0, 0, 0],
        [-100, 0, 0],
      ]),
    ).toBeNull();
    const recent = release([
      [0, 0, 0],
      [0, -300, 10],
      [0, -320, 150],
    ])!;
    expect(recent.y).toBeCloseTo(20 / 140);
  });

  it("ages out fast swipes when the finger pauses before release", () => {
    const samples: [number, number, number][] = [
      [0, 0, 0],
      [0, -120, 40],
    ];
    expect(release(samples, 60)!.y).toBeLessThan(release(samples)!.y);
    expect(release([...samples, [0, -120, 85]], 110)).toBeNull();
  });

  it("uses the new direction after a reversal inside the sampling window", () => {
    const velocity = release([
      [0, 0, 0],
      [0, -160, 30],
      [0, -100, 50],
      [0, -66, 70],
    ])!;
    expect(velocity).toEqual({ x: 0, y: -2.35 });
  });
});

describe("kinetic deceleration", () => {
  function glide(fps: number) {
    let velocity = { x: -2.3, y: 4.4 };
    const steps: number[] = [];
    let x = 0;
    let y = 0;
    while (velocity.x || velocity.y) {
      const step = momentumStep(velocity, 1000 / fps);
      velocity = step.velocity;
      x += step.dx;
      y += step.dy;
      steps.push(Math.hypot(step.dx, step.dy));
    }
    return { x, y, steps };
  }

  it.each([30, 60, 90, 120, 144])(
    "decelerates smoothly and reaches the same resting point at %i Hz",
    (fps) => {
      const run = glide(fps);
      expect(run.x).toBeCloseTo(glide(60).x, 8);
      expect(run.y).toBeCloseTo(glide(60).y, 8);
      expect(run.steps.every((step, i) => !i || step < run.steps[i - 1])).toBe(
        true,
      );
      expect(run.steps.at(-1)!).toBeLessThan(2);
      expect(run.steps.length / fps).toBeLessThan(1.1);
    },
  );
});
