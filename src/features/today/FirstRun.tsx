import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { GraduationCap, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader } from "@/components/ui/card";
import { PROFILES } from "../../domain/language";
import type { Course, StoredModule } from "../../domain/types";
import { coursePhase, installCourse, subscribeInstall } from "../../content/client";
import { holdUpdate } from "../../app/auto-update";
import { useCatalog, useCatalogPhase, useCoursePhase, useCourses } from "../../shared/store";
import type { StoredCatalogEntry } from "../../storage/db";
import { ShareCourseButton } from "../../shared/ShareCourseButton";
import ui from "../../shared/ui.module.css";
import { withCount } from "../../shared/format";
import { courseOffers, groupByLanguage, type CourseOfferView } from "./course-offers";

export const OFFLINE_HINT = "Уроки загрузятся на устройство и будут доступны без сети.";

/**
 * Карточки курсов каталога. Пока ставится первый урок одного курса, «Учить курс» у других недоступна: так курс,
 * нажатый первым, первым встаёт в порядок курсов и становится основным и домашним.
 */
export function FirstRun({
  courses,
  entries,
  modules,
  hint = true,
  grouped = true,
  focus,
  onFocused,
  show,
  intro,
}: {
  courses: Course[];
  entries: StoredCatalogEntry[];
  modules: StoredModule[];
  /** Первый экран «Сегодня»: единственный курс становится заголовком экрана, у нескольких — общий заголовок. */
  intro?: boolean;
  /** Подсказка под кнопкой; стартовый экран пишет её один раз под подзаголовком. */
  hint?: boolean;
  /** Карточки под заголовком языка; на «Курсе» язык уже выбран — карточки без группы. */
  grouped?: boolean;
  /** Курс, карточку которого показать и сфокусировать. */
  focus?: string;
  onFocused?: () => void;
  /** Ожидание первого урока другого курса учитывается и для скрытых карточек. */
  show?: string;
}) {
  const offers = courseOffers(courses, entries, modules);
  const catalog = useCatalogPhase();
  const loading = useSyncExternalStore(
    subscribeInstall,
    () => offers.find((offer) => coursePhase(offer.course.id).phase === "loading")?.course.id,
  );
  const waiting = !offers.length && catalog !== "error";
  const slow = useSlow(waiting);
  if (waiting && !slow)
    return (
      <p className="sr-only" role="status">
        Загружаем курсы
      </p>
    );
  if (!offers.length)
    return (
      <Card className="mb-3 bg-soft ring-0">
        <CardHeader>
          <p className="m-0 text-xl font-bold">Каталог ещё не загружен</p>
          <CardDescription className="text-foreground/75">Проверьте сеть — курс появится сам.</CardDescription>
        </CardHeader>
      </Card>
    );
  const busy = offers.find((offer) => offer.course.id === loading);
  const first = offers.find((offer) => offer.ready);
  if (intro && offers.length === 1 && first)
    return (
      <>
        <CourseIntro offer={first} />
        <CourseOffer offer={first} level={2} main hint={false} labelledBy="today-title" />
      </>
    );
  if (intro)
    return (
      <>
        <h1 data-testid="today-title">Выберите курс</h1>
        <p className="mb-1 text-muted-foreground">
          Курсы языков с уроками по программе и ежедневным повторением карточек
        </p>
        <p className="mt-0 mb-6 text-sm text-muted-foreground">{OFFLINE_HINT}</p>
        <FirstRun courses={courses} entries={entries} modules={modules} hint={false} />
      </>
    );
  const shown = show ? offers.filter((offer) => offer.course.id === show) : offers;
  const card = (offer: CourseOfferView, level: 2 | 3) => (
    <CourseOffer
      key={offer.course.id}
      offer={offer}
      level={level}
      main={offer === first}
      hint={hint}
      waitFor={busy !== offer ? busy : undefined}
      focused={offer.course.id === focus}
      onFocused={onFocused}
    />
  );
  if (!grouped) return <>{shown.map((offer) => card(offer, 2))}</>;
  return (
    <>
      {groupByLanguage(offers).map((group) =>
        group.offers.length < 2 ? (
          card(group.offers[0], 2)
        ) : (
          <section
            key={group.language}
            aria-labelledby={`courses-${group.language}`}
            data-testid={`courses-${group.language}`}
          >
            <h2 id={`courses-${group.language}`} className="mt-0 mb-3 text-lg font-bold">
              {PROFILES[group.language].names.title}
            </h2>
            {group.offers.map((offer) => card(offer, 3))}
          </section>
        ),
      )}
    </>
  );
}

/** Греческие слова в русской строке («экзамен ΚΕΓ») читалка и шрифт должны получить как греческие. */
function withGreek(text: string) {
  return text.split(/([Ͱ-Ͽἀ-῿]+)/u).map((part, index) =>
    index % 2 ? (
      <span key={index} lang="el">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

function CourseOffer({
  offer,
  level,
  main,
  hint,
  waitFor,
  focused,
  onFocused,
  labelledBy,
}: {
  offer: CourseOfferView;
  level: 2 | 3;
  main: boolean;
  hint: boolean;
  waitFor?: CourseOfferView;
  focused?: boolean;
  onFocused?: () => void;
  /** Курс уже назван заголовком экрана: карточки нет. */
  labelledBy?: string;
}) {
  const { course } = offer;
  const article = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!focused) return;
    article.current?.scrollIntoView({ block: "center" });
    article.current?.focus({ preventScroll: true });
    onFocused?.();
  }, [focused, onFocused]);
  const phase = useCoursePhase(course.id);
  const loading = phase.phase === "loading";
  const blocked = loading || !!waitFor;
  const learn = () => {
    if (blocked) return;
    void holdUpdate(installCourse(course.id)).catch(() => undefined);
  };
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <article
      ref={article}
      tabIndex={-1}
      className="mb-6"
      data-testid="course-offer"
      aria-labelledby={labelledBy ?? `offer-${course.id}`}
    >
      {labelledBy ? null : (
        <Card className="mb-3 bg-soft ring-0" data-testid="first-course">
          <CardHeader>
            <Heading id={`offer-${course.id}`} className="m-0 text-xl leading-snug font-bold [overflow-wrap:anywhere]">
              {offer.title}
            </Heading>
            {offer.goal ? <CardDescription className="text-foreground">{withGreek(offer.goal)}</CardDescription> : null}
            <CardDescription className="text-foreground/75">{offer.volume}</CardDescription>
          </CardHeader>
        </Card>
      )}
      {!offer.ready ? (
        <p className={ui.note} data-testid="course-preparing">
          Готовится
        </p>
      ) : (
        <>
          <Button
            size="xl"
            variant={main ? "default" : "soft"}
            onClick={learn}
            aria-disabled={blocked || undefined}
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            aria-label={loading ? `Загружаем курс «${course.title}»…` : `Учить курс «${course.title}»`}
            aria-describedby={waitFor ? `wait-${course.id}` : undefined}
          >
            <GraduationCap data-icon="inline-start" />
            {loading ? "Загружаем курс…" : "Учить курс"}
          </Button>
          <p className="sr-only" role="status">
            {loading ? `Загружаем курс «${course.title}»` : ""}
          </p>
          {phase.phase === "error" ? (
            <div className="mt-2">
              <p className={ui.error} role="alert" data-testid="course-error">
                {phase.message}
              </p>
              <Button size="md" variant="quiet" onClick={learn}>
                <RefreshCw data-icon="inline-start" />
                Повторить
              </Button>
            </div>
          ) : waitFor ? (
            <p className={ui.hint} id={`wait-${course.id}`}>
              Сначала загрузится «{waitFor.course.title}»
            </p>
          ) : hint ? (
            <p className={ui.hint}>{OFFLINE_HINT}</p>
          ) : null}
          <div className="flex justify-center">
            <ShareCourseButton course={course} />
          </div>
        </>
      )}
    </article>
  );
}

const CHECKPOINTS: [string, string, string] = ["контрольная точка", "контрольные точки", "контрольных точек"];

function CourseIntro({ offer }: { offer: CourseOfferView }) {
  const profile = PROFILES[offer.language];
  const checkpoints = offer.course.calendar?.checkpoints.length ?? 0;
  const { goal, entry, pace } = offer.course;
  const lede = [goal && `${goal}.`, entry].filter(Boolean).join(" ");
  const facts: [string, string][] = [
    ["Программа", checkpoints ? `${offer.volume} и ${withCount(checkpoints, CHECKPOINTS)}` : offer.volume],
    ...(pace ? [["Время", pace] as [string, string]] : []),
    [
      "Звук",
      `Слова и диалоги записаны. Формы глаголов читает синтез речи: без ${profile.voiceName} на устройстве их не слышно.`,
    ],
    ["Без сети", "Уроки сохраняются на устройство и открываются без сети."],
  ];
  return (
    <>
      <h1 id="today-title" data-testid="today-title" className="[overflow-wrap:anywhere]">
        {offer.title}
      </h1>
      {lede ? <p className="mt-0 mb-6 text-lg leading-[1.5] text-foreground">{withGreek(lede)}</p> : null}
      <dl className="mt-0 mb-6 border-t border-input" data-testid="course-intro">
        {facts.map(([term, text]) => (
          <div key={term} className="grid grid-cols-[5.75rem_1fr] gap-x-3 border-b border-input py-3">
            <dt className="text-[12.5px] leading-6 font-semibold text-muted-foreground">{term}</dt>
            <dd className="m-0 font-serif text-base leading-6 text-foreground">{text}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

/** Зависший без тайм-аута запрос каталога не должен оставлять пустой экран: через время — совет проверить сеть. */
function useSlow(waiting: boolean, ms = 8000) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!waiting) return setSlow(false);
    const timer = setTimeout(() => setSlow(true), ms);
    return () => clearTimeout(timer);
  }, [waiting, ms]);
  return slow;
}

/** Начало курса там, где каталог есть, а уроков курса на устройстве ещё нет: на полке — курсов языка, в модуле — одного. */
export function CourseStart({
  courseIds,
  hint = true,
  grouped,
  focus,
  onFocused,
  show,
  intro,
}: {
  courseIds?: string[];
  intro?: boolean;
  hint?: boolean;
  grouped?: boolean;
  focus?: string;
  onFocused?: () => void;
  show?: string;
}) {
  const courses = useCourses();
  const catalog = useCatalog();
  if (!courses || !catalog) return null;
  const offered = courses.filter((course) => !courseIds || courseIds.includes(course.id));
  return (
    <FirstRun
      courses={offered}
      entries={catalog.entries}
      modules={catalog.modules}
      hint={hint}
      grouped={grouped}
      focus={focus}
      onFocused={onFocused}
      show={show}
      intro={intro}
    />
  );
}
