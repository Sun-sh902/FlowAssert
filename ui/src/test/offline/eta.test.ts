/** The time left of a running check (offline/eta.ts): no value without a basis, a countdown, and upward corrections only when they are needed. */
import { describe, expect, test } from "vitest";
import { TimeLeft, timeLeftText } from "../../offline/eta";

describe("the time left of a running check", () => {
  test("shows nothing for the first half second, or before 2% of the work is done", () => {
    const t = new TimeLeft(1000);
    expect(t.update(0.5, 1400)).toBeNull();
    expect(t.update(0.01, 3000)).toBeNull();
    expect(t.update(Number.NaN, 3000)).toBeNull();
    expect(t.update(0.25, 3000)).toBeCloseTo(6);
  });

  test("at a steady pace the value counts down to zero and never rises", () => {
    const t = new TimeLeft(0);
    let last = Infinity;
    for (let ms = 600; ms <= 10_000; ms += 100) {
      const shown = t.update(ms / 10_000, ms)!;
      expect(shown).toBeLessThanOrEqual(last + 1e-9);
      expect(shown).toBeCloseTo((10_000 - ms) / 1000, 5);
      last = shown;
    }
    expect(last).toBe(0);
  });

  test("a slightly higher estimate does not raise the shown value; it keeps counting down", () => {
    const t = new TimeLeft(0);
    expect(t.update(0.5, 2000)).toBeCloseTo(2);
    // 100 ms later the pace has slowed a little: the new estimate is 2.3 s, within a quarter of the 1.9 s shown.
    expect(t.update(0.5, 2100)).toBeCloseTo(1.9);
    expect(t.update(0.52, 2500)).toBeCloseTo(1.5);
  });

  test("a much higher estimate raises it, once, to the new estimate", () => {
    const t = new TimeLeft(0);
    expect(t.update(0.5, 2000)).toBeCloseTo(2);
    // The work stalled: at 6 s still 50% done, so 6 s are left, not the 0 s the countdown reached.
    expect(t.update(0.5, 6000)).toBeCloseTo(6);
    expect(t.update(0.5, 6100)).toBeCloseTo(5.9);
  });

  test("a higher estimate within one second of the shown value is not taken", () => {
    const t = new TimeLeft(0);
    expect(t.update(0.9, 1000)).toBeCloseTo(0.111, 2);
    expect(t.update(0.9, 1500)).toBe(0); // the estimate is 0.17 s; the countdown reached 0, and 0.17 is within a second
  });

  test("a lower estimate is taken at once, and done is zero", () => {
    const t = new TimeLeft(0);
    expect(t.update(0.1, 1000)).toBeCloseTo(9);
    expect(t.update(0.5, 1100)).toBeCloseTo(1.1);
    expect(t.update(1, 1200)).toBe(0);
  });

  test("the words never claim more precision than the estimate has", () => {
    expect(timeLeftText(null)).toBe("estimating the time left…");
    expect(timeLeftText(0)).toBe("less than a second left");
    expect(timeLeftText(0.99)).toBe("less than a second left");
    expect(timeLeftText(3.4)).toBe("about 3 s left");
    expect(timeLeftText(59.4)).toBe("about 59 s left");
    expect(timeLeftText(200)).toBe("about 3 min left");
  });
});
