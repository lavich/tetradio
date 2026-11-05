import { extname } from "node:path";
import type { PackageMedia, PackagePhrase, PackageWord } from "../../src/content/schema.ts";
import { audioAssetId } from "./cards.ts";
import { fail, hash } from "./common.ts";
import type { ContentRoot } from "./sources.ts";

const MIME: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
};

export type BuiltMedia = Map<string, { item: PackageMedia; body: Uint8Array }>;

export function mediaFor(
  id: string,
  file: string,
  files: Map<string, Uint8Array>,
  source: string,
  where: string,
): { item: PackageMedia; body: Uint8Array } {
  const body = files.get(`audio/${file}`);
  if (!body) fail(`${where}: файла audio/${file} нет`);
  const ext = extname(file).toLowerCase();
  const mimeType = MIME[ext] ?? fail(`${where}: неизвестный тип файла ${file}`);
  const version = hash(body!, 10);
  return {
    body: body!,
    item: {
      id,
      kind: "audio",
      mimeType,
      url: `content/media/${id}@${version}${ext}`,
      bytes: body!.byteLength,
      version,
      required: true,
      alt: "",
      source,
    },
  };
}

export function buildMedia(
  sources: ContentRoot,
  words: Map<string, PackageWord>,
  phrases: Map<string, PackagePhrase>,
  voiced: Map<string, string>,
) {
  const media: BuiltMedia = new Map();
  for (const [id, src] of sources.words) {
    const word = words.get(id)!;
    if (src.audio)
      media.set(
        word.audioAssetId!,
        mediaFor(word.audioAssetId!, src.audio, sources.files, voiced.get(word.audioAssetId!)!, `words/${src.file}`),
      );
  }
  for (const [id, src] of sources.phrases)
    if (src.audio)
      media.set(
        audioAssetId(id),
        mediaFor(audioAssetId(id), src.audio, sources.files, voiced.get(audioAssetId(id))!, `phrases/${src.file}`),
      );
  return media;
}
