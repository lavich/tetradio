import { DEFAULT_LANGUAGE, isLanguage, type Language } from "../../domain/language";
import type { Course, StoredModule } from "../../domain/types";
import { LESSONS_COUNT, MODULES_COUNT, plural, READY, withCount } from "../../shared/format";
import type { StoredCatalogEntry } from "../../storage/db";

export interface CourseOfferView {
  course: Course;
  language: Language;
  title: string;
  goal?: string;
  volume: string;
  /** В каталоге есть уроки курса: его можно начать. */
  ready: boolean;
}
export interface OfferGroup {
  language: Language;
  offers: CourseOfferView[];
}

function volumeOf(modules: StoredModule[], lessons: number) {
  if (!modules.length) return withCount(lessons, LESSONS_COUNT);
  const published = modules.filter((module) => module.status === "published").length;
  if (published === modules.length) return withCount(modules.length, MODULES_COUNT);
  const ready = plural(published, READY);
  return `${ready[0].toUpperCase()}${ready.slice(1)} ${withCount(published, MODULES_COUNT)} из ${modules.length}`;
}

/** Курсы текущего каталога для карточек: с уроками или с модулями; убранный из каталога курс не показывается. */
export function courseOffers(
  courses: Course[],
  entries: StoredCatalogEntry[],
  modules: StoredModule[],
): CourseOfferView[] {
  const place = (courseId: string) =>
    Math.min(...entries.filter((entry) => entry.courseId === courseId).map((entry) => entry.position ?? Infinity));
  return courses
    .map((course) => {
      const lessons = entries.filter((entry) => entry.courseId === course.id);
      const own = modules.filter((module) => module.courseId === course.id);
      const code = course.language || lessons[0]?.language;
      return {
        course,
        lessons,
        own,
        view: {
          course,
          language: isLanguage(code) ? code : DEFAULT_LANGUAGE,
          title: course.level ? `${course.title} · ${course.level}` : course.title,
          ...(course.goal ? { goal: course.goal } : {}),
          volume: volumeOf(own, lessons.length),
          ready: lessons.length > 0,
        },
      };
    })
    .filter(({ lessons, own }) => lessons.length || own.length)
    .sort(
      (a, b) =>
        (a.course.order ?? Infinity) - (b.course.order ?? Infinity) ||
        place(a.course.id) - place(b.course.id) ||
        a.course.id.localeCompare(b.course.id),
    )
    .map(({ view }) => view);
}

export function groupByLanguage(offers: CourseOfferView[]): OfferGroup[] {
  const groups: OfferGroup[] = [];
  for (const offer of offers) {
    const group = groups.find((item) => item.language === offer.language);
    if (group) group.offers.push(offer);
    else groups.push({ language: offer.language, offers: [offer] });
  }
  return groups;
}
