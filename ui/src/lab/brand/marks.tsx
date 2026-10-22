/**
 * Brand mark explorations. All marks are constructed vector geometry (no glyphs),
 * drawn on a 24-unit grid so they hold at 16px navigation size.
 */

interface MarkProps {
  size?: number;
  fg?: string;
  bg?: string;
  accent?: string;
  className?: string;
}

/** Current production mark (v0.2): the logical turnstile ⊢. */
export function MarkTurnstile({ size = 24, fg = "#f5f6f8", bg = "#16191e", accent = "#4865f0" }: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <rect width="24" height="24" rx="6.5" fill={bg} />
      <path d="M8.25 6.5v11" stroke={fg} strokeWidth="2.25" strokeLinecap="round" />
      <path d="M8.25 12h8" stroke={accent} strokeWidth="2.25" strokeLinecap="round" />
    </svg>
  );
}

/**
 * A — Calibration bracket. Two measuring corners frame an observation; the accent line is
 * the reading taken between them. Reads as an instrument reticle.
 */
export function MarkCalibration({ size = 24, fg = "#e8edf3", accent = "#8ab4ff", className }: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden className={className}>
      <path d="M3 8.5V3h5.5M21 15.5V21h-5.5" fill="none" stroke={fg} strokeWidth="2" strokeLinecap="square" />
      <path d="M7 12h10" stroke={accent} strokeWidth="2" strokeLinecap="round" />
      <path d="M12 9.5v5" stroke={accent} strokeWidth="1.25" strokeLinecap="round" opacity="0.55" />
    </svg>
  );
}

/**
 * B — Editorial monogram. A capital A whose crossbar extends past the letter as a ruled line:
 * the assertion drawn out of the word.
 */
export function MarkEditorial({ size = 24, fg = "#1c1b19", accent = "#c2410c" }: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden>
      <path d="M3.5 20 9.5 4h1L16.5 20" fill="none" stroke={fg} strokeWidth="2" strokeLinejoin="round" />
      <path d="M6.2 13.6H22" stroke={accent} strokeWidth="2" strokeLinecap="square" />
    </svg>
  );
}

/**
 * C — Evidence trace. An open source node and a solid destination node joined by a trace,
 * crossed by the assertion tick where the comparison happens.
 */
export function MarkTrace({ size = 24, fg = "#1d1b16", accent = "#2f3590", className }: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden className={className}>
      <rect x="2.75" y="8.75" width="6.5" height="6.5" rx="1" fill="none" stroke={fg} strokeWidth="1.75" />
      <rect x="15" y="8.5" width="7" height="7" rx="1.25" fill={fg} />
      <path d="M9.5 12h5.5" stroke={fg} strokeWidth="1.75" />
      <path d="M12.25 6.5v11" stroke={accent} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
