import { useEffect, useState } from "react";
import { ensureAsset } from "../content/client";
import { PROFILES, spokenText, type Language, type LanguageProfile } from "../domain/language";
import type { Word } from "../domain/types";
import { dbAssetSource, releaseAssetUrl, type AssetSource } from "./store";
import { voicesOf } from "./voices";

export type AudioKind = "file" | "voice" | "none";
/**
 * Итог воспроизведения: `error` — файл или голос есть, но проигрывание отклонено; это не ошибка знания слова.
 * `stopped` — до начала звука его остановили или запустили другой.
 */
export type PlayResult = AudioKind | "error" | "stopped";
const cachedVoices = new Map<Language, SpeechSynthesisVoice | null>();
let current: { audio: HTMLAudioElement; release: () => void } | null = null;
/** Растёт при каждой остановке: вызов, дождавшийся файла после неё, уже не должен звучать. */
let generation = 0;
// Список голосов приходит асинхронно, поэтому сбрасываем кеш, когда браузер его обновил.
if (typeof speechSynthesis !== "undefined") {
  speechSynthesis.getVoices();
  speechSynthesis.addEventListener("voiceschanged", () => cachedVoices.clear());
}
// Скрытие приложения (в том числе сворачивание Telegram) останавливает звук.
if (typeof document !== "undefined")
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopAudio();
  });

const pick = (voices: SpeechSynthesisVoice[], profile: LanguageProfile) => {
  const voice = voicesOf(voices, profile)[0] ?? null;
  cachedVoices.set(profile.code, voice);
  return voice;
};

function voiceOf(profile: LanguageProfile): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === "undefined") return null;
  const cached = cachedVoices.get(profile.code);
  if (cached !== undefined) return cached;
  let voices: SpeechSynthesisVoice[] = [];
  try {
    voices = speechSynthesis.getVoices();
  } catch {
    return null;
  }
  if (!voices.length) return null;
  return pick(voices, profile);
}
export const hasVoiceFor = (language: Language) => !!voiceOf(PROFILES[language]);

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
      cachedVoices.clear();
      const list = read();
      if (list.length) finish(list);
    };
    speechSynthesis.addEventListener("voiceschanged", update);
    setTimeout(() => finish(read()), VOICES_TIMEOUT);
  });
}
/** Голос языка с ожиданием списка: до загрузки голосов отказывать рано. */
async function voiceReady(profile: LanguageProfile): Promise<SpeechSynthesisVoice | null> {
  const direct = voiceOf(profile);
  if (direct) return direct;
  const voices = await voicesReady();
  if (!voices.length) return null;
  return pick(voices, profile);
}
/**
 * Одна попытка озвучки. Успех — событие начала речи, а не факт вызова: синтезатор принимает реплику
 * и может её потерять, не сообщив об этом ни ошибкой, ни событием.
 */
function speakOnce(text: string, voice: SpeechSynthesisVoice, rate: number, lang: string): Promise<boolean> {
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
      const utterance = new SpeechSynthesisUtterance(spokenText(text, lang));
      utterance.voice = voice;
      utterance.lang = voice.lang || lang;
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
async function speakVoice(
  text: string,
  rate: number,
  stopped: boolean,
  profile: LanguageProfile,
  mine = generation,
): Promise<PlayResult> {
  const voice = await voiceReady(profile);
  if (mine !== generation) return "stopped";
  if (!voice) return "none";
  if (stopped) await wait(RESTART_DELAY); // отменённой реплике нужен такт, иначе синтезатор съест новую
  if (mine !== generation) return "stopped";
  if (await speakOnce(text, voice, rate, profile.voice)) return "voice";
  cancelSpeech();
  await wait(RESTART_DELAY);
  if (mine !== generation) return "stopped"; // реплику оборвала остановка, а не синтезатор — повтор не нужен
  return (await speakOnce(text, voice, rate, profile.voice)) ? "voice" : "error";
}
/** Предложения читает системный голос: записанных файлов для примеров нет. */
export function speakPhrase(text: string, profile: LanguageProfile): Promise<PlayResult> {
  return speakVoice(text, 0.85, stopAudio(), profile);
}
export function audioKind(word: Word | undefined, profile: LanguageProfile): AudioKind {
  if (!word) return "none";
  if (word.audioAssetId) return "file";
  return voiceOf(profile) ? "voice" : "none";
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
  generation++;
  if (current) {
    const { audio, release } = current;
    current = null;
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch {
      /* элемент уже освобождён */
    }
    release();
  }
  return cancelSpeech();
}
/** Файл звучит, только если за время загрузки звук не остановили; адрес освобождается при любом исходе. */
async function playFile(url: string, free: (url: string) => void, mine: number): Promise<PlayResult> {
  let freed = false;
  const release = () => {
    if (freed) return;
    freed = true;
    free(url);
  };
  if (mine !== generation) {
    release();
    return "stopped";
  }
  const audio = new Audio(url);
  current = { audio, release };
  const finish = () => {
    release();
    if (current?.audio === audio) current = null;
  };
  audio.addEventListener("ended", finish, { once: true });
  try {
    await audio.play();
    return "file";
  } catch {
    finish();
    return mine === generation ? "error" : "stopped";
  }
}
/**
 * Отказ воспроизведения не подавляется: экран получает `error` и предлагает повтор или продолжение без аудирования.
 * Файл, который не проигрался, не подменяется голосом молча — иначе пользователь услышит другое произношение.
 */
export async function playWord(
  word: Word,
  profile: LanguageProfile,
  source: AssetSource = dbAssetSource,
): Promise<PlayResult> {
  const stopped = stopAudio();
  const mine = generation;
  if (word.audioAssetId) {
    const url = await source.url(word.audioAssetId).catch(() => null);
    if (url) return playFile(url, releaseAssetUrl, mine);
    if (mine !== generation) return "stopped";
    if (!(await voiceReady(profile))) return mine === generation ? "error" : "stopped"; // файл обещан, но недоступен, а голоса нет
  }
  return speakVoice(word.greek, 0.9, stopped, profile, mine);
}
/** Голос появляется асинхронно, поэтому доступность пересчитывается после загрузки списка. */
export function useVoice(profile: LanguageProfile): boolean {
  const language = profile.code;
  const [available, setAvailable] = useState(() => hasVoiceFor(language));
  useEffect(() => {
    setAvailable(hasVoiceFor(language));
    if (typeof speechSynthesis === "undefined") return;
    const update = () => {
      cachedVoices.clear();
      setAvailable(hasVoiceFor(language));
    };
    speechSynthesis.addEventListener("voiceschanged", update);
    return () => speechSynthesis.removeEventListener("voiceschanged", update);
  }, [language]);
  return available;
}

/** Голоса появляются асинхронно, поэтому доступность пересчитывается после загрузки. */
export function useAudioKind(word: Word | undefined, profile: LanguageProfile): AudioKind {
  const [kind, setKind] = useState<AudioKind>(() => audioKind(word, profile));
  useEffect(() => {
    setKind(audioKind(word, profile));
    if (typeof speechSynthesis === "undefined") return;
    const update = () => {
      cachedVoices.clear();
      setKind(audioKind(word, profile));
    };
    speechSynthesis.addEventListener("voiceschanged", update);
    return () => speechSynthesis.removeEventListener("voiceschanged", update);
  }, [word?.id, word?.audioAssetId, profile]);
  return kind;
}

/** Файл, если он обещан записью, иначе системный голос: общий путь для слова, фразы и полного предложения пропуска. */
export async function playText(
  text: string,
  audioAssetId: string | undefined,
  profile: LanguageProfile,
): Promise<PlayResult> {
  const stopped = stopAudio();
  const mine = generation;
  if (audioAssetId) {
    const asset = await ensureAsset(audioAssetId).catch(() => null);
    if (asset) return playFile(URL.createObjectURL(asset.blob), (url) => URL.revokeObjectURL(url), mine);
    if (mine !== generation) return "stopped";
    if (!(await voiceReady(profile))) return mine === generation ? "error" : "stopped";
  }
  return speakVoice(text, 0.85, stopped, profile, mine);
}
export const textAudioKind = (audioAssetId: string | undefined, profile: LanguageProfile): AudioKind =>
  audioAssetId ? "file" : voiceOf(profile) ? "voice" : "none";
/** Доступность озвучки текста; голос появляется асинхронно. */
export function useTextAudioKind(audioAssetId: string | undefined, profile: LanguageProfile): AudioKind {
  const [kind, setKind] = useState<AudioKind>(() => textAudioKind(audioAssetId, profile));
  useEffect(() => {
    setKind(textAudioKind(audioAssetId, profile));
    if (typeof speechSynthesis === "undefined") return;
    const update = () => {
      cachedVoices.clear();
      setKind(textAudioKind(audioAssetId, profile));
    };
    speechSynthesis.addEventListener("voiceschanged", update);
    return () => speechSynthesis.removeEventListener("voiceschanged", update);
  }, [audioAssetId, profile]);
  return kind;
}
