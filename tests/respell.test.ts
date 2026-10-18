import { describe, expect, it } from "vitest";
import { buildCourses } from "../content/build/courses";
import { LANGUAGE } from "../content/build/common";
import { planAnswerVoices } from "../content/build/answers";
import { planReadingVoices } from "../content/build/readings";
import { readSources } from "../content/build/sources";
import { lineHash, parseVoices, spokenText, synthText } from "../content/build/voices";
import { profileOf } from "../src/domain/language";

const respell = new Map([["καλώς", "ΚΑΛΏΣ"]]);
const EMPTY = { language: "el-GR", respell: new Map<string, string>() };
const body =
  "source: TTS {voice}\nlanguage: el-GR\nprefix: el-GR-Chirp3-HD-\npools: { female: [Kore], male: [Puck] }\n";

describe("написание для облачного синтеза", () => {
  it("заменяет целое слово без учёта регистра, соседние слова и «;» как раньше", () => {
    expect(synthText("Καλημέρα σας και καλώς ήρθατε; Καλώς!", "el-GR", respell)).toBe(
      "Καλημέρα σας και ΚΑΛΏΣ ήρθατε? ΚΑΛΏΣ!",
    );
    expect(synthText("δάσκαλός καλός Καλά", "el-GR", respell)).toBe("δάσκαλός καλός Καλά");
  });
  it("работает за один проход и идемпотентна", () => {
    expect(synthText("ΚΑΛΏΣ", "el-GR", respell)).toBe("ΚΑΛΏΣ");
    expect(
      synthText(
        "α β",
        "el-GR",
        new Map([
          ["α", "β"],
          ["β", "γ"],
        ]),
      ),
    ).toBe("β γ");
  });
  it("синтез устройства и хэш записи без слова не меняются", () => {
    expect(spokenText("Καλώς ήρθατε!", "el-GR")).toBe("Καλώς ήρθατε!");
    const voices = { language: "el-GR", respell };
    expect(lineHash("Γεια σου!", "Kore", voices)).toBe(lineHash("Γεια σου!", "Kore", EMPTY));
    expect(lineHash("Καλώς ήρθες!", "Kore", voices)).not.toBe(lineHash("Καλώς ήρθες!", "Kore", EMPTY));
  });
  it("карта голосов: respell нормализуется NFC, неверная форма отклоняется", () => {
    const map = parseVoices(`${body}respell: { Καλώς: "ΚΑΛΏΣ" }\ncharacters: {}\n`, "voices/el.yaml");
    expect([...map.respell]).toEqual([["καλώς", "ΚΑΛΏΣ"]]);
    expect(() => parseVoices(`${body}respell: [Καλώς]\ncharacters: {}\n`, "voices/el.yaml")).toThrow(/respell/);
    expect(() => parseVoices(`${body}respell: { "Καλώς ήρθες": ΧΧΧ }\ncharacters: {}\n`, "voices/el.yaml")).toThrow(
      /respell/,
    );
    expect(() => parseVoices(`${body}respell: { Καλώς: Χ, καλώς: Ψ }\ncharacters: {}\n`, "voices/el.yaml")).toThrow(
      /дважды/,
    );
    expect(() => parseVoices(`${body}respell: { Καλώς: "" }\ncharacters: {}\n`, "voices/el.yaml")).toThrow(/respell/);
  });

  it("курс: «Καλώς» уходит в синтез ровно в 14 озвучиваемых записях, остальные не затронуты", () => {
    const sources = readSources("content");
    const { languages, courseLanguages } = buildCourses(sources);
    const voices = sources.voices.get("el")!;
    const texts: string[] = [];
    for (const src of sources.lessons.values())
      for (const block of Array.isArray(src.blocks) ? src.blocks : []) {
        const { type, transcript } = (block ?? {}) as { type?: string; transcript?: { text?: unknown }[] };
        if (type === "listening" && Array.isArray(transcript))
          for (const line of transcript) if (typeof line?.text === "string") texts.push(line.text);
      }
    for (const src of sources.words.values()) if (courseLanguages.get(src.course) === "el") texts.push(src.greek);
    for (const src of sources.phrases.values()) if (courseLanguages.get(src.course) === "el") texts.push(src.text);
    const readings = planReadingVoices(
      sources.readings,
      (src) => sources.voices.get(courseLanguages.get(src.course) ?? LANGUAGE),
      {},
      [],
    );
    texts.push(...readings.sentences.map((sentence) => sentence.text));
    texts.push(
      ...planAnswerVoices(
        [...sources.lessons].map(([id, src]) => [id, src.blocks]),
        (lessonId) => ({ voices: voices, profile: profileOf(languages.get(lessonId) ?? LANGUAGE) }),
        {},
        [],
      ).answers.map((answer) => answer.text),
    );
    const changed = texts.filter((text) => lineHash(text, "Kore", voices) !== lineHash(text, "Kore", EMPTY));
    const word = /(?<!\p{L})καλώς(?!\p{L})/iu;
    expect(changed.filter((text) => !word.test(text.normalize("NFC")))).toEqual([]);
    expect(texts.filter((text) => word.test(text.normalize("NFC")) && !changed.includes(text))).toEqual([]);
    expect(changed.length).toBeGreaterThanOrEqual(14);
  });
});
