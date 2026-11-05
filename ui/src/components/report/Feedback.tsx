/**
 * "Give feedback": a plain link to the trial feedback form on GitHub (.github/ISSUE_TEMPLATE/trial_feedback.yml, or its
 * Chinese copy trial_feedback_zh-CN.yml in the Chinese interface), opened
 * in a new tab only when the person presses it. Its address names the template and nothing else: no file, value,
 * column, premise or report of this page goes with it, and the page itself sends nothing.
 */
import { MessageSquare } from "lucide-react";
import { useLocale } from "../../i18n/locale";
import { cn } from "../../lib/cn";
import { buttonClass } from "../ui/primitives";

export const FEEDBACK_URL = "https://github.com/Sun-sh902/FlowAssert/issues/new?template=trial_feedback.yml";
export const FEEDBACK_URL_ZH = "https://github.com/Sun-sh902/FlowAssert/issues/new?template=trial_feedback_zh-CN.yml";

export function FeedbackLink({ className }: { className?: string }) {
  const href = useLocale() === "zh-CN" ? FEEDBACK_URL_ZH : FEEDBACK_URL;
  return (
    <div className={cn("rounded-md border border-line px-4 py-3 text-sm text-ink-2", className)}>
      <p className="font-semibold text-ink">Tried it? Tell us</p>
      <p className="mt-0.5 text-xs leading-[1.5] text-ink-3">The form opens on GitHub in a new tab, and is public. Nothing from this page goes with it: do not paste real data, keys, values or reports.</p>
      <a href={href} target="_blank" rel="noopener noreferrer" className={cn(buttonClass("default", "sm"), "mt-2")} data-testid="give-feedback">
        <MessageSquare size={13} aria-hidden />
        Give feedback
        <span className="sr-only"> (opens GitHub in a new tab)</span>
      </a>
    </div>
  );
}
