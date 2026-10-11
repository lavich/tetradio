import {
  ContentError,
  parsePackage,
  voicedOf,
  type CatalogEntry,
  type ContentPackage,
  type PackageMarks,
  type PackageMedia,
  type PackageReading,
} from "../../src/content/schema.ts";
import { canonical, hash } from "./common.ts";

export interface BuiltFile {
  path: string;
  body: string | Uint8Array;
  mimeType: string;
}

export function packLessons(
  drafts: Map<string, ContentPackage>,
  marks: { packages: Map<string, PackageMarks> },
  readings: Map<string, PackageReading[]> = new Map(),
  readingMedia: Map<string, PackageMedia[]> = new Map(),
) {
  const packages: ContentPackage[] = [];
  const entries: CatalogEntry[] = [];
  const files: BuiltFile[] = [];
  for (const [id, draft] of drafts) {
    const marked = marks.packages.get(id);
    if (marked) draft.marks = marked;
    const texts = readings.get(id);
    if (texts) draft.readings = texts;
    const voiced = readingMedia.get(id);
    if (voiced)
      draft.media = [...draft.media, ...voiced.filter((item) => !draft.media.some((own) => own.id === item.id))];
    const version = hash(canonical({ ...draft, version: undefined }));
    const pack = { ...draft, version };
    if (marked || pack.lineAudio || texts) {
      try {
        const parsed = parsePackage(JSON.parse(JSON.stringify(pack)));
        if (voicedOf(parsed.readings) !== voicedOf(pack.readings))
          throw new ContentError("записи текста для чтения не совпали с его предложениями");
      } catch (error) {
        throw error instanceof ContentError ? new ContentError(`lessons/${id}.yaml: ${error.message}`) : error;
      }
    }
    const body = JSON.stringify(pack);
    const url = `content/packages/${id}@${version}.json`;
    packages.push(pack);
    files.push({ path: url, body, mimeType: "application/json" });
    const packMedia = pack.media;
    entries.push({
      id,
      courseId: pack.courseId,
      language: pack.language,
      title: pack.lesson.title,
      wordCount: pack.words.length,
      wordIds: pack.words.map((word) => word.id),
      phraseCount: pack.phrases.length,
      cardCount: pack.items.length,
      version,
      url,
      bytes: Buffer.byteLength(body),
      media: { count: packMedia.length, bytes: packMedia.reduce((sum, item) => sum + item.bytes, 0) },
      ...(pack.readings?.length ? { readings: pack.readings.length } : {}),
      ...(voicedOf(pack.readings) ? { readingAudio: voicedOf(pack.readings) } : {}),
    });
  }
  return { packages, entries, files };
}
