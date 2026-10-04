import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TranscriptLine } from "../src/content/course";

/** Поддельный `<audio>`: доигрывает файл через такт и запоминает, что и с какой скоростью звучало. */
interface Played {
  src: string;
  rate: number;
}
function fakeAudio(options: { refuse?: boolean } = {}) {
  const played: Played[] = [];
  let loads = 0;
  class FakeAudio {
    src = "";
    playbackRate = 1;
    defaultPlaybackRate = 1;
    duration = 2;
    private listeners = new Map<string, Set<() => void>>();
    addEventListener(type: string, listener: () => void) {
      this.listeners.set(type, (this.listeners.get(type) ?? new Set()).add(listener));
    }
    removeEventListener(type: string, listener: () => void) {
      this.listeners.get(type)?.delete(listener);
    }
    load() {
      loads++;
    }
    pause() {}
    play() {
      if (options.refuse) return Promise.reject(new Error("NotAllowedError"));
      played.push({ src: this.src, rate: this.playbackRate });
      setTimeout(() => this.listeners.get("ended")?.forEach((listener) => listener()), 10);
      return Promise.resolve();
    }
  }
  (globalThis as { Audio?: unknown }).Audio = FakeAudio;
  return { played, loads: () => loads };
}
class FakeUtterance {
  voice: unknown = null;
  lang = "";
  rate = 1;
  pitch = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  constructor(public text: string) {}
}
function fakeSynth() {
  const spoken: FakeUtterance[] = [];
  (globalThis as { speechSynthesis?: unknown }).speechSynthesis = {
    getVoices: () => [{ lang: "el-GR", name: "Greek" }],
    speak(utterance: FakeUtterance) {
      spoken.push(utterance);
      setTimeout(() => utterance.onstart?.(), 1);
      setTimeout(() => utterance.onend?.(), 5);
    },
    cancel() {},
    addEventListener() {},
    removeEventListener() {},
  };
  (globalThis as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance = FakeUtterance;
  return spoken;
}
const lines: TranscriptLine[] = [
  { speaker: "Αντρέας", text: "Καλησπέρα!", audioAssetId: "line-1" },
  { speaker: "Μαρίνα", text: "Γεια σου!", audioAssetId: "line-2" },
  { speaker: "Αντρέας", text: "Χάρηκα.", audioAssetId: "line-3" },
];
/** Источник записей: отдаёт адрес по id и запоминает порядок запросов; `missing` — записи, которых нет. */
function source(missing: string[] = []) {
  const asked: string[] = [];
  return {
    asked,
    url: vi.fn(async (id: string) => {
      asked.push(id);
      return missing.includes(id) ? null : `/media/${id}.mp3`;
    }),
  };
}

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  delete (globalThis as { Audio?: unknown }).Audio;
  delete (globalThis as { speechSynthesis?: unknown }).speechSynthesis;
  delete (globalThis as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance;
});

describe("аудирование записями реплик", () => {
  it("реплики звучат файлами по порядку, синтез не нужен; подсветка идёт по репликам", async () => {
    const audio = fakeAudio();
    const spoken = fakeSynth();
    const { playDialogue } = await import("../src/shared/dialogue");
    const shown: number[] = [];
    const result = await playDialogue(lines, "normal", (index) => shown.push(index), source());
    expect(result).toBe("done");
    expect(audio.played).toEqual([
      { src: "/media/line-1.mp3", rate: 1 },
      { src: "/media/line-2.mp3", rate: 1 },
      { src: "/media/line-3.mp3", rate: 1 },
    ]);
    expect(spoken).toHaveLength(0);
    expect(shown).toEqual([0, 1, 2, -1]);
    expect(audio.loads()).toBe(1);
  });
  it("медленный режим замедляет файл, а не берёт другой", async () => {
    const audio = fakeAudio();
    fakeSynth();
    const { playDialogue } = await import("../src/shared/dialogue");
    await playDialogue(lines.slice(0, 1), "slow", undefined, source());
    expect(audio.played).toEqual([{ src: "/media/line-1.mp3", rate: 0.8 }]);
  });
  it("запись следующей реплики запрашивается, пока звучит текущая", async () => {
    const audio = fakeAudio();
    fakeSynth();
    const { playDialogue } = await import("../src/shared/dialogue");
    const files = source();
    const asked: number[] = [];
    await playDialogue(lines, "normal", () => asked.push(files.asked.length), files);
    // Пока подсвечена первая реплика, запрошена только её запись; во время её звучания — уже вторая.
    expect(asked.slice(0, 2)).toEqual([1, 2]);
    expect(audio.played).toHaveLength(3);
  });
  it("записи нет на устройстве и её не скачать — реплика звучит синтезом, остальные файлами", async () => {
    const audio = fakeAudio();
    const spoken = fakeSynth();
    const { playDialogue } = await import("../src/shared/dialogue");
    const result = await playDialogue(lines, "normal", undefined, source(["line-2"]));
    expect(result).toBe("done");
    expect(audio.played.map((entry) => entry.src)).toEqual(["/media/line-1.mp3", "/media/line-3.mp3"]);
    expect(spoken.map((utterance) => utterance.text)).toEqual(["Γεια σου!"]);
  });
  it("без записей диалог звучит синтезом устройства, как раньше", async () => {
    const audio = fakeAudio();
    const spoken = fakeSynth();
    const { playDialogue } = await import("../src/shared/dialogue");
    const plain = lines.map(({ audioAssetId: _, ...line }) => line);
    expect(await playDialogue(plain, "slow", undefined, source())).toBe("done");
    expect(audio.played).toHaveLength(0);
    expect(spoken.map((utterance) => utterance.rate)).toEqual([0.75, 0.75, 0.75]);
  });
  it("отказ воспроизведения файла — ошибка, а не молчаливая подмена голосом", async () => {
    fakeAudio({ refuse: true });
    const spoken = fakeSynth();
    const { playDialogue } = await import("../src/shared/dialogue");
    expect(await playDialogue(lines, "normal", undefined, source())).toBe("error");
    expect(spoken).toHaveLength(0);
  });
  it("остановка прерывает диалог на текущей реплике", async () => {
    const audio = fakeAudio();
    fakeSynth();
    const { playDialogue, stopDialogue } = await import("../src/shared/dialogue");
    const playing = playDialogue(lines, "normal", (index) => index === 1 && stopDialogue(), source());
    expect(await playing).toBe("stopped");
    expect(audio.played.map((entry) => entry.src)).toEqual(["/media/line-1.mp3"]);
  });
});
