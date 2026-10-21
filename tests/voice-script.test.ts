import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { planAnswerVoices } from "../content/build/answers";
import { profileOf } from "../src/domain/language";
import {
  isLineFile,
  parseReply,
  parseVoices,
  redactKey,
  retrying,
  staleRecords,
  voiceableLessons,
  type VoiceManifest,
} from "../content/build/voices";

const response = (status: number, headers: Record<string, string> = {}) => new Response("", { status, headers });
const script = (...steps: (Response | Error)[]) => {
  const waits: number[] = [];
  let calls = 0;
  return {
    waits,
    calls: () => calls,
    send: async () => {
      const step = steps[Math.min(calls++, steps.length - 1)]!;
      if (step instanceof Error) throw step;
      return step;
    },
    sleep: async (ms: number) => void waits.push(ms),
  };
};

describe("повторы запроса к синтезу", () => {
  it("429, затем успех — одна пауза", async () => {
    const s = script(response(429), response(200));
    expect((await retrying(s.send, s.sleep)).status).toBe(200);
    expect(s.waits).toEqual([1000]);
  });

  it("503 пять раз подряд — последний ответ и паузы 1, 2, 4, 8 с", async () => {
    const s = script(response(503));
    expect((await retrying(s.send, s.sleep)).status).toBe(503);
    expect(s.calls()).toBe(5);
    expect(s.waits).toEqual([1000, 2000, 4000, 8000]);
  });

  it("Retry-After в секундах, с потолком; дата игнорируется", async () => {
    const s = script(
      response(429, { "retry-after": "3" }),
      response(429, { "retry-after": "999" }),
      response(429, { "retry-after": "Wed, 21 Oct 2026 07:28:00 GMT" }),
      response(200),
    );
    await retrying(s.send, s.sleep);
    expect(s.waits).toEqual([3000, 30000, 4000]);
  });

  it("сетевая ошибка повторяется; после пяти попыток бросается как есть", async () => {
    const ok = script(new TypeError("fetch failed"), response(200));
    expect((await retrying(ok.send, ok.sleep)).status).toBe(200);
    const down = script(new TypeError("fetch failed"));
    await expect(retrying(down.send, down.sleep)).rejects.toThrow("fetch failed");
    expect(down.calls()).toBe(5);
  });

  it("400 не повторяется", async () => {
    const s = script(response(400));
    expect((await retrying(s.send, s.sleep)).status).toBe(400);
    expect(s.calls()).toBe(1);
  });

  it("ответ не JSON: ошибка с кодом и началом тела, без падения разбора", () => {
    expect(parseReply(502, "<html>Bad Gateway</html>", "k")).toEqual({
      audio: undefined,
      problem: "502 <html>Bad Gateway</html>",
    });
    expect(parseReply(500, "null", "k").problem).toBe("500 null");
    expect(parseReply(200, '{"audioContent":"AAA"}', "k")).toEqual({ audio: "AAA", problem: "200" });
    expect(parseReply(403, '{"error":{"message":"key AIza-1 denied"}}', "AIza-1").problem).toBe("403 key *** denied");
  });

  it("ключ в тексте ошибки заменяется", () => {
    expect(redactKey("bad key AIza-1 and AIza-1", "AIza-1")).toBe("bad key *** and ***");
    expect(redactKey("text", undefined)).toBe("text");
  });
});

describe("отбор уроков и очистка озвучки", () => {
  const lessons = ["e02-1", "m01-1", "m01-2"];
  const drafts = new Set(["e02-1"]);

  it("без аргументов черновые уроки пропущены, явно названный озвучивается", () => {
    expect(voiceableLessons(lessons, drafts, [])).toEqual(["m01-1", "m01-2"]);
    expect(voiceableLessons(lessons, drafts, ["e02-1", "words"])).toEqual(["e02-1"]);
  });

  it("файл реплики отличается от слова, фразы, текста и ответа", () => {
    expect(isLineFile("m01-1/party-3.mp3")).toBe(true);
    for (const file of ["words/w001.mp3", "phrases/p-1.mp3", "readings/r-1/2.mp3", "answers/m01-1/a-b1.mp3", "x.mp3"])
      expect(isLineFile(file)).toBe(false);
  });

  it("лишние файлы с диска и из манифеста; запланированные и чужая область целы", () => {
    const manifest: VoiceManifest = {
      "m01-1/party-9.mp3": { voice: "A", hash: "h" },
      "m01-1/party-1.mp3": { voice: "A", hash: "h" },
    };
    const planned = new Set(["m01-1/party-1.mp3", "words/w001.mp3"]);
    const existing = ["m01-1/party-1.mp3", "m01-1/party-8.mp3", "words/w002.mp3", "gone-1/x-1.mp3"];
    expect(staleRecords(planned, manifest, existing, isLineFile)).toEqual([
      "gone-1/x-1.mp3",
      "m01-1/party-8.mp3",
      "m01-1/party-9.mp3",
    ]);
    expect(staleRecords(planned, manifest, existing, (file) => file.startsWith("words/"))).toEqual(["words/w002.mp3"]);
  });

  it("ответы удерживаемого урока не озвучиваются и не считаются лишними", () => {
    const voices = parseVoices(
      "source: S {voice}\nlanguage: el-GR\nprefix: el-GR-Chirp3-HD-\npools: { female: [Kore], male: [Puck] }\nnarrator: Kore\ncharacters: {}\n",
      "voices/el.yaml",
    );
    const blocks = [
      { type: "exercise", id: "b", format: "text", items: [{ id: "n1", prompt: "дом", answer: "σπίτι" }] },
    ];
    const manifest: VoiceManifest = { "answers/e02-1/b-n1.mp3": { voice: "Kore", hash: "old" } };
    const plan = planAnswerVoices(
      [["e02-1", blocks]],
      () => ({ voices, profile: profileOf("el"), held: true }),
      manifest,
      ["answers/e02-1/b-n1.mp3"],
    );
    expect(plan.pending).toEqual([]);
    expect(plan.stale).toEqual([]);
  });
});

describe("--course ограничивает озвучку карточек одним курсом", () => {
  const run = (...args: string[]) =>
    spawnSync(process.execPath, ["scripts/voice-dialogues.ts", "--check", "words", "phrases", ...args], {
      encoding: "utf8",
    });
  const pending = (out: string) => out.split("\n").filter((line) => line.includes("нет записи или устарела"));

  it("в проверке только записи названного курса", { timeout: 30_000 }, () => {
    for (const course of ["greek-a2", "english-it"]) {
      const result = run(`--course=${course}`);
      expect(result.status, result.stderr).toBe(0);
      for (const line of pending(result.stdout)) expect(line, course).toContain(`/${course}/`);
    }
  });

  it("неизвестный курс — ошибка со списком курсов", { timeout: 30_000 }, () => {
    const result = run("--course=nope");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Курса nope нет; есть:");
  });
});
