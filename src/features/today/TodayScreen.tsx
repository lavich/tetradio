import { ArrowRight, CalendarDays, ChevronRight, Dumbbell } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "cn";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ItemGroup } from "@/components/ui/item";
import { Screen } from "../../app/Screen";
import { localDay } from "../../domain/learning";
import { byTargetDate, preparedByCourse } from "../../domain/schedule";
import { useAction } from "../../shared/action";
import { useNow } from "../../shared/clock";
import { CARDS, dativeWeekday, dayMonth, DAYS, lessonIn, shortTitle, withCount } from "../../shared/format";
import { useActiveSession, useCatalog, useCourses, useLessons, usePlan, useSettings } from "../../shared/store";
import { startSession } from "../learning/session-actions";
import { LessonProgressBar, LessonRow } from "../lessons/LessonRow";
import { nextLessonIds } from "../lessons/courses";
import { dexieSource } from "../../storage/queries";
import { DayNotes } from "./DayNotes";
import { FirstRun } from "./FirstRun";
import ui from "../../shared/ui.module.css";

export function TodayScreen() {
  const { settings } = useSettings();
  const now = useNow();
  const navigate = useNavigate();
  const { busy, problem, setProblem, run } = useAction("Не удалось начать занятие");
  const plan = usePlan(now);
  const installed = useLessons(true);
  const unfinished = useActiveSession();
  const catalog = useCatalog();
  const courses = useCourses();
  const ready = !!plan && !!installed && unfinished !== undefined;
  const next = plan?.deadlines[0];
  const lesson = next && installed?.find((item) => item.id === next.lessonId);
  const today = localDay(now, settings.timezone);
  const nextIds = nextLessonIds(installed ?? [], preparedByCourse(courses ?? [], now, settings.timezone));
  const lessons = [...(installed ?? [])].sort(byTargetDate);
  // Полный список живёт на «Уроках»; здесь — последнее проведённое занятие и ближайшие других курсов.
  // Ближайшее занятие плана показано панелью выше и строкой не повторяется.
  const last = lessons
    .filter((item) => item.status === "completed" && item.targetDate && item.targetDate <= today)
    .at(-1);
  const around = [...(last ? [last] : []), ...lessons.filter((item) => nextIds.has(item.id) && item.id !== lesson?.id)];
  // Очередь пуста: план дня выполнен или карточки ещё не подошли. Вместо «Начать занятие» — тренировка урока.
  const idle = !!plan && !unfinished && !plan.newRefs.length && !plan.reviews.length && !plan.preview.length;
  const drill = lesson ?? last ?? lessons[0];

  const multi = (plan?.courses ?? []).filter((item) => item.newRefs.length);
  const split =
    multi.length > 1 && multi.map((item) => `${shortTitle(item.title)}: ${item.newRefs.length}`).join(" · ");

  // Подготовка к занятию идёт сверх плана; отдельной строкой — только когда заголовок называет план, а не её.
  const extra = !!plan?.preview.length && !!(plan.newRefs.length || plan.reviews.length);

  /** Заголовок называет объём дня, а не девиз: что ждёт в занятии, если начать его сейчас. */
  const headline = () => {
    if (!plan || !installed || unfinished === undefined) return "Сегодня";
    if (unfinished) return "Занятие не закончено";
    if (!installed.length) return "Начните с курса";
    const fresh = plan.newRefs.length;
    const reviews = plan.reviews.length;
    if (fresh && reviews)
      return `${withCount(fresh, ["новая", "новые", "новых"])} и ${withCount(reviews, ["повторение", "повторения", "повторений"])}`;
    if (fresh) return withCount(fresh, ["новая карточка", "новые карточки", "новых карточек"]);
    if (reviews) return withCount(reviews, ["повторение", "повторения", "повторений"]);
    if (plan.preview.length)
      return withCount(plan.preview.length, [
        "карточка для подготовки",
        "карточки для подготовки",
        "карточек для подготовки",
      ]);
    return "На сегодня всё";
  };

  const begin = () =>
    run(async () => {
      if (unfinished) return navigate("/session");
      const session = await startSession(now);
      if (!session)
        return setProblem(
          "На сегодня очередь пуста. Можно потренировать карточки вручную на экране урока или слово в разделе «Слова».",
        );
      void navigate("/session");
    });

  // Ручная тренировка идёт в режиме practice: навык фиксируется, интервалы не сдвигаются.
  const practice = () =>
    run(async () => {
      if (!drill) return;
      const refs = await dexieSource().lessonRefs(drill.id);
      const session = refs.length ? await startSession(now, { refs, mode: "practice" }) : null;
      if (!session) return setProblem("В уроке нет доступных заданий.");
      void navigate("/session");
    });

  // Пока план читается, панель и кнопка — заглушками: иначе на миг мелькает «Занятие не назначено».
  if (!ready)
    return (
      <Screen>
        <h1 data-testid="today-title">{headline()}</h1>
        <div aria-busy="true" aria-label="План дня загружается" className="grid gap-3">
          <Skeleton className="h-[150px] rounded-[var(--radius-card)] motion-reduce:animate-none" />
          <Skeleton className="h-[54px] rounded-[14px] motion-reduce:animate-none" />
        </div>
      </Screen>
    );

  if (!installed.length)
    return (
      <Screen>
        <h1 data-testid="today-title">{headline()}</h1>
        <FirstRun courses={courses ?? []} entries={catalog?.entries ?? []} />
      </Screen>
    );

  return (
    <Screen>
      <h1 data-testid="today-title">{headline()}</h1>
      {plan && (split || extra) && (
        <p className={`${ui.note} -mt-3 mb-4`}>
          {split && <span data-testid="new-by-course">{split}</span>}
          {split && extra && " · "}
          {extra && (
            <span data-testid="preview-count">
              {plan.courses
                .filter((item) => item.preview.length)
                .map(
                  (item) =>
                    `ещё ${withCount(item.preview.length, CARDS)} для подготовки к ${lessonIn(item.deadlines[0]!.title, "уроку")}`,
                )
                .join(" · ")
                .replace(/^е/, split ? "е" : "Е")}
            </span>
          )}
        </p>
      )}

      {next && lesson ? (
        <Link to={`/lessons/${lesson.id}`} className="mb-3 block rounded-[var(--radius-card)] no-underline">
          <Card className="bg-soft ring-0 transition-colors hover:bg-[color-mix(in_srgb,var(--soft),var(--primary)_6%)]">
            {/* Стрелка стоит рядом с текстом явно, а не авторасстановкой сетки: WebKit в Telegram клал её отдельной строкой. */}
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="grid min-w-0 flex-1 gap-1">
                  <CardDescription className="flex items-center gap-2 text-accent-foreground">
                    <CalendarDays />
                    {next.daysLeft === 0
                      ? "Занятие сегодня"
                      : `К ${dativeWeekday(next.targetDate)}, ${dayMonth(next.targetDate)}`}
                  </CardDescription>
                  <CardTitle className="text-2xl font-bold [overflow-wrap:anywhere]">{lesson.title}</CardTitle>
                  <CardDescription className="text-foreground/75">
                    {withCount(next.newLeft, CARDS)} ·{" "}
                    {next.daysLeft === 0 ? "сегодня день занятия" : `${withCount(next.daysLeft, DAYS)} на подготовку`}
                  </CardDescription>
                </div>
                <ChevronRight className="shrink-0 text-accent-foreground" />
              </div>
              {!!lesson.cardCount && lesson.progress && <LessonProgressBar progress={lesson.progress} />}
            </CardHeader>
          </Card>
        </Link>
      ) : (
        <Link to="/lessons" className="mb-3 block rounded-[var(--radius-card)] no-underline">
          <Card className="bg-soft ring-0 transition-colors hover:bg-[color-mix(in_srgb,var(--soft),var(--primary)_6%)]">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="grid min-w-0 flex-1 gap-1">
                  <CardTitle className="text-xl font-bold">Занятие не назначено</CardTitle>
                  <CardDescription className="text-foreground/75">
                    Задайте расписание на экране «Уроки», и план распределит карточки по дням занятий.
                  </CardDescription>
                </div>
                <ChevronRight className="shrink-0 text-accent-foreground" />
              </div>
            </CardHeader>
          </Card>
        </Link>
      )}

      {idle && drill ? (
        <>
          <p className={`${ui.note} mb-2.5`} data-testid="day-done">
            План на сегодня выполнен. Тренировка урока не сдвигает интервалы повторений.
          </p>
          <Button size="xl" variant="soft" onClick={practice} disabled={busy}>
            <Dumbbell data-icon="inline-start" />
            Потренировать {lessonIn(drill.title, "урок")}
          </Button>
        </>
      ) : (
        <Button size="xl" onClick={begin} disabled={busy || !ready}>
          {unfinished ? "Продолжить занятие" : "Начать занятие"}
          <ArrowRight data-icon="inline-end" />
        </Button>
      )}
      {problem && (
        <p className={ui.error} role="alert">
          {problem}
        </p>
      )}
      {plan && <DayNotes plan={plan} now={now} />}

      {!!around.length && <h2>Мои занятия</h2>}
      {!!around.length && (
        <ItemGroup className="gap-2.5">
          {around.map((item) => (
            <LessonRow key={item.id} lesson={item} next={nextIds.has(item.id)} />
          ))}
        </ItemGroup>
      )}
      {!!lessons.length && (
        <Link to="/lessons" className={cn(buttonVariants({ variant: "soft", size: "md" }), "mt-2.5")}>
          Все уроки · {lessons.length}
          <ChevronRight data-icon="inline-end" />
        </Link>
      )}
    </Screen>
  );
}
