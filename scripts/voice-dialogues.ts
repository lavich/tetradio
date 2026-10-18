// Озвучка: реплики аудирования голосом персонажа из content/voices/<язык курса>.yaml, слова и фразы — голосом диктора,
// тексты для чтения — по предложениям голосами рассказчика и героев, верные ответы перевода и пропуска — голосом диктора
// (Google Cloud TTS). Файлы — content/audio/<урок>/<блок>-<n>.mp3, audio/words/<id>.mp3, audio/phrases/<id>.mp3,
// audio/readings/<текст>/<n>.mp3, audio/answers/<урок>/<блок>-<пункт>.mp3; `audio:` пишется в реплику урока или
// в файл карточки, записи текстов и ответов находит сборка по манифесту. Переозвучиваются только записи без файла
// или с изменившимся текстом либо голосом (content/audio/dialogues.json).
// Запуск: npm run voices -- m02-1 words phrases readings answers (ключ GOOGLE_TTS_KEY — из окружения или .env);
// без аргументов — всё, кроме реплик и ответов черновых модулей; --check — только отчёт, без ключа.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { isMap, isScalar, isSeq, parseDocument, type Node, type YAMLMap } from "yaml";
import { LANGUAGE } from "../content/build/common.ts";
import { buildCourses } from "../content/build/courses.ts";
import { planAnswerVoices } from "../content/build/answers.ts";
import { planReadingVoices } from "../content/build/readings.ts";
import { profileOf } from "../src/domain/language.ts";
import { readSources } from "../content/build/sources.ts";
import {
  cardFile,
  lineFile,
  isLineFile,
  lineHash,
  parseReply,
  retrying,
  synthText,
  staleRecords,
  voiceableLessons,
  MANIFEST_FILE,
  voiceOf,
  voicesFile,
  type VoiceManifest,
  type VoiceMap,
} from "../content/build/voices.ts";

// `CONTENT_ROOT` — другой набор исходников (фикстура e2e).
const ROOT = process.env.CONTENT_ROOT || "content";
const args = process.argv.slice(2);
const check = args.includes("--check");
const wanted = args.filter((arg) => !arg.startsWith("--"));
const course = args.find((arg) => arg.startsWith("--course="))?.slice("--course=".length);
const lessons = readdirSync(join(ROOT, "lessons"))
  .filter((file) => file.endsWith(".yaml"))
  .map((file) => file.slice(0, -".yaml".length))
  .sort();
const CARDS = ["words", "phrases"] as const;
const GROUPS = ["readings", "answers"];
for (const id of wanted)
  if (!lessons.includes(id) && !(CARDS as readonly string[]).includes(id) && !GROUPS.includes(id))
    throw new Error(
      `Урока ${id} нет в ${join(ROOT, "lessons")}; слова и фразы — words и phrases, тексты — readings, ответы — answers`,
    );
const key = process.env.GOOGLE_TTS_KEY;

const sources = readSources(ROOT);
const { languages, courseLanguages, moduleOf } = buildCourses(sources);
if (course && !courseLanguages.has(course))
  throw new Error(`Курса ${course} нет; есть: ${[...courseLanguages.keys()].join(", ")}`);
const drafts = new Set([...moduleOf].filter(([, placement]) => placement.draft).map(([id]) => id));
const voicesOf = (lessonId: string) => {
  const language = languages.get(lessonId) ?? LANGUAGE;
  return sources.voices.get(language) ?? fail(`${lessonId}: нет карты голосов ${voicesFile(language)} для языка курса`);
};
function fail(message: string): never {
  throw new Error(message);
}
const manifestPath = join(ROOT, MANIFEST_FILE);
const manifest: VoiceManifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};

async function synthesize(text: string, voice: string, voices: VoiceMap): Promise<Buffer> {
  if (!key) throw new Error("Нужен ключ: GOOGLE_TTS_KEY=… npm run voices -- <урок>; без ключа — --check");
  const response = await retrying(() =>
    fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
      method: "POST",
      // Ключ в заголовке, а не в адресе: адрес попадает в тексты ошибок.
      headers: { "content-type": "application/json", "x-goog-api-key": key! },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: voices.language, name: `${voices.prefix}${voice}` },
        audioConfig: { audioEncoding: "MP3" },
      }),
    }),
  );
  const reply = parseReply(response.status, await response.text(), key);
  if (!response.ok || !reply.audio) throw new Error(`Синтез «${text.slice(0, 40)}…» (${voice}): ${reply.problem}`);
  return Buffer.from(reply.audio, "base64");
}

// Chirp 3 HD на коротком слове иногда отдаёт тишину или обрывок ~0,3 с; самое короткое живое слово — 0,5 с.
const MIN_BYTES = 1800;
const ATTEMPTS = 12;

async function synthesizeWhole(text: string, voice: string, voices: VoiceMap): Promise<Buffer> {
  // Одна и та же форма у некоторых слов («και», «μου») срывается раз за разом; другая запись того же слова проходит.
  const forms = [text, text.charAt(0).toLocaleUpperCase(voices.language) + text.slice(1), `«${text}»`];
  for (let attempt = 1; ; attempt++) {
    const audio = await synthesize(forms[(attempt - 1) % forms.length], voice, voices);
    if (audio.byteLength >= MIN_BYTES) return audio;
    if (attempt === ATTEMPTS)
      throw new Error(`Синтез «${text}» (${voice}): ${ATTEMPTS} раз подряд пустая или обрезанная запись`);
  }
}

const stats = { lines: 0, synthesized: 0, characters: 0, bytes: 0, references: 0 };
const pending: string[] = [];
const stale: string[] = [];

/** Синтезирует запись, если файла нет или он сделан для другого текста либо голоса. */
async function voice(file: string, text: string, name: string, voices: VoiceMap, label: string) {
  const target = join(ROOT, "audio", file);
  const hash = lineHash(text, name, voices);
  stats.lines++;
  if (existsSync(target) && manifest[file]?.hash === hash && manifest[file]?.voice === name) return;
  await record(file, text, name, voices, label);
}

async function record(file: string, text: string, name: string, voices: VoiceMap, label: string) {
  const target = join(ROOT, "audio", file);
  const hash = lineHash(text, name, voices);
  pending.push(`${label} (${name})`);
  if (check) return;
  const audio = await synthesizeWhole(synthText(text, voices.language, voices.respell), name, voices);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, audio);
  manifest[file] = { voice: name, hash };
  stats.synthesized++;
  stats.characters += text.length;
  stats.bytes += audio.byteLength;
  // Манифест пишется после каждой записи: прерванный запуск не синтезирует готовое заново.
  saveManifest();
}

function saveManifest() {
  writeFileSync(manifestPath, JSON.stringify(sortKeys(manifest), null, 2) + "\n");
}

function removeFiles(files: string[]) {
  for (const file of files) {
    stale.push(file);
    if (check) continue;
    rmSync(join(ROOT, "audio", file), { force: true });
    delete manifest[file];
  }
  if (check || !files.length) return;
  saveManifest();
  const audio = join(ROOT, "audio");
  for (const dir of new Set(files.map((file) => dirname(file))))
    for (let at = join(audio, dir); at !== audio && existsSync(at) && !readdirSync(at).length; at = dirname(at))
      rmSync(at, { recursive: true });
}

// До синтеза: ошибка озвучки не должна оставлять лишние файлы.
{
  const planned = new Set<string>();
  // Блок или урок с непонятной структурой — правка в процессе: его файлы не трогаем.
  const kept: string[] = [];
  const planAudio = (value: unknown) => {
    if (typeof value === "string") planned.add(value);
  };
  for (const [lessonId, src] of sources.lessons) {
    if (!Array.isArray(src.blocks)) kept.push(`${lessonId}/`);
    for (const block of Array.isArray(src.blocks) ? src.blocks : []) {
      const { type, id, transcript } = (block ?? {}) as Record<string, unknown>;
      if (type !== "listening" || !Array.isArray(transcript)) {
        kept.push(`${lessonId}/${String(id)}-`);
        continue;
      }
      planAudio((block as Record<string, unknown>).audio);
      transcript.forEach((line, index) => {
        planned.add(lineFile(lessonId, String(id), index));
        planAudio((line as Record<string, unknown> | null)?.audio);
      });
    }
  }
  const lineScope = (file: string) => {
    const lesson = file.slice(0, file.indexOf("/"));
    return (
      isLineFile(file) &&
      !kept.some((prefix) => file.startsWith(prefix)) &&
      (!wanted.length || wanted.includes(lesson)) &&
      !drafts.has(lesson)
    );
  };
  for (const dir of CARDS)
    for (const [id, src] of dir === "words" ? sources.words : sources.phrases) {
      planned.add(cardFile(dir, id));
      planAudio(src.audio);
    }
  // С `--course` файл без исходника не отнести к курсу: очистка карточек ждёт запуска без него.
  const cardScope = (file: string) =>
    !course && CARDS.some((dir) => file.startsWith(`${dir}/`) && (!wanted.length || wanted.includes(dir)));
  const onDisk = existsSync(join(ROOT, "audio"))
    ? readdirSync(join(ROOT, "audio"), { recursive: true, encoding: "utf8" })
        .filter((file) => file.endsWith(".mp3"))
        .map((file) => file.split("\\").join("/"))
    : [];
  removeFiles(staleRecords(planned, manifest, onDisk, (file) => lineScope(file) || cardScope(file)));
}

for (const lessonId of voiceableLessons(lessons, drafts, wanted)) {
  const path = join(ROOT, "lessons", `${lessonId}.yaml`);
  const source = readFileSync(path, "utf8");
  const doc = parseDocument(source);
  const blocks = doc.get("blocks");
  if (!isSeq(blocks)) continue;
  // Правки текста урока идут с конца, чтобы смещения ещё не правленных мест не сдвигались.
  const edits: { at: number; end: number; insert: string }[] = [];
  for (const block of blocks.items) {
    if (!isMap(block) || block.get("type") !== "listening") continue;
    const blockId = String(block.get("id"));
    const transcript = block.get("transcript");
    if (!isSeq(transcript)) continue;
    for (const [index, node] of transcript.items.entries()) {
      if (!isMap(node)) continue;
      const line = node as YAMLMap<unknown, unknown>;
      const speaker = line.get("speaker") as string | undefined;
      const text = String(line.get("text")).normalize("NFC");
      const voices = voicesOf(lessonId);
      const name = voiceOf(voices, speaker);
      if (!name) throw new Error(`${lessonId}/${blockId}: у «${speaker ?? "диктора"}» нет голоса в ${voices.file}`);
      const file = lineFile(lessonId, blockId, index);
      await voice(file, text, name, voices, `${lessonId}/${blockId}#${index + 1} ${speaker ?? "диктор"}`);
      if (check || line.get("audio") === file) continue;
      edits.push(reference(source, line, "text", file));
      stats.references++;
    }
  }
  if (!edits.length) continue;
  let next = source;
  for (const edit of edits.sort((a, b) => b.at - a.at))
    next = next.slice(0, edit.at) + edit.insert + next.slice(edit.end);
  writeFileSync(path, next);
}

for (const dir of CARDS) {
  if (wanted.length && !wanted.includes(dir)) continue;
  for (const [id, src] of dir === "words" ? sources.words : sources.phrases) {
    const textKey = dir === "words" ? "greek" : "text";
    if (course && src.course !== course) continue;
    const language = courseLanguages.get(src.course) ?? LANGUAGE;
    const voices =
      sources.voices.get(language) ?? fail(`${dir}/${src.file}: нет карты голосов ${voicesFile(language)}`);
    const name = voices.narrator ?? fail(`${voices.file}: нет диктора — narrator`);
    const file = cardFile(dir, id);
    const text = String("greek" in src ? src.greek : src.text).normalize("NFC");
    await voice(file, text, name, voices, `${dir}/${src.file}`);
    if (check || src.audio === file) continue;
    const path = join(ROOT, dir, src.file);
    const source = readFileSync(path, "utf8");
    const edit = reference(source, parseDocument(source).contents as YAMLMap<unknown, unknown>, textKey, file);
    writeFileSync(path, source.slice(0, edit.at) + edit.insert + source.slice(edit.end));
    stats.references++;
  }
}

async function voiceGroup(
  group: string,
  plan: (existing: string[]) => {
    pending: { file: string; text: string; voice: string; voices: VoiceMap; label: string }[];
    stale: string[];
    total: number;
  },
) {
  const dir = join(ROOT, "audio", group);
  const existing = existsSync(dir)
    ? readdirSync(dir, { recursive: true, encoding: "utf8" })
        .filter((file) => file.endsWith(".mp3"))
        .map((file) => relative(join(ROOT, "audio"), join(dir, file)).split("\\").join("/"))
    : [];
  const { pending: due, stale: extra, total } = plan(existing);
  stats.lines += total;
  for (const entry of due) await record(entry.file, entry.text, entry.voice, entry.voices, entry.label);
  removeFiles(extra);
}

if (!wanted.length || wanted.includes("readings"))
  await voiceGroup("readings", (existing) => {
    const plan = planReadingVoices(
      sources.readings,
      (src) => sources.voices.get(courseLanguages.get(src.course) ?? LANGUAGE),
      manifest,
      existing,
    );
    return { ...plan, total: plan.sentences.length };
  });

if (!wanted.length || wanted.includes("answers"))
  await voiceGroup("answers", (existing) => {
    const plan = planAnswerVoices(
      [...sources.lessons].map(([id, src]) => [id, src.blocks]),
      (lessonId) => {
        const language = languages.get(lessonId) ?? LANGUAGE;
        return { voices: sources.voices.get(language), profile: profileOf(language), held: drafts.has(lessonId) };
      },
      manifest,
      existing,
    );
    return { ...plan, total: plan.answers.length };
  });

/** Ссылка на файл: замена значения `audio` либо новая строка после поля текста с тем же отступом. */
function reference(source: string, line: YAMLMap<unknown, unknown>, textKey: string, file: string) {
  const existing = line.items.find((pair) => isScalar(pair.key) && pair.key.value === "audio");
  const value = existing?.value as Node | undefined;
  if (value?.range) return { at: value.range[0], end: value.range[1], insert: file };
  const textPair = line.items.find((pair) => isScalar(pair.key) && pair.key.value === textKey);
  const keyNode = textPair?.key as Node | undefined;
  const textNode = textPair?.value as Node | undefined;
  if (!keyNode?.range || !textNode?.range) throw new Error(`Нет поля ${textKey}: ${file}`);
  if (line.flow) {
    let at = source.lastIndexOf("}", line.range![1]);
    while (source[at - 1] === " ") at--;
    return { at, end: at, insert: `, audio: ${file}` };
  }
  const indent = keyNode.range[0] - source.lastIndexOf("\n", keyNode.range[0]) - 1;
  const at = textNode.range[1];
  return source[at - 1] === "\n"
    ? { at, end: at, insert: `${" ".repeat(indent)}audio: ${file}\n` }
    : { at, end: at, insert: `\n${" ".repeat(indent)}audio: ${file}` };
}

function sortKeys(value: VoiceManifest): VoiceManifest {
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((file) => [file, value[file]]),
  );
}

if (check) {
  for (const entry of pending) console.log(`  нет записи или устарела: ${entry}`);
  for (const file of stale) console.log(`  лишняя запись: ${file}`);
  console.log(`Записей ${stats.lines}, озвучить ${pending.length}, удалить ${stale.length}`);
} else
  console.log(
    `Записей ${stats.lines}: синтезировано ${stats.synthesized} (${stats.characters} символов, ${(stats.bytes / 1024).toFixed(0)} КБ), ссылок записано ${stats.references}, удалено ${stale.length}`,
  );
