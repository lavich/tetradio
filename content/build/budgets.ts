import { gzipSync } from "node:zlib";
import type { Catalog } from "../../src/content/schema.ts";
import type { BuiltFile } from "./output.ts";

/**
 * Пределы из issue #160 над замером 17.10.2026: пакет max 32 724 gzip, каталог 18 526, греческий курс 1 406 076,
 * mp3 — 32 кбит/с моно, самый большой файл 186 624 байта. Растут только явным решением.
 */
export interface ContentBudgets {
  packageGzip: number;
  catalogGzip: number;
  courseGzip: number;
  audioBitrate: number;
  audioBytes: number;
}

export const BUDGETS: ContentBudgets = {
  packageGzip: 40_000,
  catalogGzip: 25_000,
  courseGzip: 1_600_000,
  audioBitrate: 32_000,
  audioBytes: 250_000,
};

const gzipSize = (body: string | Uint8Array) => gzipSync(body, { level: 9 }).length;

const BITRATES_V1_L3 = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const BITRATES_V2_L3 = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] } as const;

/** Битрейт Layer III в бит/с по первому аудиокадру; у VBR (кадр Xing/Info) — размер ÷ длительность по числу кадров. */
export function mp3Bitrate(body: Uint8Array): number | undefined {
  let at = 0;
  if (body[0] === 0x49 && body[1] === 0x44 && body[2] === 0x33)
    at = 10 + (((body[6]! & 0x7f) << 21) | ((body[7]! & 0x7f) << 14) | ((body[8]! & 0x7f) << 7) | (body[9]! & 0x7f));
  while (at + 4 <= body.length && !(body[at] === 0xff && (body[at + 1]! & 0xe0) === 0xe0)) at++;
  if (at + 4 > body.length) return undefined;
  const version = (body[at + 1]! >> 3) & 3;
  const layer = (body[at + 1]! >> 1) & 3;
  const index = body[at + 2]! >> 4;
  const rate = SAMPLE_RATES[version as keyof typeof SAMPLE_RATES]?.[(body[at + 2]! >> 2) & 3];
  if (layer !== 1 || version === 1 || !rate || index === 0 || index === 15) return undefined;
  const mono = ((body[at + 3]! >> 6) & 3) === 3;
  const nominal = (version === 3 ? BITRATES_V1_L3 : BITRATES_V2_L3)[index]! * 1000;
  const side = version === 3 ? (mono ? 17 : 32) : mono ? 9 : 17;
  const tag = String.fromCharCode(...body.subarray(at + 4 + side, at + 8 + side));
  if (tag !== "Xing" && tag !== "Info") return nominal;
  const flags = body[at + 11 + side]!;
  if (!(flags & 1)) return nominal;
  const view = new DataView(body.buffer, body.byteOffset + at + 12 + side, 4);
  const seconds = (view.getUint32(0) * (version === 3 ? 1152 : 576)) / rate;
  return seconds > 0 ? Math.round(((body.length - at) * 8) / seconds) : nominal;
}

export interface BudgetReport {
  violations: string[];
  summary: string;
}

export function checkBudgets(files: BuiltFile[], catalog: Catalog, limits: ContentBudgets = BUDGETS): BudgetReport {
  const violations: string[] = [];
  const check = (what: string, size: number, limit: number, unit: string) => {
    if (size > limit) violations.push(`${what}: ${size} ${unit} больше предела ${limit}`);
  };
  const gzipOf = new Map<string, number>();
  let packageMax = 0;
  let catalogGzip = 0;
  let audioMaxBytes = 0;
  let audioMaxRate = 0;
  for (const file of files) {
    if (file.path.startsWith("content/packages/")) {
      const size = gzipSize(file.body);
      gzipOf.set(file.path, size);
      packageMax = Math.max(packageMax, size);
      check(`пакет ${file.path}`, size, limits.packageGzip, "байт gzip");
    } else if (file.path === "content/catalog.json") {
      catalogGzip = gzipSize(file.body);
      check("каталог", catalogGzip, limits.catalogGzip, "байт gzip");
    } else if (file.mimeType === "audio/mpeg" && typeof file.body !== "string") {
      audioMaxBytes = Math.max(audioMaxBytes, file.body.length);
      check(`аудио ${file.path}`, file.body.length, limits.audioBytes, "байт");
      const rate = mp3Bitrate(file.body);
      if (rate === undefined) violations.push(`аудио ${file.path}: заголовок mp3 (Layer III) не разобран`);
      else {
        audioMaxRate = Math.max(audioMaxRate, rate);
        check(`аудио ${file.path}`, rate, limits.audioBitrate, "бит/с");
      }
    }
  }
  const courses = new Map<string, number>();
  for (const lesson of catalog.lessons)
    courses.set(lesson.courseId, (courses.get(lesson.courseId) ?? 0) + (gzipOf.get(lesson.url) ?? 0));
  let courseMax = 0;
  for (const [id, size] of courses) {
    courseMax = Math.max(courseMax, size);
    check(`курс ${id}`, size, limits.courseGzip, "байт gzip");
  }
  const summary =
    `Бюджеты: пакет max ${packageMax} из ${limits.packageGzip}, каталог ${catalogGzip} из ${limits.catalogGzip}, ` +
    `курс max ${courseMax} из ${limits.courseGzip} (gzip); mp3 max ${audioMaxBytes} из ${limits.audioBytes} байт, ` +
    `${audioMaxRate} из ${limits.audioBitrate} бит/с`;
  return { violations, summary };
}
