import type { MaskSymbol, WritingMask } from "../../../domain/syllables";
import { cx } from "../../../shared/cx";
import { withCount } from "../../../shared/format";
import s from "./spelling.module.css";

/**
 * Подсказка длины ответа внутри поля ввода: ячейка на каждую букву, первая буква каждого слова открыта, знаки
 * показаны как есть, пробел разбивает маску на группы по словам. Набранное занимает ячейки, и маска остаётся
 * на экране до самого ответа: она и есть строка ввода, а собственный текст поля скрыт.
 *
 * Слова набора ложатся в группы по порядку: пробел переводит набор к следующему слову, а буквы сверх длины
 * слова показываются тут же, за его ячейками. Раскладывать набранное подряд, пропуская пробелы, нельзя: тогда
 * «ηγάτα» выглядело бы как «η γάτα», хотя пробела в ответе нет и проверка засчитает пропуск. Маска показывает
 * ровно то, что лежит в поле.
 *
 * Каретка стоит сразу за последней введённой буквой, а в пустом слове — перед его первой ячейкой. Своей
 * площадки у места пробела нет: подчёркивание там читалось бы ещё одной буквой. Сам пробел не подставляется:
 * ответ без артикля — разрешённый ответ со своим исходом «Почти», и подстановка превратила бы его в ошибку.
 *
 * Поле при этом ничего не ограничивает: ответить короче, длиннее и без артикля по-прежнему можно.
 * Диктору маска отдаётся числом слов и букв и открытыми буквами: разрывов между группами он не видит.
 */
export function AnswerMask({ mask, value }: { mask: WritingMask | null; value: string }) {
  if (!mask?.letters) return null;
  const { groups, letters } = mask;
  const typed = value.split(/\s/);
  const caret = { word: typed.length - 1, at: (typed.at(-1) ?? "").length };
  const leads = groups
    .flat()
    .filter((symbol) => symbol.kind === "lead")
    .map((symbol) => symbol.char);
  const count = withCount(letters, ["буквы", "букв", "букв"]);
  const words = groups.length > 1 ? `${withCount(groups.length, ["слова", "слов", "слов"])}, ` : "";
  const first = leads.length > 1 ? `, первые буквы ${leads.join(", ")}` : leads.length ? `, первая ${leads[0]}` : "";
  /** Каретка держится за последнюю введённую букву; в пустом слове ей не за что держаться — встаёт перед первой ячейкой. */
  const side = (index: number, offset: number) =>
    index !== caret.word
      ? undefined
      : caret.at === 0 && offset === 0
        ? "before"
        : offset === caret.at - 1
          ? "after"
          : undefined;
  const mark = (where: "before" | "after" | undefined) => ({
    className: cx(where === "before" && s.maskCaretBefore, where === "after" && s.maskCaretAfter),
    "data-testid": where ? "mask-caret" : undefined,
    "data-caret": where,
  });
  /** Слово набора в ячейках своей группы: что не поместилось — следом за ними. */
  const word = (group: MaskSymbol[], text: string, index: number) => {
    const cells = group.map((symbol, offset) => ({ symbol, char: text[offset], offset }));
    const over = Array.from(text.slice(group.length), (char, offset) => ({
      symbol: null,
      char,
      offset: group.length + offset,
    }));
    return [...cells, ...over].map(({ symbol, char, offset }) => {
      const { className, ...rest } = mark(side(index, offset));
      return symbol?.kind === "mark" ? (
        <span key={offset} className={cx(char && s.maskTyped, className)} {...rest}>
          {char ?? symbol.char}
        </span>
      ) : (
        <b
          key={offset}
          {...rest}
          className={cx(s.maskLetter, char && s.maskTyped, !char && symbol?.kind === "lead" && s.maskLead, className)}
        >
          {char ?? (symbol?.kind === "lead" ? symbol.char : undefined)}
        </b>
      );
    });
  };
  return (
    <>
      <div className={s.mask} data-testid="answer-mask" aria-hidden>
        {[...groups, ...typed.slice(groups.length).map(() => [] as MaskSymbol[])].map((group, index) => (
          <span key={index} className={s.maskWord} data-testid="mask-word">
            {word(group, typed[index] ?? "", index)}
          </span>
        ))}
      </div>
      <span className="sr-only">
        Ответ из {words}
        {count}
        {first}
      </span>
    </>
  );
}
