import { useState } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { Link } from "react-router-dom";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "cn";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { DailyPlan } from "../../domain/learning";
import { CARDS, LESSONS, lessonIn, withCount } from "../../shared/format";
import { saveCourseTempo } from "../../storage/ops";
import ui from "../../shared/ui.module.css";

/** Предел курса задаётся на «Уроках» от 0 до 100; кнопка на «Сегодня» не выходит за те же границы. */
const MAX_PER_DAY = 100;
const GENITIVE_CARDS: [string, string, string] = ["карточки", "карточек", "карточек"];

/**
 * Всё, что уточняет план дня, идёт под кнопкой занятия, а не перед ней. Нехватка предела — решение
 * с действием на месте; хвост прошлых занятий и карточки без упражнения — справка, свёрнутая в одну строку.
 */
export function DayNotes({ plan, now }: { plan: DailyPlan; now: Date }) {
  const short = plan.courses.filter((item) => item.shortfall);
  if (!short.length && !plan.backlog.lessons && !plan.unavailable.length) return null;
  return (
    <div className="mt-4 grid gap-2.5">
      {short.map((item) => {
        const tight = item.deadlines.reduce((max, deadline) =>
          deadline.requiredPerDay > max.requiredPerDay ? deadline : max,
        );
        return (
          <Shortfall
            key={item.courseId}
            courseId={item.courseId}
            courseTitle={item.title}
            limit={item.newItemsPerDay}
            required={item.requiredPerDay}
            lessonId={tight.lessonId}
            lessonTitle={tight.title}
            now={now}
          />
        );
      })}
      {!!plan.backlog.lessons && (
        <Note
          testId="backlog"
          summary={`${withCount(plan.backlog.refs.length, CARDS)} из ${withCount(plan.backlog.lessons, LESSONS)} ещё не показаны`}
        >
          Они придут в новых карточках после карточек ближайшего занятия: подготовка к нему идёт первой.
        </Note>
      )}
      {!!plan.unavailable.length && (
        <Note
          testId="unavailable"
          summary={`У ${withCount(plan.unavailable.length, GENITIVE_CARDS)} нет доступного упражнения`}
        >
          У них нет перевода и озвучки. Их можно посмотреть на экране урока; дневной предел они не занимают.
        </Note>
      )}
    </div>
  );
}

function Shortfall(props: {
  courseId: string;
  courseTitle: string;
  limit: number;
  required: number;
  lessonId: string;
  lessonTitle: string;
  now: Date;
}) {
  const [saving, setSaving] = useState(false);
  const target = Math.min(props.required, MAX_PER_DAY);
  const raise = async () => {
    setSaving(true);
    try {
      await saveCourseTempo(props.courseId, { newItemsPerDay: target }, props.now);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Card size="sm" data-testid="shortfall">
      <CardHeader>
        <CardTitle className="text-balance">
          Чтобы успеть к сроку, нужно {withCount(props.required, CARDS)} в день
        </CardTitle>
        <CardDescription>
          Дневной предел курса «{props.courseTitle}» — {props.limit}.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {target > props.limit && (
          <Button size="md" variant="soft" className="w-auto" onClick={raise} disabled={saving}>
            {saving ? "Сохраняем…" : `Поднять предел до ${target}`}
          </Button>
        )}
        <Link
          to={`/lessons/${props.lessonId}`}
          className={cn(buttonVariants({ variant: "quiet", size: "md" }), "w-auto")}
        >
          <CalendarDays data-icon="inline-start" />
          Перенести дату {lessonIn(props.lessonTitle, "урока")}
        </Link>
      </CardContent>
    </Card>
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
