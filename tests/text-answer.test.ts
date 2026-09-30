import { describe, expect, it } from "vitest";
import { checkTextAnswer } from "../src/domain/text-answer";

/** Проверка письменного ответа фразы отдельна от словарной: без послаблений артиклю, без угадывания формы. */
describe("проверка письменного ответа фразы", () => {
  it("точное совпадение после нормализации Unicode, регистра, пробелов и конечной сигмы — правильно", () => {
    expect(checkTextAnswer("γράφω", ["γράφω"]).status).toBe("correct");
    expect(checkTextAnswer("  ΓΡΆΦΩ ", ["γράφω"]).status).toBe("correct");
    expect(checkTextAnswer("γράφω".normalize("NFD"), ["γράφω"]).status).toBe("correct");
    expect(checkTextAnswer("ο  φίλος   μου", ["ο φίλος μου"]).status).toBe("correct");
    expect(checkTextAnswer("φίλοσ", ["φίλος"]).status).toBe("correct");
    expect(checkTextAnswer("Γράφω ένα γράμμα.", ["Γράφω ένα γράμμα."]).status).toBe("correct");
  });
  it("расхождение только в ударении — почти", () => {
    const result = checkTextAnswer("γραφω", ["γράφω"]);
    expect(result.status).toBe("almost");
    expect(result.expected).toBe("γράφω");
    expect(checkTextAnswer("ΓΡΑΦΩ", ["γράφω"]).status).toBe("almost");
  });
  it("точный второй вариант засчитывается до проверки ударения первого", () => {
    const result = checkTextAnswer("γραφω", ["γράφω", "γραφω"]);
    expect(result.status).toBe("correct");
    expect(result.expected).toBe("γραφω");
  });
  it("при почти-совпадении подставляется первый вариант, совпавший без ударения", () => {
    expect(checkTextAnswer("γραφεις", ["γράφω", "γράφεις"]).expected).toBe("γράφεις");
  });
  it("диерезис остаётся значимым", () => {
    expect(checkTextAnswer("προι", ["προϊόν"]).status).toBe("wrong");
    expect(checkTextAnswer("προιον", ["προϊόν"]).status).toBe("wrong");
    expect(checkTextAnswer("προϊον", ["προϊόν"]).status).toBe("almost");
    expect(checkTextAnswer("μαϊμού", ["μαϊμού"]).status).toBe("correct");
  });
  it("артикль, отрицание, предлог и форма не прощаются", () => {
    expect(checkTextAnswer("το", ["τον"]).status).toBe("wrong");
    expect(checkTextAnswer("σπίτι", ["το σπίτι"]).status).toBe("wrong");
    expect(checkTextAnswer("το σπίτι", ["σπίτι"]).status).toBe("wrong");
    expect(checkTextAnswer("θέλω", ["δεν θέλω"]).status).toBe("wrong");
    expect(checkTextAnswer("στο σπίτι", ["σπίτι"]).status).toBe("wrong");
    expect(checkTextAnswer("γράφεις", ["γράφω"]).status).toBe("wrong");
  });
  it("пунктуация не удаляется автоматически", () => {
    expect(checkTextAnswer("γράφω.", ["γράφω"]).status).toBe("wrong");
    expect(checkTextAnswer("Γράφω ένα γράμμα", ["Γράφω ένα γράμμα."]).status).toBe("wrong");
  });
  it("пустой ввод и пустой список ответов — неверно без исключений", () => {
    expect(checkTextAnswer("", ["γράφω"]).status).toBe("wrong");
    expect(checkTextAnswer("   ", ["γράφω"]).status).toBe("wrong");
    expect(checkTextAnswer("γράφω", []).status).toBe("wrong");
  });
  it("при неверном ответе показывается канонический (первый) вариант", () => {
    expect(checkTextAnswer("κάτι", ["γράφω", "γράφεις"]).expected).toBe("γράφω");
  });
});
