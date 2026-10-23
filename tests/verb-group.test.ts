import { describe, expect, it } from "vitest";
import { realContent } from "./helpers/real-content";

const content = realContent();
const greek = content.packages.filter((pack) => pack.courseId === "greek-a2");
const words = new Map(greek.flatMap((pack) => pack.words).map((word) => [word.id, word]));
const verbs = [...words.values()].filter((word) => word.paradigm);
const byGreek = (text: string) => [...words.values()].find((word) => word.greek === text)!;

const IRREGULAR = [
  "βλέπω",
  "βρίσκω",
  "βγαίνω",
  "πηγαίνω",
  "πίνω",
  "καταπίνω",
  "παίρνω",
  "λέω",
  "τρώω",
  "κάνω",
  "δίνω",
  "φέρνω",
  "φεύγω",
  "αποφεύγω",
  "μαθαίνω",
  "καταλαβαίνω",
  "ανεβαίνω",
  "κατεβαίνω",
  "βγάζω",
  "αναβάλλω",
  "επαναλαμβάνω",
  "παραλαμβάνω",
  "προσλαμβάνω",
  "μένω",
  "στέλνω",
  "παραγγέλνω",
  "πλένω",
  "παχαίνω",
  "έχω",
  "θέλω",
  "ξέρω",
  "έρχομαι",
  "γίνομαι",
  "βρίσκομαι",
  "πλένομαι",
  "είμαι",
];

describe("группа глагола в настоящем курсе", () => {
  it("у каждого глагола с таблицей есть группа, распределение как в отчёте сборки", () => {
    expect(verbs).toHaveLength(166);
    expect(verbs.filter((word) => !word.group).map((word) => word.greek)).toEqual([]);
    const count = (group: string) => verbs.filter((word) => word.group === group).length;
    expect(["A", "B1", "B2", "mid", "other"].map(count)).toEqual([101, 24, 14, 26, 1]);
  });

  it("группа следует таблице, а не написанию заглавной", () => {
    expect(["προτιμώ", "συναντώ"].map((text) => byGreek(text).group)).toEqual(["B1", "B1"]);
    expect(byGreek("ζω").group).toBe("B2");
    expect(["αρέσω", "υπάρχω", "κοστίζω", "ταιριάζω"].map((text) => byGreek(text).group)).toEqual(["A", "A", "A", "A"]);
  });

  it("неправильное прошедшее ровно у 36 глаголов списка", () => {
    const marked = verbs.filter((word) => word.irregular).map((word) => word.greek);
    expect(marked.sort()).toEqual([...IRREGULAR].sort());
    for (const text of ["ακούω", "ζω", "μπορώ", "περνάω", "χάνω", "αφήνω", "κλείνω", "αρρωσταίνω", "προτείνω"])
      expect(byGreek(text).irregular, text).toBeUndefined();
    for (const text of ["σερβίρω", "χάνομαι"]) expect(byGreek(text).irregular, text).toBeUndefined();
  });

  it("у безличных глаголов и в английских курсах полей нет", () => {
    for (const text of ["βρέχει", "πρέπει", "φυσάει", "χιονίζει"]) {
      expect(byGreek(text).group, text).toBeUndefined();
      expect(byGreek(text).irregular, text).toBeUndefined();
    }
    const english = content.packages.filter((pack) => pack.language === "en");
    expect(english.length).toBeGreaterThan(0);
    for (const pack of english) {
      for (const word of pack.words) expect(word.group ?? word.irregular, word.greek).toBeUndefined();
      for (const card of pack.marks?.cards ?? []) expect(card.group ?? card.irregular, card.greek).toBeUndefined();
    }
  });

  it("карточки подсказки уроков и текстов для чтения несут группу и признак своего слова", () => {
    const lessonCards = greek.flatMap((pack) => pack.marks?.cards ?? []);
    const readingCards = greek.flatMap((pack) =>
      (pack.readings ?? []).flatMap((reading) => reading.marks?.cards ?? []),
    );
    for (const card of [...lessonCards, ...readingCards].filter((entry) => entry.ref.startsWith("w:"))) {
      const word = words.get(card.ref.slice(2))!;
      expect([card.group, card.irregular], card.greek).toEqual([word.group, word.irregular]);
    }
    expect(readingCards.some((card) => card.group)).toBe(true);
    expect(lessonCards.some((card) => card.irregular)).toBe(true);
  });
});
