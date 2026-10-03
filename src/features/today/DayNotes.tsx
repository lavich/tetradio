import { ChevronDown } from "lucide-react";
import type { DailyPlan } from "../../domain/learning";
import { withCount } from "../../shared/format";
import ui from "../../shared/ui.module.css";

const GENITIVE_CARDS: [string, string, string] = ["карточки", "карточек", "карточек"];

export function DayNotes({ plan }: { plan: DailyPlan }) {
  if (!plan.unavailable.length) return null;
  return (
    <div className="mt-4 grid gap-2.5">
      <Note
        testId="unavailable"
        summary={`У ${withCount(plan.unavailable.length, GENITIVE_CARDS)} нет доступного упражнения`}
      >
        У них нет перевода и озвучки; дневной предел они не занимают.
      </Note>
    </div>
  );
}

/** Справка в одну строку: подробность раскрывается по нажатию, как в `<details>`, и остаётся доступной с клавиатуры. */
function Note({ testId, summary, children }: { testId: string; summary: string; children: React.ReactNode }) {
  return (
    <details className="group" data-testid={testId}>
      <summary
        className={`${ui.note} flex cursor-pointer list-none items-center gap-1.5 [&::-webkit-details-marker]:hidden`}
      >
        {summary}
        <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <p className={`${ui.note} mt-1`}>{children}</p>
    </details>
  );
}
