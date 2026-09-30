/**
 * Аудирование синтезом речи устройства: транскрипт звучит реплика за репликой греческим голосом.
 * Разные говорящие получают разные голоса, если их на устройстве несколько; при одном голосе их различает
 * высота тона. Остановка отменяет весь диалог, а не только текущую реплику.
 */
import type { TranscriptLine } from "../content/course";

export type DialogueResult = "done" | "stopped" | "none" | "error";
export const RATES = { normal: 0.95, slow: 0.75 } as const;
export type Rate = keyof typeof RATES;

let run = 0;
const available = () => typeof speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined";

function greekVoices(): Promise<SpeechSynthesisVoice[]> {
  if (!available()) return Promise.resolve([]);
  const read = () => speechSynthesis.getVoices().filter((voice) => voice.lang?.toLowerCase().startsWith("el"));
  const first = read();
  if (first.length) return Promise.resolve(first);
  return new Promise((resolve) => {
    const done = () => {
      speechSynthesis.removeEventListener("voiceschanged", done);
      resolve(read());
    };
    speechSynthesis.addEventListener("voiceschanged", done);
    setTimeout(done, 1000);
  });
}

/** Говорящему — голос и тон: по порядку появления в транскрипте. */
export function castOf(lines: TranscriptLine[], voiceCount: number) {
  const speakers = [...new Set(lines.map((line) => line.speaker ?? ""))];
  return new Map(
    speakers.map((speaker, index) => [
      speaker,
      voiceCount > 1 ? { voice: index % voiceCount, pitch: 1 } : { voice: 0, pitch: [1, 0.8, 1.2][index % 3] },
    ]),
  );
}

/** Синтезатор, который принял реплику, но не начал говорить, считается сбоем: иначе проигрыватель висит молча. */
const START_TIMEOUT = 1500;
function say(text: string, voice: SpeechSynthesisVoice, rate: number, pitch: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(startTimer);
      clearTimeout(endTimer);
      resolve(ok);
    };
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang || "el-GR";
    utterance.rate = rate;
    utterance.pitch = pitch;
    // Конец реплики может не прийти (WebView на iOS); страховка — длительность по длине текста с запасом.
    let endTimer: ReturnType<typeof setTimeout> | undefined;
    const startTimer = setTimeout(() => {
      speechSynthesis.cancel();
      finish(false);
    }, START_TIMEOUT);
    utterance.onstart = () => {
      clearTimeout(startTimer);
      endTimer = setTimeout(() => finish(true), 3000 + (text.length * 180) / rate);
    };
    utterance.onend = () => finish(true);
    utterance.onerror = (event) => finish(event.error === "interrupted" || event.error === "canceled");
    speechSynthesis.speak(utterance);
  });
}

/** Проигрывает диалог целиком; `onLine` сообщает номер звучащей реплики (для подсветки после ответа). */
export async function playDialogue(
  lines: TranscriptLine[],
  rate: Rate = "normal",
  onLine?: (index: number) => void,
): Promise<DialogueResult> {
  const voices = await greekVoices();
  if (!voices.length) return "none";
  const mine = ++run;
  speechSynthesis.cancel();
  const cast = castOf(lines, voices.length);
  for (const [index, line] of lines.entries()) {
    if (mine !== run) return "stopped";
    onLine?.(index);
    const role = cast.get(line.speaker ?? "")!;
    const ok = await say(line.text, voices[role.voice], RATES[rate], role.pitch);
    if (mine !== run) return "stopped";
    if (!ok) return "error";
    // Короткая пауза между репликами, как в записи экзамена.
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  onLine?.(-1);
  return "done";
}

export function stopDialogue() {
  run++;
  if (available()) speechSynthesis.cancel();
}
