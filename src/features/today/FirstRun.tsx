import { useEffect, useRef, useSyncExternalStore } from "react";
import { GraduationCap, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader } from "@/components/ui/card";
import { PROFILES } from "../../domain/language";
import type { Course, StoredModule } from "../../domain/types";
import { coursePhase, installCourse, subscribeInstall } from "../../content/client";
import { holdUpdate } from "../../app/auto-update";
import { useCatalog, useCoursePhase, useCourses } from "../../shared/store";
import type { StoredCatalogEntry } from "../../storage/db";
import { ShareCourseButton } from "../../shared/ShareCourseButton";
import ui from "../../shared/ui.module.css";
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
}: {
  courses: Course[];
  entries: StoredCatalogEntry[];
  modules: StoredModule[];
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
  const loading = useSyncExternalStore(
    subscribeInstall,
    () => offers.find((offer) => coursePhase(offer.course.id).phase === "loading")?.course.id,
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
}: {
  offer: CourseOfferView;
  level: 2 | 3;
  main: boolean;
  hint: boolean;
  waitFor?: CourseOfferView;
  focused: boolean;
  onFocused?: () => void;
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
      aria-labelledby={`offer-${course.id}`}
    >
      <Card className="mb-3 bg-soft ring-0" data-testid="first-course">
        <CardHeader>
          <Heading id={`offer-${course.id}`} className="m-0 text-xl leading-snug font-bold [overflow-wrap:anywhere]">
            {offer.title}
          </Heading>
          {offer.goal ? <CardDescription className="text-foreground">{withGreek(offer.goal)}</CardDescription> : null}
          <CardDescription className="text-foreground/75">{offer.volume}</CardDescription>
        </CardHeader>
      </Card>
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

/** Начало курса там, где каталог есть, а уроков курса на устройстве ещё нет: на полке — курсов языка, в модуле — одного. */
export function CourseStart({
  courseIds,
  hint = true,
  grouped,
  focus,
  onFocused,
  show,
}: {
  courseIds?: string[];
  hint?: boolean;
  grouped?: boolean;
  focus?: string;
  onFocused?: () => void;
  show?: string;
}) {
  const courses = useCourses();
  const catalog = useCatalog();
  const offered = (courses ?? []).filter((course) => !courseIds || courseIds.includes(course.id));
  return (
    <FirstRun
      courses={offered}
      entries={catalog?.entries ?? []}
      modules={catalog?.modules ?? []}
      hint={hint}
      grouped={grouped}
      focus={focus}
      onFocused={onFocused}
      show={show}
    />
  );
}
