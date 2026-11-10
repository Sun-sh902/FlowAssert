/**
 * The time a running check has left, as the page shows it (docs/design/1.0-browser.md): an estimate from the share of
 * the work done and the time it took, and nothing more certain than that.
 *
 * Nothing is shown for the first half second or before 2% of the work is done: there is no basis yet. After that the
 * shown value counts down with the clock. A new estimate that is lower replaces it; one that is higher replaces it
 * only when it exceeds the shown value by more than a quarter and by more than a second, so the value never jumps
 * backwards by more than it has to.
 */
export const ETA_MIN_ELAPSED_MS = 500;
export const ETA_MIN_FRACTION = 0.02;

export class TimeLeft {
  private readonly started: number;
  private shown: number | null = null;
  private shownAt = 0;

  /** `now` is a clock in milliseconds that never goes back (performance.now). */
  constructor(now: number) {
    this.started = now;
  }

  /** The seconds left to show when `fraction` (0 to 1) of the work is done, or null while there is no basis. */
  update(fraction: number, now: number): number | null {
    const elapsed = now - this.started;
    if (elapsed < ETA_MIN_ELAPSED_MS || !(fraction >= ETA_MIN_FRACTION)) return this.shown === null ? null : this.counted(now);
    const estimate = fraction >= 1 ? 0 : (elapsed * (1 - fraction)) / fraction / 1000;
    const counted = this.shown === null ? null : this.counted(now);
    if (counted === null || estimate < counted || (estimate > counted * 1.25 && estimate - counted > 1)) {
      this.shown = estimate;
      this.shownAt = now;
      return estimate;
    }
    return counted;
  }

  private counted(now: number): number {
    return Math.max(0, this.shown! - (now - this.shownAt) / 1000);
  }
}

/** The words for a time left: whole seconds below a minute, whole minutes above; never a false precision. */
export function timeLeftText(seconds: number | null): string {
  if (seconds === null) return "estimating the time left…";
  if (seconds < 1) return "less than a second left";
  if (seconds < 60) return `about ${Math.round(seconds)} s left`;
  return `about ${Math.round(seconds / 60)} min left`;
}
