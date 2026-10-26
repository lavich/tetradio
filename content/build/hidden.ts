import type { Catalog, ContentPackage, PackagePhrase, PackageWord } from "../../src/content/schema.ts";
import type { BuiltFile } from "./output.ts";
import type { ContentRoot } from "./sources.ts";

interface Whole {
  catalog: Catalog;
  packages: ContentPackage[];
  files: BuiltFile[];
  words: PackageWord[];
  phrases: PackagePhrase[];
}

/** Поставляемая часть контента: без курсов `hidden: true`, их модулей, уроков, пакетов, медиа, карточек и текстов. */
export function withoutHidden(whole: Whole, hidden: Set<string>, sources: ContentRoot): Whole {
  const visible = (courseId: string) => !hidden.has(courseId);
  const packages = whole.packages.filter((pack) => visible(pack.courseId));
  const urls = (list: ContentPackage[]) => new Set(list.flatMap((pack) => pack.media.map((item) => item.url)));
  const dropped = new Set(whole.catalog.lessons.filter((entry) => !visible(entry.courseId)).map((entry) => entry.url));
  for (const url of urls(whole.packages.filter((pack) => !visible(pack.courseId)))) dropped.add(url);
  for (const url of urls(packages)) dropped.delete(url);
  const shown = (id: string, owners: Map<string, { course: string }>) => visible(owners.get(id)?.course ?? "");
  return {
    catalog: {
      ...whole.catalog,
      courses: whole.catalog.courses.filter((course) => visible(course.id)),
      lessons: whole.catalog.lessons.filter((entry) => visible(entry.courseId)),
      ...(whole.catalog.modules?.some((module) => visible(module.courseId))
        ? { modules: whole.catalog.modules.filter((module) => visible(module.courseId)) }
        : {}),
    },
    packages,
    files: whole.files.filter((file) => !dropped.has(file.path)),
    words: whole.words.filter((word) => shown(word.id, sources.words)),
    phrases: whole.phrases.filter((phrase) => shown(phrase.id, sources.phrases)),
  };
}
