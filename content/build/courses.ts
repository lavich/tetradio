import { ContentError, type CatalogCourse } from "../../src/content/schema.ts";
import { parseExam, parseModule, type CatalogModule } from "../../src/content/course.ts";
import type { Language } from "../../src/domain/language.ts";
import { fail, LANGUAGE, languageOf, nfc, text } from "./common.ts";
import type { ContentRoot, CourseSource } from "./sources.ts";

export function buildCourses(sources: ContentRoot) {
  /** Урок принадлежит ровно одному курсу: без курса он потеряется в каталоге, в двух — попадёт в занятие дважды. */
  const courseOf = new Map<string, string>();
  const courses: CatalogCourse[] = [];
  const modules: CatalogModule[] = [];
  /** Место урока в модуле; уроки черновиков проверяются, но не поставляются. */
  const moduleOf = new Map<string, { id: string; position: number; draft: boolean }>();
  const moduleOwner = new Map<string, string>();
  /** Урок контрольной точки → файл модуля: точка обязана быть контрольной с оцениваемыми заданиями. */
  const checkpoints = new Map<string, string>();
  const reviews = new Map<string, string>();
  const languages = new Map<string, Language>();
  const moduleLanguages = new Map<string, Language>();
  // Курс учат целиком, поэтому смешанные языки внутри него — ошибка, а не особенность набора.
  const courseLanguage = (where: string, src: CourseSource, lessonIds: string[]) => {
    const own = src.language === undefined ? undefined : languageOf(src.language, `${where}.language`);
    const found = new Set(
      lessonIds.map((lessonId) => {
        const language = sources.lessons.get(lessonId)!.language;
        return language === undefined ? (own ?? LANGUAGE) : languageOf(language, `lessons/${lessonId}.yaml.language`);
      }),
    );
    if (own) found.add(own);
    if (found.size > 1) fail(`${where}: уроки курса на разных языках — ${[...found].sort().join(", ")}`);
    const language = [...found][0] ?? LANGUAGE;
    for (const lessonId of lessonIds) languages.set(lessonId, language);
    return language;
  };
  for (const [courseId, src] of sources.courses) {
    const where = `courses/${src.file}`;
    const title = text(src.title, `${where}.title`)!;
    if (src.lessons !== undefined && src.modules !== undefined) fail(`${where}: укажите либо lessons, либо modules`);
    const moduleIds: string[] = [];
    if (src.modules !== undefined) {
      if (!Array.isArray(src.modules) || !src.modules.length) fail(`${where}: нужен непустой список modules`);
      const lessonIds: string[] = [];
      const numbers = new Map<number, string>();
      for (const moduleId of src.modules) {
        const moduleSrc = sources.modules.get(moduleId) ?? fail(`${where}: модуля ${moduleId} нет в modules/`);
        const at = `modules/${moduleSrc.file}`;
        const owner = moduleOwner.get(moduleId);
        if (owner) fail(`${where}: модуль ${moduleId} уже входит в курс ${owner}`);
        moduleOwner.set(moduleId, courseId);
        const ownLessons = moduleSrc.lessons ?? [];
        if (!Array.isArray(ownLessons)) fail(`${at}.lessons: ожидался список`);
        let module: CatalogModule;
        try {
          module = parseModule(
            nfc({
              ...moduleSrc,
              id: moduleId,
              courseId,
              lessonIds: moduleSrc.status === "published" ? ownLessons : [],
              checkpointId: moduleSrc.status === "published" ? moduleSrc.checkpoint : undefined,
              reviewIds: moduleSrc.status === "published" ? moduleSrc.review : undefined,
              lessons: undefined,
              checkpoint: undefined,
              review: undefined,
              file: undefined,
            }),
            at,
          );
        } catch (error) {
          throw error instanceof ContentError ? new ContentError(error.message) : error;
        }
        const twin = numbers.get(module.number);
        if (twin) fail(`${at}.number: номер ${module.number} уже у модуля ${twin}`);
        numbers.set(module.number, moduleId);
        ownLessons.forEach((lessonId, position) => {
          if (!sources.lessons.has(lessonId)) fail(`${at}: урока ${lessonId} нет в lessons/`);
          if (moduleOf.has(lessonId)) fail(`${at}: урок ${lessonId} уже входит в модуль ${moduleOf.get(lessonId)!.id}`);
          moduleOf.set(lessonId, { id: moduleId, position, draft: module.status === "draft" });
          courseOf.set(lessonId, courseId);
          if (module.status === "published") lessonIds.push(lessonId);
        });
        if (moduleSrc.checkpoint !== undefined) {
          const checkpoint = moduleSrc.checkpoint;
          if (typeof checkpoint !== "string" || !sources.lessons.has(checkpoint))
            fail(`${at}.checkpoint: урока ${String(checkpoint)} нет в lessons/`);
          if (moduleOf.has(checkpoint))
            fail(`${at}.checkpoint: урок ${checkpoint} уже входит в модуль ${moduleOf.get(checkpoint)!.id}`);
          moduleOf.set(checkpoint, { id: moduleId, position: ownLessons.length, draft: module.status === "draft" });
          courseOf.set(checkpoint, courseId);
          checkpoints.set(checkpoint, at);
          if (module.status === "published") lessonIds.push(checkpoint);
        }
        if (moduleSrc.review !== undefined) {
          if (!Array.isArray(moduleSrc.review)) fail(`${at}.review: ожидался список`);
          moduleSrc.review.forEach((reviewId, index) => {
            if (!sources.lessons.has(reviewId)) fail(`${at}.review: урока ${reviewId} нет в lessons/`);
            if (moduleOf.has(reviewId))
              fail(`${at}.review: урок ${reviewId} уже входит в модуль ${moduleOf.get(reviewId)!.id}`);
            moduleOf.set(reviewId, {
              id: moduleId,
              position: ownLessons.length + 1 + index,
              draft: module.status === "draft",
            });
            courseOf.set(reviewId, courseId);
            reviews.set(reviewId, at);
            if (module.status === "published") lessonIds.push(reviewId);
          });
        }
        modules.push(module);
        moduleIds.push(moduleId);
      }
      const ownLessonIds = [...courseOf].filter(([, owner]) => owner === courseId).map(([lessonId]) => lessonId);
      const language = courseLanguage(where, src, ownLessonIds);
      for (const moduleId of moduleIds) moduleLanguages.set(moduleId, language);
      courses.push({
        id: courseId,
        title,
        language,
        lessonIds,
        moduleIds,
        ...(src.source ? { source: src.source } : {}),
        ...(src.exam !== undefined ? { exam: parseExam(nfc(src.exam), `${where}.exam`) } : {}),
      });
      continue;
    }
    if (!Array.isArray(src.lessons) || !src.lessons.length) fail(`${where}: нужен непустой список lessons`);
    for (const lessonId of src.lessons) {
      if (!sources.lessons.has(lessonId)) fail(`${where}: урока ${lessonId} нет в lessons/`);
      const twin = courseOf.get(lessonId);
      if (twin) fail(`${where}: урок ${lessonId} уже входит в курс ${twin}`);
      courseOf.set(lessonId, courseId);
    }
    const course: CatalogCourse = {
      id: courseId,
      title,
      language: courseLanguage(where, src, src.lessons!),
      lessonIds: [...src.lessons!],
    };
    const source = text(src.source, `${where}.source`, false);
    if (source) course.source = source;
    courses.push(course);
  }
  return { courseOf, courses, modules, moduleOf, checkpoints, reviews, languages, moduleLanguages };
}
