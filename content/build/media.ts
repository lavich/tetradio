import { extname } from "node:path";
import type { PackageMedia, PackagePhrase, PackageWord } from "../../src/content/schema.ts";
import { checkArt, LEGACY_FILE, readLegacy, type ArtReport } from "../art.ts";
import { audioAssetId } from "./cards.ts";
import { fail, hash } from "./common.ts";
import type { ContentRoot } from "./sources.ts";

export const ART_SOURCE = "Собственная векторная иллюстрация Lexi (CC0)";
const MIME: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
};

export type BuiltMedia = Map<string, { item: PackageMedia; body: Uint8Array }>;

export function mediaFor(
  id: string,
  file: string,
  dir: "art" | "audio" | "pictures",
  files: Map<string, Uint8Array>,
  labels: { alt: string; source: string },
  where: string,
  legacy: Set<string>,
  art: ArtReport,
): { item: PackageMedia; body: Uint8Array } {
  const body = files.get(`${dir}/${file}`);
  if (!body) fail(`${where}: файла ${dir}/${file} нет`);
  const ext = extname(file).toLowerCase();
  const mimeType = MIME[ext] ?? fail(`${where}: неизвестный тип файла ${file}`);
  // Картинка из готовой библиотеки: только SVG без скриптов и внешних ссылок, небольшого размера — вне стандарта своих иллюстраций.
  if (dir === "pictures") {
    const svg = Buffer.from(body!).toString("utf8");
    if (extname(file).toLowerCase() !== ".svg") fail(`${where}: картинка библиотеки — только SVG`);
    if (body!.byteLength > 12_000) fail(`${where}: картинка ${file} больше 12 КБ`);
    if (/<script|<foreignObject|\son\w+=|(?:href|src)=["'](?!#)/i.test(svg))
      fail(`${where}: в ${file} скрипт, обработчик или внешняя ссылка`);
  }
  // Иллюстрация подчиняется стандарту (docs/art-standard.md); файлы до стандарта из legacy.txt считаются в отчёте о миграции.
  if (dir === "art" && mimeType === "image/svg+xml") {
    art.files++;
    if (checkArt(file, body!, legacy)) art.legacy++;
  }
  const version = hash(body!, 10);
  return {
    body: body!,
    item: {
      id,
      kind: dir === "audio" ? "audio" : "image",
      mimeType,
      url: `content/media/${id}@${version}${ext}`,
      bytes: body!.byteLength,
      version,
      required: true,
      alt: labels.alt,
      source: labels.source,
    },
  };
}

export function buildMedia(sources: ContentRoot, words: Map<string, PackageWord>, phrases: Map<string, PackagePhrase>) {
  /** Список унаследованных картинок только сокращается: имя без файла — мусор, а не исключение. */
  const legacy = readLegacy(sources.files);
  const art: ArtReport = { files: 0, legacy: 0 };
  for (const file of legacy)
    if (!sources.files.has(`art/${file}`)) fail(`art/${LEGACY_FILE}: файла art/${file} нет — уберите имя из списка`);
  const media: BuiltMedia = new Map();
  for (const [id, src] of sources.words) {
    const word = words.get(id)!;
    const labels = { alt: `Иллюстрация к слову «${word.russian}»`, source: ART_SOURCE };
    if (src.image)
      media.set(
        word.imageAssetId!,
        mediaFor(word.imageAssetId!, src.image, "art", sources.files, labels, `words/${src.file}`, legacy, art),
      );
    const picture = sources.pictures.words.get(id);
    if (picture)
      media.set(
        word.imageAssetId!,
        mediaFor(
          word.imageAssetId!,
          picture,
          "pictures",
          sources.files,
          { alt: `Картинка к слову «${word.russian}»`, source: sources.pictures.source },
          `pictures.yaml.words.${id}`,
          legacy,
          art,
        ),
      );
    if (src.audio)
      media.set(
        word.audioAssetId!,
        mediaFor(
          word.audioAssetId!,
          src.audio,
          "audio",
          sources.files,
          { alt: "", source: word.source ?? "" },
          `words/${src.file}`,
          legacy,
          art,
        ),
      );
  }
  for (const [id, src] of sources.phrases)
    if (src.audio)
      media.set(
        audioAssetId(id),
        mediaFor(
          audioAssetId(id),
          src.audio,
          "audio",
          sources.files,
          { alt: "", source: phrases.get(id)!.provenance.sourceLabel },
          `phrases/${src.file}`,
          legacy,
          art,
        ),
      );

  // Картинка библиотеки без слова — забытый файл: публиковать её незачем.
  const usedPictures = new Set(sources.pictures.words.values());
  for (const path of sources.files.keys())
    if (path.startsWith("pictures/") && path.endsWith(".svg") && !usedPictures.has(path.slice("pictures/".length)))
      fail(`${path}: картинка не привязана ни к одному слову в pictures.yaml`);
  return { legacy, art, media };
}
