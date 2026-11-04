/**
 * In the Chinese interface, the Chinese explanation of a fixed English text (i18n/englishTexts.ts), shown next to the
 * text, which stays as the command line writes it. In English nothing is shown.
 */
import { glossOf, summaryGlosses } from "../../i18n/englishTexts";
import { useLocale } from "../../i18n/locale";
import { cn } from "../../lib/cn";

export function Gloss({ text, className }: { text: string; className?: string }) {
  const locale = useLocale();
  const gloss = locale === "zh-CN" ? glossOf(text) : null;
  if (!gloss) return null;
  return (
    <span lang="zh-CN" data-no-translate data-gloss={gloss.id} className={cn("mt-0.5 block text-[11.5px] leading-[1.5] font-normal text-ink-3", className)}>
      {gloss.zh}
    </span>
  );
}

/** What the lines of the printed summary mean, one line of each kind, beside the summary and never in it. */
export function SummaryGlosses({ summary }: { summary: string }) {
  const locale = useLocale();
  if (locale !== "zh-CN") return null;
  const lines = summaryGlosses(summary);
  if (!lines.length) return null;
  return (
    <div className="mt-3" data-testid="summary-glosses">
      <p className="text-xs font-semibold text-ink-2">What the summary lines mean. The summary stays as the command line writes it.</p>
      <dl className="mt-1 grid gap-1.5 text-xs" data-no-translate>
        {lines.map(({ line, zh }) => (
          <div key={line} className="min-w-0 border-t border-line-subtle pt-1.5">
            <dt lang="en" className="font-mono text-[11.5px] break-all whitespace-pre-wrap text-ink-2">
              {line.trim()}
            </dt>
            <dd lang="zh-CN" className="mt-0.5 text-ink-3">
              {zh}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
