/**
 * Text search over authoritative source fields (UIA-009).
 *
 * Fields the contract allows to be null — `workflow.n8n_label`, a row's `display_name` or `company` —
 * are skipped when null, never replaced by their display fallback. "Workflow label unavailable" is
 * presentation text; searching for it must not match a run whose label is null. An empty string is a
 * real value: it is searched (and matches only an empty query, which matches everything anyway).
 */

/** The query as compared: trimmed and lower-cased. An empty result means "no search". */
export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

/** True when any non-null field contains the normalized query. An empty query matches everything. */
export function matchesSearch(query: string, fields: readonly (string | null | undefined)[]): boolean {
  const needle = normalizeQuery(query);
  if (!needle) return true;
  return fields.some((v) => typeof v === "string" && v.toLowerCase().includes(needle));
}
