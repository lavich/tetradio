import { ChartNoAxesColumn } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Screen } from "../../app/Screen";
import { SKILL_NAMES } from "../../domain/stats";
import { useNow } from "../../shared/clock";
import { CARDS, dayMonth, PHRASES, withCount, WORDS } from "../../shared/format";
import { StatTile } from "../../shared/StatTile";
import { useStats } from "../../shared/store";
import ui from "../../shared/ui.module.css";

/** Провал — переход карточки в переучивание; формы нужны только этому разделу. */
const LAPSES: [string, string, string] = ["провал", "провала", "провалов"];

export function StatsScreen() {
  const now = useNow();
  const stats = useStats(now);
  if (!stats) return <Screen back="Статистика" />;
  const peak = Math.max(1, ...stats.days.map((day) => day.answers));
  return (
    <Screen back="Статистика">
      {stats.totals.answers === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ChartNoAxesColumn />
            </EmptyMedia>
            <EmptyTitle>Ответов пока нет</EmptyTitle>
            <EmptyDescription>Статистика появится после первого занятия.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      <h2 className="mt-0">Последние 7 дней</h2>
      <Card className="mb-3">
        <CardContent className="flex flex-col gap-2.5">
          {stats.days.map((day) => (
            <div key={day.date} className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-sm">
                <span>{dayMonth(day.date)}</span>
                <span className="text-muted-foreground">
                  {day.answers} отв. · {day.cards} карт.
                </span>
              </div>
              <Progress value={(day.answers / peak) * 100} className="h-2.5" />
            </div>
          ))}
        </CardContent>
      </Card>

      <h2>Сроки повторений</h2>
      <div className={ui.tiles}>
        <StatTile value={stats.due.today} label="готовы сегодня" />
        <StatTile value={stats.due.week} label="в ближайшую неделю" />
      </div>

      <h2>Состояние карточек</h2>
      <Card className="mb-3">
        <CardContent className="flex flex-col gap-1.5">
          {(
            [
              ["Не начаты", stats.groups.fresh],
              ["В изучении", stats.groups.learning],
              ["На повторении", stats.groups.review],
              ["Закреплены (интервал от 21 дня)", stats.groups.solid],
            ] as const
          ).map(([label, value]) => (
            <p key={label} className="m-0 flex items-center justify-between">
              <span>{label}</span>
              <b>{value}</b>
            </p>
          ))}
        </CardContent>
      </Card>

      {stats.leeches.length > 0 && (
        <>
          <h2>Не даётся</h2>
          <Card className="mb-3">
            <CardContent className="flex flex-col gap-1.5">
              {stats.leeches.map((leech) => (
                <p key={leech.unitKey} className="m-0 flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate">{leech.label}</span>
                  <b className="shrink-0 text-muted-foreground">{withCount(leech.lapses, LAPSES)}</b>
                </p>
              ))}
              <p className="m-0 text-sm text-muted-foreground">
                Эти карточки вы забывали чаще всего. Из программы они не убраны: возможно, их стоит переформулировать
                или разобрать отдельно.
              </p>
            </CardContent>
          </Card>
        </>
      )}

      <h2>Навыки</h2>
      <Card className="mb-3">
        <CardHeader>
          <CardTitle className="sr-only">Доля успешных ответов по навыкам</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2.5">
          {stats.skills.map((skill) => (
            <div key={skill.type} className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-sm">
                <span>{SKILL_NAMES[skill.type]}</span>
                <span className="text-muted-foreground">
                  {skill.rate === null
                    ? "Ещё не проверяли"
                    : `${Math.round(skill.rate * 100)}% из ${withCount(skill.attempts, ["попытки", "попыток", "попыток"])}`}
                </span>
              </div>
              <Progress value={(skill.rate ?? 0) * 100} className="h-2.5" />
            </div>
          ))}
          <p className="m-0 text-sm text-muted-foreground">
            Это доля успешных последних ответов по типу проверки, а не оценка вероятности запоминания или освоения
            грамматической темы.
          </p>
        </CardContent>
      </Card>

      <p className={ui.note}>
        Всего записано {withCount(stats.totals.answers, ["ответ", "ответа", "ответов"])} по{" "}
        {withCount(stats.totals.cards, CARDS)}
        {stats.totals.byKind.phrase
          ? ` (${withCount(stats.totals.byKind.word, WORDS)} · ${withCount(stats.totals.byKind.phrase, PHRASES)})`
          : ""}
        .
      </p>
    </Screen>
  );
}
