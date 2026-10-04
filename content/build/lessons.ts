import {
  ContentError,
  SCHEMA_VERSION,
  type ContentPackage,
  type PackageItem,
  type PackageMedia,
  type PackagePhrase,
  type PackageWord,
} from "../../src/content/schema.ts";
import { CARD_KINDS, type CardKind } from "../../src/domain/types.ts";
import {
  parseBlocks,
  publicationGaps,
  type CatalogModule,
  type LessonBlock,
  type LessonKind,
} from "../../src/content/course.ts";
import type { ArtReport } from "../art.ts";
import { fail, LANGUAGE, nfc, text } from "./common.ts";
import { mediaFor, type BuiltMedia } from "./media.ts";
import type { ContentRoot, LessonItemSource } from "./sources.ts";

const KIND_LABEL: Record<CardKind, { one: string; dir: string }> = {
  word: { one: "слова", dir: "words" },
  phrase: { one: "фразы", dir: "phrases" },
};

export interface LessonsInput {
  sources: ContentRoot;
  words: Map<string, PackageWord>;
  phrases: Map<string, PackagePhrase>;
  courseOf: Map<string, string>;
  moduleOf: Map<string, { id: string; position: number; draft: boolean }>;
  media: BuiltMedia;
  legacy: Set<string>;
  art: ArtReport;
}
export function buildLessons({ sources, words, phrases, courseOf, moduleOf, media, legacy, art }: LessonsInput) {
  const used = { word: new Set<string>(), phrase: new Set<string>() };
  const lessonsForModule = new Map<string, { id: string; kind: LessonKind; blocks: LessonBlock[] }>();
  const cards = { word: words, phrase: phrases } as const;
  const drafts = new Map<string, ContentPackage>();
  for (const [id, src] of sources.lessons) {
    const where = `lessons/${id}.yaml`;
    const courseId = courseOf.get(id) ?? (fail(`${where}: урок не входит ни в один курс`) as string);
    const title = text(src.title, `${where}.title`)!;
    // Положение урока во времени не поставляется: статус занятия и дата принадлежат пользователю.
    for (const field of ["status", "targetDate"] as const)
      if (field in (src as object))
        fail(
          `${where}.${field}: поле не поставляется — статус занятия и дата урока принадлежат пользователю и задаются расписанием курса`,
        );
    // `words` — сокращение словарного урока; `items` — смешанный порядок. Оба сразу делают порядок неоднозначным.
    if (src.words !== undefined && src.items !== undefined) fail(`${where}: укажите либо words, либо items, но не оба`);
    const refs: LessonItemSource[] =
      src.items !== undefined ? src.items : (src.words ?? []).map((wordId) => ({ kind: "word", id: wordId }));
    const placement = moduleOf.get(id);
    // Урок программы может состоять только из блоков (контрольная, чтение); словарный урок без карточек пуст.
    const hasBlocks = placement !== undefined && Array.isArray(src.blocks) && src.blocks.length > 0;
    if (!Array.isArray(refs) || (!refs.length && !hasBlocks))
      fail(`${where}: нужен непустой список ${src.items !== undefined ? "items" : "words"}`);
    const items: PackageItem[] = refs.map((ref, position) => {
      const path = `${where}.${src.items !== undefined ? `items[${position}]` : `words[${position}]`}`;
      if (typeof ref !== "object" || ref === null || typeof ref.id !== "string")
        fail(`${path}: ожидалась пара {kind, id}`);
      if (!(CARD_KINDS as readonly string[]).includes(ref.kind))
        fail(`${path}: неизвестный вид карточки «${String(ref.kind)}»`);
      const kind = ref.kind as CardKind;
      if (!cards[kind].has(ref.id)) fail(`${path}: ${KIND_LABEL[kind].one} ${ref.id} нет в ${KIND_LABEL[kind].dir}/`);
      used[kind].add(ref.id);
      return { kind, id: ref.id, position };
    });
    if (new Set(items.map((item) => `${item.kind}/${item.id}`)).size !== items.length)
      fail(`${where}: карточка повторяется в списке`);
    const blockMedia: PackageMedia[] = [];
    let blocks: LessonBlock[] = [];
    if (src.blocks !== undefined) {
      if (!placement) fail(`${where}.blocks: блоки бывают только у уроков модуля программы`);
      if (!Array.isArray(src.blocks)) fail(`${where}.blocks: ожидался список`);
      const raw = src.blocks.map((block, index) => {
        if (typeof block !== "object" || block === null || Array.isArray(block)) return block;
        const { audio, ...rest } = block as Record<string, unknown>;
        if (audio === undefined) return rest;
        if (rest.type !== "listening") fail(`${where}.blocks[${index}].audio: аудиофайл бывает только у аудирования`);
        if (typeof audio !== "string" || typeof rest.id !== "string")
          fail(`${where}.blocks[${index}]: нужны id и имя файла audio`);
        // Черновик готовится до записи аудио: файла может ещё не быть, и в публикацию его медиа не попадает.
        if (placement?.draft) return rest;
        const source = typeof rest.source === "string" ? rest.source : "";
        if (!source.trim()) fail(`${where}.blocks[${index}].source: у аудио нужен источник и право на использование`);
        const assetId = `snd-${id}-${rest.id as string}`;
        const built = mediaFor(
          assetId,
          audio as string,
          "audio",
          sources.files,
          { alt: "", source },
          `${where}.blocks[${index}]`,
          legacy,
          art,
        );
        media.set(assetId, built);
        blockMedia.push(built.item);
        return { ...rest, audioAssetId: assetId };
      });
      try {
        blocks = parseBlocks(nfc(raw), `${where}.blocks`);
      } catch (error) {
        throw error instanceof ContentError ? new ContentError(error.message) : error;
      }
    }
    if (src.kind !== undefined && src.kind !== "lesson" && src.kind !== "test")
      fail(`${where}.kind: ожидалось lesson или test`);
    if (src.kind !== undefined && !placement) fail(`${where}.kind: вид бывает только у урока модуля программы`);
    lessonsForModule.set(id, { id, kind: src.kind ?? "lesson", blocks });
    // Уроки черновика проверены, но не поставляются: карточки считаются использованными, чтобы автор мог готовить модуль.
    if (placement?.draft) continue;
    const packWords = items.filter((item) => item.kind === "word").map((item) => words.get(item.id)!);
    const packPhrases = items.filter((item) => item.kind === "phrase").map((item) => phrases.get(item.id)!);
    const packMedia = [
      ...[
        ...packWords.flatMap((word) => [word.imageAssetId, word.audioAssetId]),
        ...packPhrases.map((p) => p.audioAssetId),
      ]
        .filter((ref): ref is string => !!ref)
        .map((ref) => media.get(ref)!.item),
      ...blockMedia,
    ];
    const draft: ContentPackage = {
      schemaVersion: SCHEMA_VERSION,
      id,
      courseId,
      version: "",
      language: src.language ?? LANGUAGE,
      lesson: placement ? { title, kind: src.kind ?? "lesson" } : { title },
      ...(placement ? { module: { id: placement.id, position: placement.position } } : {}),
      words: packWords,
      phrases: packPhrases,
      items,
      media: packMedia,
      ...(blocks.length ? { blocks } : {}),
    };
    drafts.set(id, draft);
  }
  return { used, lessonsForModule, drafts };
}

export interface CoverageInput {
  sources: ContentRoot;
  words: Map<string, PackageWord>;
  phrases: Map<string, PackagePhrase>;
  used: { word: Set<string>; phrase: Set<string> };
  checkpoints: Map<string, string>;
  reviews: Map<string, string>;
  lessonsForModule: Map<string, { id: string; kind: LessonKind; blocks: LessonBlock[] }>;
  modules: CatalogModule[];
}
export function checkCoverage({
  sources,
  words,
  phrases,
  used,
  checkpoints,
  reviews,
  lessonsForModule,
  modules,
}: CoverageInput) {
  for (const id of words.keys())
    if (!used.word.has(id))
      fail(`words/${sources.words.get(id)!.file} не входит ни в один урок и не будет опубликовано`);
  for (const id of phrases.keys())
    if (!used.phrase.has(id))
      fail(`phrases/${sources.phrases.get(id)!.file} не входит ни в один урок и не будет опубликована`);
  for (const [lessonId, at] of checkpoints) {
    const lesson = lessonsForModule.get(lessonId)!;
    if (lesson.kind !== "test") fail(`${at}.checkpoint: урок ${lessonId} должен быть контрольной (kind: test)`);
    if (!lesson.blocks.some((block) => block.type === "exercise" && block.graded))
      fail(`${at}.checkpoint: в контрольной ${lessonId} нет оцениваемых заданий`);
  }
  for (const [lessonId, at] of reviews)
    if (lessonsForModule.get(lessonId)!.kind !== "lesson")
      fail(`${at}.review: занятие ${lessonId} после точки — урок (kind: lesson), а не контрольная`);
  // Модуль публикуется только полным: без чтения, аудио, письма, речи или контрольной он остаётся черновиком.
  for (const module of modules) {
    if (module.status !== "published") continue;
    const gaps = publicationGaps(module.lessonIds.map((lessonId) => lessonsForModule.get(lessonId)!));
    if (gaps.length)
      fail(
        `modules/${sources.modules.get(module.id)!.file}: модуль ${module.id} нельзя опубликовать — ${gaps.join("; ")}`,
      );
  }
}
