import { useEffect, useState } from "react";
import { ensureAsset } from "../content/client";
import type { Word } from "../domain/types";
import { dbAssetSource, releaseAssetUrl, type AssetSource } from "./store";

export type AudioKind = "file" | "voice" | "none";
/** Итог воспроизведения: `error` — файл или голос есть, но проигрывание отклонено; это не ошибка знания слова. */
export type PlayResult = AudioKind | "error";
let cachedVoice: SpeechSynthesisVoice | null | undefined;
let current: HTMLAudioElement | null = null;
// Список голосов приходит асинхронно, поэтому сбрасываем кеш, когда браузер его обновил.
if (typeof speechSynthesis !== "undefined") {
  speechSynthesis.getVoices();
  speechSynthesis.addEventListener("voiceschanged", () => {
    cachedVoice = undefined;
  });
}
// Скрытие приложения (в том числе сворачивание Telegram) останавливает звук.
if (typeof document !== "undefined")
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopAudio();
  });

function greekVoice(): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === "undefined") return null;
  if (cachedVoice !== undefined) return cachedVoice;
  let voices: SpeechSynthesisVoice[] = [];
  try {
    voices = speechSynthesis.getVoices();
  } catch {
    return null;
  }
  if (!voices.length) return null;
  cachedVoice = voices.find((voice) => voice.lang?.toLowerCase().startsWith("el")) ?? null;
  return cachedVoice;
}
export const hasGreekVoice = () => !!greekVoice();

/** Сколько ждём начала речи, прежде чем считать реплику потерянной: синтезатор начинает за десятки миллисекунд. */
const START_TIMEOUT = 300;
/** Сколько ждём список голосов: браузер отдаёт его асинхронно, пустой ответ — ещё не отказ. */
const VOICES_TIMEOUT = 1000;
/** Такт между отменой и следующей репликой: «cancel → сразу speak» синтезаторы теряют молча. */
const RESTART_DELAY = 60;
const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** Голоса после загрузки списка; пустой список к сроку означает, что голосов нет. */
function voicesReady(): Promise<SpeechSynthesisVoice[]> {
  if (typeof speechSynthesis === "undefined") return Promise.resolve([]);
  const read = () => {
    try {
      return speechSynthesis.getVoices();
    } catch {
      return [];
    }
  };
  const first = read();
  if (first.length) return Promise.resolve(first);
  return new Promise((resolve) => {
    let done = false;
    const finish = (list: SpeechSynthesisVoice[]) => {
      if (done) return;
      done = true;
      speechSynthesis.removeEventListener("voiceschanged", update);
      resolve(list);
    };
    const update = () => {
      cachedVoice = undefined;
      const list = read();
      if (list.length) finish(list);
    };
    speechSynthesis.addEventListener("voiceschanged", update);
    setTimeout(() => finish(read()), VOICES_TIMEOUT);
  });
}
/** Греческий голос с ожиданием списка: до загрузки голосов отказывать рано. */
async function greekVoiceReady(): Promise<SpeechSynthesisVoice | null> {
  const direct = greekVoice();
  if (direct) return direct;
  const voices = await voicesReady();
  if (!voices.length) return null;
  cachedVoice = voices.find((voice) => voice.lang?.toLowerCase().startsWith("el")) ?? null;
  return cachedVoice;
}
/**
 * Одна попытка озвучки. Успех — событие начала речи, а не факт вызова: синтезатор принимает реплику
 * и может её потерять, не сообщив об этом ни ошибкой, ни событием.
 */
function speakOnce(text: string, voice: SpeechSynthesisVoice, rate: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (started: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(started);
    };
    try {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = voice;
      utterance.lang = voice.lang || "el-GR";
      utterance.rate = rate;
      utterance.onstart = () => finish(true);
      utterance.onerror = () => finish(false);
      timer = setTimeout(() => finish(false), START_TIMEOUT);
      speechSynthesis.speak(utterance);
    } catch {
      finish(false);
    }
  });
}
/** Озвучка голосом с одной повторной попыткой: молчание после повтора — честный отказ, а не мнимый успех. */
async function speakVoice(text: string, rate: number, stopped: boolean): Promise<PlayResult> {
  const voice = await greekVoiceReady();
  if (!voice) return "none";
  if (stopped) await wait(RESTART_DELAY); // отменённой реплике нужен такт, иначе синтезатор съест новую
  if (await speakOnce(text, voice, rate)) return "voice";
  cancelSpeech();
  await wait(RESTART_DELAY);
  return (await speakOnce(text, voice, rate)) ? "voice" : "error";
}
/** Предложения читает системный голос: записанных файлов для примеров нет. */
export function speakPhrase(text: string): Promise<PlayResult> {
  return speakVoice(text, 0.85, stopAudio());
}
export function audioKind(word: Word | undefined): AudioKind {
  if (!word) return "none";
  if (word.audioAssetId) return "file";
  return greekVoice() ? "voice" : "none";
}
/** Занят ли синтезатор: холостая отмена ломает следующую реплику, поэтому отменяем только говорящего. */
const speaking = () => typeof speechSynthesis !== "undefined" && (speechSynthesis.speaking || speechSynthesis.pending);
function cancelSpeech(): boolean {
  if (!speaking()) return false;
  try {
    speechSynthesis.cancel();
  } catch {
    /* синтез недоступен */
  }
  return true;
}
/** Возвращает, была ли остановлена речь: следующей реплике после отмены нужен такт. */
export function stopAudio(): boolean {
  if (current) {
    try {
      current.pause();
      current.currentTime = 0;
    } catch {
      /* элемент уже освобождён */
    }
    current = null;
  }
  return cancelSpeech();
}
/**
 * Отказ воспроизведения не подавляется: экран получает `error` и предлагает повтор или продолжение без аудирования.
 * Файл, который не проигрался, не подменяется голосом молча — иначе пользователь услышит другое произношение.
 */
export async function playWord(word: Word, source: AssetSource = dbAssetSource): Promise<PlayResult> {
  const stopped = stopAudio();
  if (word.audioAssetId) {
    const url = await source.url(word.audioAssetId).catch(() => null);
    if (url) {
      const audio = new Audio(url);
      current = audio;
      const release = () => releaseAssetUrl(url);
      audio.addEventListener("ended", release, { once: true });
      try {
        await audio.play();
        return "file";
      } catch {
        release();
        if (current === audio) current = null;
        return "error";
      }
    }
    if (!(await greekVoiceReady())) return "error"; // файл обещан, но недоступен, а голоса нет
  }
  return speakVoice(word.greek, 0.9, stopped);
}
/** Голос появляется асинхронно, поэтому доступность пересчитывается после загрузки списка. */
export function useGreekVoice(): boolean {
  const [available, setAvailable] = useState(hasGreekVoice);
  useEffect(() => {
    setAvailable(hasGreekVoice());
    if (typeof speechSynthesis === "undefined") return;
    const update = () => {
      cachedVoice = undefined;
      setAvailable(hasGreekVoice());
    };
    speechSynthesis.addEventListener("voiceschanged", update);
    return () => speechSynthesis.removeEventListener("voiceschanged", update);
  }, []);
  return available;
}

/** Голоса появляются асинхронно, поэтому доступность пересчитывается после загрузки. */
export function useAudioKind(word: Word | undefined): AudioKind {
  const [kind, setKind] = useState<AudioKind>(() => audioKind(word));
  useEffect(() => {
    setKind(audioKind(word));
    if (typeof speechSynthesis === "undefined") return;
    const update = () => {
      cachedVoice = undefined;
      setKind(audioKind(word));
    };
    speechSynthesis.addEventListener("voiceschanged", update);
    return () => speechSynthesis.removeEventListener("voiceschanged", update);
  }, [word?.id, word?.audioAssetId]);
  return kind;
}

/** Файл, если он обещан записью, иначе системный голос: общий путь для слова, фразы и полного предложения пропуска. */
export async function playText(text: string, audioAssetId?: string): Promise<PlayResult> {
  const stopped = stopAudio();
  if (audioAssetId) {
    const asset = await ensureAsset(audioAssetId).catch(() => null);
    if (asset) {
      const url = URL.createObjectURL(asset.blob);
      const audio = new Audio(url);
      current = audio;
      const release = () => URL.revokeObjectURL(url);
      audio.addEventListener("ended", release, { once: true });
      try {
        await audio.play();
        return "file";
      } catch {
        release();
        if (current === audio) current = null;
        return "error";
      }
    }
    if (!(await greekVoiceReady())) return "error";
  }
  return speakVoice(text, 0.85, stopped);
}
export const textAudioKind = (audioAssetId: string | undefined): AudioKind =>
  audioAssetId ? "file" : greekVoice() ? "voice" : "none";
/** Доступность озвучки текста; голос появляется асинхронно. */
export function useTextAudioKind(audioAssetId: string | undefined): AudioKind {
  const [kind, setKind] = useState<AudioKind>(() => textAudioKind(audioAssetId));
  useEffect(() => {
    setKind(textAudioKind(audioAssetId));
    if (typeof speechSynthesis === "undefined") return;
    const update = () => {
      cachedVoice = undefined;
      setKind(textAudioKind(audioAssetId));
    };
    speechSynthesis.addEventListener("voiceschanged", update);
    return () => speechSynthesis.removeEventListener("voiceschanged", update);
  }, [audioAssetId]);
  return kind;
}
