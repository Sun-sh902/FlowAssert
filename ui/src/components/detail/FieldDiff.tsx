/**
 * Highlights the differing middle segment between two strings (common prefix/suffix kept plain).
 * Purely visual; the verdict comes from the evaluator's exact comparison, not from this.
 */
export function splitDiff(a: string, b: string): { pre: string; a: string; b: string; post: string } {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let j = 0;
  while (j < a.length - i && j < b.length - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
  return { pre: a.slice(0, i), a: a.slice(i, a.length - j), b: b.slice(i, b.length - j), post: a.slice(a.length - j) };
}

/** Allow long values (emails) to wrap after "@" instead of mid-word. */
function breakable(text: string) {
  const parts = text.split("@");
  return parts.map((part, i) => (
    <span key={i}>
      {i > 0 && "@"}
      {i > 0 && <wbr />}
      {part}
    </span>
  ));
}

export function DiffValue({
  value,
  other,
  side,
}: {
  value: string | null;
  other: string | null;
  side: "source" | "destination";
}) {
  if (value === null) return <span className="font-sans text-xs text-ink-3 italic">no value observed</span>;
  if (value === "") return <mark className="font-sans text-xs italic">empty string</mark>;
  if (other === null || other === value) return <span>{breakable(value)}</span>;
  const d = splitDiff(side === "source" ? value : other, side === "source" ? other : value);
  const mid = side === "source" ? d.a : d.b;
  return (
    <span>
      {breakable(d.pre)}
      {mid && (
        <mark>
          {breakable(mid)}
        </mark>
      )}
      {breakable(d.post)}
    </span>
  );
}
