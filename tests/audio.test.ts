import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Word } from "../src/domain/types";

/**
 * Проигрыватель проверяется на поддельном синтезаторе: настоящий браузерный теряет реплики молча,
 * и именно это поведение здесь воспроизводится — «принял, но не заговорил».
 */
type Behavior = "ok" | "drop" | "error";
class FakeUtterance {
  text: string;
  voice: unknown = null;
  lang = "";
  rate = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}
interface FakeState {
  speaking: boolean;
  pending: boolean;
  spoken: FakeUtterance[];
  cancels: number;
  script: Behavior[];
  voices: { lang: string; name: string }[];
}
function fakeSynth(over: Partial<FakeState> = {}) {
  const state: FakeState = {
    speaking: false,
    pending: false,
    spoken: [],
    cancels: 0,
    script: [],
    voices: [{ lang: "el-GR", name: "Greek test" }],
    ...over,
  };
  const listeners = new Map<string, (() => void)[]>();
  const synth = {
    get speaking() {
      return state.speaking;
    },
    get pending() {
      return state.pending;
    },
    getVoices: () => state.voices,
    speak(utterance: FakeUtterance) {
      state.spoken.push(utterance);
      const behavior = state.script.shift() ?? "ok";
      if (behavior === "ok") {
        state.speaking = true;
        setTimeout(() => {
          utterance.onstart?.();
        }, 1);
      } else if (behavior === "error") setTimeout(() => utterance.onerror?.({ error: "synthesis-failed" }), 1);
      // 'drop' — реплика принята и потеряна: ни старта, ни ошибки
    },
    cancel() {
      state.cancels++;
      state.speaking = false;
    },
    addEventListener(type: string, listener: () => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((item) => item !== listener),
      );
    },
  };
  const fire = (type: string) => [...(listeners.get(type) ?? [])].forEach((listener) => listener());
  return { synth, state, fire };
}
const word = (over: Partial<Word> = {}): Word => ({
  id: "w1",
  greek: "το σπίτι",
  russian: "дом",
  ipa: "",
  segments: [],
  examples: [],
  verified: false,
  createdAt: "",
  updatedAt: "",
  ...over,
});

async function load(synth: unknown) {
  vi.resetModules();
  (globalThis as { speechSynthesis?: unknown }).speechSynthesis = synth;
  (globalThis as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance = FakeUtterance;
  return import("../src/shared/audio");
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { speechSynthesis?: unknown }).speechSynthesis;
  delete (globalThis as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance;
});

describe("озвучка системным голосом", () => {
  it("успех подтверждается началом речи, а не фактом вызова", async () => {
    const { synth, state } = fakeSynth();
    const { playWord } = await load(synth);
    const result = playWord(word());
    await vi.advanceTimersByTimeAsync(50);
    expect(await result).toBe("voice");
    expect(state.spoken).toHaveLength(1);
    expect(state.cancels).toBe(0); // синтезатор свободен — отменять нечего
  });

  it("потерянная реплика повторяется один раз и звучит", async () => {
    const { synth, state } = fakeSynth({ script: ["drop", "ok"] });
    const { playWord } = await load(synth);
    const result = playWord(word());
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toBe("voice");
    expect(state.spoken).toHaveLength(2);
    expect(state.spoken.map((item) => item.text)).toEqual(["το σπίτι", "το σπίτι"]);
  });

  it("молчание дважды — честный отказ, а не мнимый успех", async () => {
    const { synth, state } = fakeSynth({ script: ["drop", "drop"] });
    const { playWord } = await load(synth);
    const result = playWord(word());
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toBe("error");
    expect(state.spoken).toHaveLength(2); // повтор был ровно один
  });

  it("ошибка синтезатора тоже даёт повтор", async () => {
    const { synth, state } = fakeSynth({ script: ["error", "ok"] });
    const { playText } = await load(synth);
    const result = playText("Γεια σου!");
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toBe("voice");
    expect(state.spoken).toHaveLength(2);
  });

  it("отмена прошлой реплики не съедает новую", async () => {
    const { synth, state } = fakeSynth();
    const { playWord } = await load(synth);
    const first = playWord(word());
    await vi.advanceTimersByTimeAsync(50);
    expect(await first).toBe("voice");
    expect(state.speaking).toBe(true);
    const second = playWord(word({ greek: "η θάλασσα" }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(await second).toBe("voice");
    expect(state.cancels).toBe(1); // занятый синтезатор остановлен ровно раз
    expect(state.spoken).toHaveLength(2); // второй реплике повтор не понадобился
  });

  it("пустой список голосов не приговор: ждём загрузки", async () => {
    const { synth, state, fire } = fakeSynth({ voices: [] });
    const { playWord } = await load(synth);
    const result = playWord(word());
    await vi.advanceTimersByTimeAsync(100);
    state.voices = [{ lang: "el-GR", name: "Greek test" }];
    fire("voiceschanged");
    await vi.advanceTimersByTimeAsync(100);
    expect(await result).toBe("voice");
  });

  it("голоса так и не пришли — озвучки нет", async () => {
    const { synth, state } = fakeSynth({ voices: [] });
    const { playWord } = await load(synth);
    const result = playWord(word());
    await vi.advanceTimersByTimeAsync(2000);
    expect(await result).toBe("none");
    expect(state.spoken).toHaveLength(0);
  });

  it("греческий голос выбирается среди чужих", async () => {
    const { synth, state } = fakeSynth({
      voices: [
        { lang: "ru-RU", name: "Русский" },
        { lang: "el-GR", name: "Ελληνικά" },
      ],
    });
    const { playWord } = await load(synth);
    const result = playWord(word());
    await vi.advanceTimersByTimeAsync(50);
    expect(await result).toBe("voice");
    expect((state.spoken[0].voice as { lang: string }).lang).toBe("el-GR");
  });

  it("остановка молчащего синтезатора его не дёргает", async () => {
    const { synth, state } = fakeSynth();
    const { stopAudio } = await load(synth);
    stopAudio();
    expect(state.cancels).toBe(0);
    state.speaking = true;
    stopAudio();
    expect(state.cancels).toBe(1);
  });
});

describe("звук из источника просмотра", () => {
  it("играет файл по адресу пакета без обращения к базе и без запасного голоса", async () => {
    const played: string[] = [];
    (globalThis as { Audio?: unknown }).Audio = class {
      src: string;
      constructor(src: string) {
        this.src = src;
      }
      addEventListener() {}
      pause() {}
      play() {
        played.push(this.src);
        return Promise.resolve();
      }
    };
    const { synth, state } = fakeSynth();
    vi.resetModules();
    const ensureAsset = vi.fn(async () => null);
    vi.doMock("../src/content/client", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../src/content/client")>()),
      ensureAsset,
    }));
    (globalThis as { speechSynthesis?: unknown }).speechSynthesis = synth;
    (globalThis as { SpeechSynthesisUtterance?: unknown }).SpeechSynthesisUtterance = FakeUtterance;
    const { playWord } = await import("../src/shared/audio");
    const { packageAssetSource } = await import("../src/shared/store");
    const media = { id: "snd-w1", kind: "audio", url: "content/media/snd-w1@abc.mp3" };
    const pack = { media: [media] } as unknown as Parameters<typeof packageAssetSource>[0];
    const result = await playWord(word({ audioAssetId: "snd-w1" }), packageAssetSource(pack));
    expect(result).toBe("file");
    expect(played).toEqual(["/content/media/snd-w1@abc.mp3"]);
    expect(ensureAsset).not.toHaveBeenCalled();
    expect(state.spoken).toHaveLength(0);
    vi.doUnmock("../src/content/client");
    delete (globalThis as { Audio?: unknown }).Audio;
  });
});
