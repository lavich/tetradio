import { useSyncExternalStore } from "react";
import { GraduationCap, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PROFILES } from "../../domain/language";
import type { Course, StoredModule } from "../../domain/types";
import { coursePhase, installCourse, subscribeInstall } from "../../content/client";
import { holdUpdate } from "../../app/auto-update";
import { useCatalog, useCoursePhase, useCourses } from "../../shared/store";
import type { StoredCatalogEntry } from "../../storage/db";
import ui from "../../shared/ui.module.css";
import { courseOffers, groupByLanguage, type CourseOfferView } from "./course-offers";

/**
 * Карточки курсов каталога по языкам. Пока ставится первый урок одного курса, другие начать нельзя: так курс,
 * нажатый первым, первым и встаёт в порядок курсов, становится основным и домашним.
 */
export function FirstRun({
  courses,
  entries,
  modules,
}: {
  courses: Course[];
  entries: StoredCatalogEntry[];
  modules: StoredModule[];
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
          <CardTitle className="text-xl font-bold">Каталог ещё не загружен</CardTitle>
          <CardDescription className="text-foreground/75">Проверьте сеть — курс появится сам.</CardDescription>
        </CardHeader>
      </Card>
    );
  const busy = offers.find((offer) => offer.course.id === loading);
  const groups = groupByLanguage(offers);
  const card = (offer: CourseOfferView, level: 2 | 3) => (
    <CourseOffer key={offer.course.id} offer={offer} level={level} waitFor={busy !== offer ? busy : undefined} />
  );
  if (groups.length < 2) return <>{offers.map((offer) => card(offer, 2))}</>;
  return (
    <>
      {groups.map((group) => (
        <section
          key={group.language}
          aria-labelledby={`courses-${group.language}`}
          data-testid={`courses-${group.language}`}
        >
          <h2 id={`courses-${group.language}`} className="mb-3 text-lg font-bold">
            {PROFILES[group.language].names.title}
          </h2>
          {group.offers.map((offer) => card(offer, 3))}
        </section>
      ))}
    </>
  );
}

function CourseOffer({ offer, level, waitFor }: { offer: CourseOfferView; level: 2 | 3; waitFor?: CourseOfferView }) {
  const { course } = offer;
  const phase = useCoursePhase(course.id);
  const loading = phase.phase === "loading";
  const learn = () => void holdUpdate(installCourse(course.id)).catch(() => undefined);
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <section className="mb-6" data-testid="course-offer" aria-labelledby={`offer-${course.id}`}>
      <Card className="mb-3 bg-soft ring-0" data-testid="first-course">
        <CardHeader>
          <CardTitle className="text-2xl font-bold [overflow-wrap:anywhere]">
            <Heading id={`offer-${course.id}`}>{offer.title}</Heading>
          </CardTitle>
          {offer.goal ? <CardDescription className="text-foreground">{offer.goal}</CardDescription> : null}
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
            onClick={learn}
            disabled={loading || !!waitFor}
            aria-label={`Учить курс «${course.title}»`}
            aria-describedby={waitFor ? `wait-${course.id}` : undefined}
          >
            <GraduationCap data-icon="inline-start" />
            {loading ? "Загружаем курс…" : "Учить курс"}
          </Button>
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
          ) : (
            <p className={ui.hint}>Уроки загрузятся на устройство и будут доступны без сети.</p>
          )}
        </>
      )}
    </section>
  );
}

/** Начало курса там, где каталог есть, а уроков курса на устройстве ещё нет: на полке и в модуле — одного курса. */
export function CourseStart({ courseId }: { courseId?: string }) {
  const courses = useCourses();
  const catalog = useCatalog();
  const offered = (courses ?? []).filter((course) => !courseId || course.id === courseId);
  return <FirstRun courses={offered} entries={catalog?.entries ?? []} modules={catalog?.modules ?? []} />;
}
