// Озвучка аудирования: для каждой реплики синтезирует MP3 голосом персонажа из content/voices.yaml
// (Google Cloud TTS) в content/audio/<урок>/<блок>-<n>.mp3 и пишет `audio:` в реплику урока.
// Переозвучиваются только реплики без файла или с изменившимся текстом либо голосом (content/audio/dialogues.json).
// Запуск: GOOGLE_TTS_KEY=… npm run voices -- m02-1 m02-2; без уроков — весь курс; --check — только отчёт, без ключа.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isMap, isScalar, isSeq, parseDocument, type Node, type YAMLMap } from "yaml";
import {
  lineFile,
  lineHash,
  MANIFEST_FILE,
  parseVoices,
  voiceOf,
  VOICES_FILE,
  type VoiceManifest,
} from "../content/build/voices.ts";

// `CONTENT_ROOT` — другой набор исходников (фикстура e2e).
const ROOT = process.env.CONTENT_ROOT || "content";
const args = process.argv.slice(2);
const check = args.includes("--check");
const wanted = args.filter((arg) => !arg.startsWith("--"));
const lessons = readdirSync(join(ROOT, "lessons"))
  .filter((file) => file.endsWith(".yaml"))
  .map((file) => file.slice(0, -".yaml".length))
  .sort();
for (const id of wanted) if (!lessons.includes(id)) throw new Error(`Урока ${id} нет в content/lessons`);
const key = process.env.GOOGLE_TTS_KEY;

const voices = parseVoices(readFileSync(join(ROOT, VOICES_FILE), "utf8"));
const manifestPath = join(ROOT, MANIFEST_FILE);
const manifest: VoiceManifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};

async function synthesize(text: string, voice: string): Promise<Buffer> {
  if (!key) throw new Error("Нужен ключ: GOOGLE_TTS_KEY=… npm run voices -- <урок>; без ключа — --check");
  const response = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
    method: "POST",
    // Ключ в заголовке, а не в адресе: адрес попадает в тексты ошибок.
    headers: { "content-type": "application/json", "x-goog-api-key": key! },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: voices.language, name: `${voices.prefix}${voice}` },
      audioConfig: { audioEncoding: "MP3" },
    }),
  });
  const body = (await response.json()) as { audioContent?: string; error?: { message?: string } };
  if (!response.ok || !body.audioContent)
    throw new Error(`Синтез «${text.slice(0, 40)}…» (${voice}): ${response.status} ${body.error?.message ?? ""}`);
  return Buffer.from(body.audioContent, "base64");
}

const stats = { lines: 0, synthesized: 0, characters: 0, bytes: 0, references: 0 };
const pending: string[] = [];
for (const lessonId of wanted.length ? wanted : lessons) {
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
      const voice = voiceOf(voices, speaker);
      if (!voice) throw new Error(`${lessonId}/${blockId}: у «${speaker ?? "диктора"}» нет голоса в ${VOICES_FILE}`);
      const file = lineFile(lessonId, blockId, index);
      const target = join(ROOT, "audio", file);
      const hash = lineHash(text, voice);
      stats.lines++;
      if (!existsSync(target) || manifest[file]?.hash !== hash || manifest[file]?.voice !== voice) {
        pending.push(`${lessonId}/${blockId}#${index + 1} ${speaker ?? "диктор"} (${voice})`);
        if (!check) {
          const audio = await synthesize(text, voice);
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, audio);
          manifest[file] = { voice, hash };
          stats.synthesized++;
          stats.characters += text.length;
          stats.bytes += audio.byteLength;
          // Манифест пишется после каждой реплики: прерванный запуск не синтезирует готовое заново.
          writeFileSync(manifestPath, JSON.stringify(sortKeys(manifest), null, 2) + "\n");
        }
      }
      if (check || line.get("audio") === file) continue;
      edits.push(reference(source, line, file));
      stats.references++;
    }
  }
  if (!edits.length) continue;
  let next = source;
  for (const edit of edits.sort((a, b) => b.at - a.at))
    next = next.slice(0, edit.at) + edit.insert + next.slice(edit.end);
  writeFileSync(path, next);
}

/** Ссылка на файл в реплике: замена значения `audio` либо новая строка после `text` с тем же отступом. */
function reference(source: string, line: YAMLMap<unknown, unknown>, file: string) {
  const existing = line.items.find((pair) => isScalar(pair.key) && pair.key.value === "audio");
  const value = existing?.value as Node | undefined;
  if (value?.range) return { at: value.range[0], end: value.range[1], insert: file };
  const textPair = line.items.find((pair) => isScalar(pair.key) && pair.key.value === "text");
  const keyNode = textPair?.key as Node | undefined;
  const textNode = textPair?.value as Node | undefined;
  if (!keyNode?.range || !textNode?.range) throw new Error(`Реплика без text: ${file}`);
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
  console.log(`Реплик ${stats.lines}, озвучить ${pending.length}`);
} else
  console.log(
    `Реплик ${stats.lines}: синтезировано ${stats.synthesized} (${stats.characters} символов, ${(stats.bytes / 1024).toFixed(0)} КБ), ссылок записано ${stats.references}`,
  );
