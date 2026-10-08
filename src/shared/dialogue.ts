/**
 * Аудирование реплика за репликой. Реплика с записью звучит файлом (голос персонажа), без записи или если файл
 * не скачать — синтезом речи устройства: разные говорящие получают разные голоса, если их на устройстве несколько,
 * при одном голосе их различает высота тона. Остановка отменяет весь диалог, а не только текущую реплику.
 */
import type { TranscriptLine } from "../content/course";
import { PROFILES, type LanguageProfile } from "../domain/language";
import { voicesOf } from "./voices";
import { releaseAssetUrl, type AssetSource } from "./store";

export type DialogueResult = "done" | "stopped" | "none" | "error";
export const RATES = { normal: 0.95, slow: 0.75 } as const;
/** Записи сделаны в обычном темпе; медленный режим замедляет файл, а не синтезирует второй набор. */
export const FILE_RATES = { normal: 1, slow: 0.8 } as const;
export type Rate = keyof typeof RATES;

let run = 0;
let player: HTMLAudioElement | null = null;
const stops = new Set<() => void>();
// Скрытие приложения (в том числе сворачивание Telegram) останавливает диалог.
if (typeof document !== "undefined")
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopDialogue();
  });

/** Один элемент на все реплики: iOS пускает звук только элементу, тронутому в жесте, а файл приходит после жеста. */
function unlockPlayer(): HTMLAudioElement | null {
  if (typeof Audio === "undefined") return null;
  player ??= new Audio();
  try {
    player.load();
  } catch {
    /* элемент без источника */
  }
  return player;
}

function playFile(audio: HTMLAudioElement, url: string, rate: number): Promise<boolean> {
  return new Promise((resolve) => {
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const finish = (ok: boolean) => {
      clearTimeout(watchdog);
      audio.removeEventListener("ended", ended);
      audio.removeEventListener("error", failed);
      audio.removeEventListener("loadedmetadata", measured);
      stops.delete(stop);
      resolve(ok);
    };
    const ended = () => finish(true);
    const failed = () => finish(false);
    const stop = () => finish(true);
    // Конец файла может не прийти (WebView); страховка — длительность записи с запасом.
    const measured = () => {
      if (Number.isFinite(audio.duration)) watchdog = setTimeout(ended, (audio.duration / rate) * 1000 + 3000);
    };
    audio.addEventListener("ended", ended);
    audio.addEventListener("error", failed);
    audio.addEventListener("loadedmetadata", measured);
    stops.add(stop);
    audio.src = url;
    // Загрузка нового источника сбрасывает скорость к defaultPlaybackRate.
    audio.defaultPlaybackRate = rate;
    audio.playbackRate = rate;
    audio.play().catch(failed);
  });
}
const available = () => typeof speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined";

function languageVoices(profile: LanguageProfile): Promise<SpeechSynthesisVoice[]> {
  if (!available()) return Promise.resolve([]);
  const read = () => voicesOf(speechSynthesis.getVoices(), profile);
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
function say(text: string, voice: SpeechSynthesisVoice, rate: number, pitch: number, lang: string): Promise<boolean> {
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
    utterance.lang = voice.lang || lang;
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

/**
 * Проигрывает диалог целиком; `onLine` сообщает номер звучащей реплики (для подсветки после ответа).
 * `source` отдаёт адрес записи реплики; пока звучит реплика, запись следующей уже скачивается.
 */
export async function playDialogue(
  lines: TranscriptLine[],
  rate: Rate = "normal",
  onLine?: (index: number) => void,
  source?: AssetSource,
  profile: LanguageProfile = PROFILES.el,
): Promise<DialogueResult> {
  const mine = ++run;
  for (const stop of stops) stop();
  if (available()) speechSynthesis.cancel();
  const audio = source && lines.some((line) => line.audioAssetId) ? unlockPlayer() : null;
  const fileOf = (index: number): Promise<string | null> => {
    const id = lines[index]?.audioAssetId;
    return audio && source && id ? source.url(id).catch(() => null) : Promise.resolve(null);
  };
  let voices: SpeechSynthesisVoice[] | null = null;
  let cast: ReturnType<typeof castOf> | null = null;
  let next = fileOf(0);
  try {
    for (const [index, line] of lines.entries()) {
      if (mine !== run) return "stopped";
      onLine?.(index);
      const url = await next;
      next = index + 1 < lines.length ? fileOf(index + 1) : Promise.resolve(null);
      let ok = false;
      if (mine === run && url && audio) ok = await playFile(audio, url, FILE_RATES[rate]);
      else if (mine === run) {
        voices ??= await languageVoices(profile);
        if (!voices.length) return "none";
        cast ??= castOf(lines, voices.length);
        const role = cast.get(line.speaker ?? "")!;
        ok = await say(line.text, voices[role.voice], RATES[rate], role.pitch, profile.voice);
      }
      if (url) releaseAssetUrl(url);
      if (mine !== run) return "stopped";
      if (!ok) return "error";
      // Короткая пауза между репликами, как в записи экзамена.
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  } finally {
    // Заранее скачанная запись следующей реплики не понадобилась: её адрес освобождается.
    void next.then((url) => url && releaseAssetUrl(url));
  }
  onLine?.(-1);
  return "done";
}

export function stopDialogue() {
  run++;
  for (const stop of stops) stop();
  if (player) {
    try {
      player.pause();
    } catch {
      /* элемент уже освобождён */
    }
  }
  if (available()) speechSynthesis.cancel();
}
