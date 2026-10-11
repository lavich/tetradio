import { describe, expect, it } from "vitest";
import { planReadingVoices, readingVoicing } from "../content/build/readings";
import type { CourseCard, ReadingSource } from "../content/build/sources";
import { lineHash, parseVoices, type VoiceManifest } from "../content/build/voices";

const map = parseVoices(
  `source: TTS {voice}
language: el-GR
prefix: el-GR-Chirp3-HD-
pools: { female: [Aoede, Kore, Leda], male: [Charon, Puck] }
reader: Puck
characters:
  Άννα: { gender: female, voice: Kore }
  Νίκος: { gender: male, voice: Charon }
  Μαρία: { gender: female, voice: Leda }
  Ελένη: { gender: female, voice: Leda }
`,
  "voices/el.yaml",
);
const voicing = (text: string, speakers?: string[], narrator?: string) =>
  readingVoicing("r-t", text, speakers, narrator, map, "readings/r-t.yaml");

describe("голоса текста для чтения", () => {
  it("чтец карты — голос из пулов", () => {
    expect(map.reader).toBe("Puck");
    const body =
      "source: TTS {voice}\nlanguage: el-GR\nprefix: el-GR-Chirp3-HD-\npools: { female: [Kore], male: [Puck] }\n";
    expect(() => parseVoices(`${body}reader: Fenrir\n`, "voices/el.yaml")).toThrow(/reader/);
  });

  it("повествование — чтец, реплики — голоса героев, пустое имя — рассказчик", () => {
    const sentences = voicing("Ο Νίκος έρχεται. Λέει:\n— Γεια! Τι κάνεις;\n— Καλά.\n— Λένε έτσι.", [
      "Νίκος",
      "Άννα",
      "",
    ]);
    expect(sentences.map(({ text, voice }) => [text, voice])).toEqual([
      ["Ο Νίκος έρχεται.", "Puck"],
      ["Λέει:", "Puck"],
      ["— Γεια!", "Charon"],
      ["Τι κάνεις;", "Charon"],
      ["— Καλά.", "Kore"],
      ["— Λένε έτσι.", "Puck"],
    ]);
    expect(sentences.map((sentence) => sentence.file)).toEqual([1, 2, 3, 4, 5, 6].map((n) => `readings/r-t/${n}.mp3`));
  });

  it("рассказ от первого лица звучит голосом героя, и его реплики — тоже", () => {
    const sentences = voicing("Είμαι η Άννα.\n— Γεια, Άννα!\n— Γεια σου!", ["Νίκος", "Άννα"], "Άννα");
    expect(sentences.map((sentence) => sentence.voice)).toEqual(["Kore", "Charon", "Kore"]);
  });

  it("без speakers строки диалога читает рассказчик", () => {
    expect(voicing("— Γεια!\n— Γεια!").map((sentence) => sentence.voice)).toEqual(["Puck", "Puck"]);
  });

  it("отказ: имён меньше строк диалога, нет голоса, один голос у разных говорящих", () => {
    expect(() => voicing("— Γεια!\n— Γεια!", ["Νίκος"])).toThrow(/строк диалога 2, а имён в speakers 1/);
    expect(() => voicing("— Γεια!", ["Κώστας"])).toThrow(/«Κώστας» нет голоса/);
    expect(() => voicing("Α.", undefined, "Κώστας")).toThrow(/рассказчика «Κώστας» нет голоса/);
    expect(() => voicing("— Γεια!\n— Γεια!", ["Μαρία", "Ελένη"])).toThrow(/один голос Leda/);
    const noReader = { ...map, reader: undefined };
    expect(() => readingVoicing("r-t", "Α.", undefined, undefined, noReader, "r")).toThrow(/нужен голос чтеца/);
  });
});

describe("план озвучки текстов", () => {
  const card = (text: string, extra: Partial<ReadingSource> = {}): CourseCard<ReadingSource> => ({
    title: "Τ",
    after: "m01-1",
    text,
    provenance: {},
    file: "greek-a2/r-t.yaml",
    course: "greek-a2",
    ...extra,
  });
  const done = (text: string, voice: string) => ({ voice, hash: lineHash(text, voice, "el-GR") });

  it("озвучивает новое и изменённое, удаляет лишнее, готовое не трогает", () => {
    const readings = new Map([["r-t", card("Καλημέρα. Τι κάνεις;\n— Καλά.", { speakers: ["Νίκος"] })]]);
    const manifest: VoiceManifest = {
      "readings/r-t/1.mp3": done("Καλημέρα.", "Puck"),
      "readings/r-t/2.mp3": done("Τι κάνεις;", "Kore"),
      "readings/r-t/4.mp3": done("Αντίο.", "Puck"),
      "readings/r-old/1.mp3": done("Γεια.", "Puck"),
      "m01-1/l1-1.mp3": done("Γεια.", "Kore"),
    };
    const existing = ["readings/r-t/1.mp3", "readings/r-t/2.mp3", "readings/r-t/4.mp3", "readings/r-gone/1.mp3"];
    const plan = planReadingVoices(readings, () => map, manifest, existing);
    expect(plan.sentences).toHaveLength(3);
    expect(plan.pending.map((sentence) => [sentence.label, sentence.voice])).toEqual([
      ["r-t#2", "Puck"],
      ["r-t#3", "Charon"],
    ]);
    expect(plan.stale).toEqual(["readings/r-gone/1.mp3", "readings/r-old/1.mp3", "readings/r-t/4.mp3"]);
  });

  it("запись без файла озвучивается заново, текст без карты голосов пропускается", () => {
    const readings = new Map([["r-t", card("Καλημέρα.")]]);
    const manifest = { "readings/r-t/1.mp3": done("Καλημέρα.", "Puck") };
    expect(planReadingVoices(readings, () => map, manifest, []).pending).toHaveLength(1);
    expect(planReadingVoices(readings, () => undefined, {}, [])).toEqual({ sentences: [], pending: [], stale: [] });
  });
});
