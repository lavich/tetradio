import { useEffect, useLayoutEffect, useRef, useState } from "react";

const ROW = 48;
/**
 * Сворачивание сделанного на телефоне: если шапка, список и лист вместе не помещаются в окно, список
 * уходит в строку «Сделано N — показать». Решение принимается на задание: внутри одного задания список
 * только сворачивается (выросло раскрытие), иначе он прыгал бы туда-обратно при каждом ответе.
 * Высоту скрытого списка берём из последнего замера, а для новых строк — по две клетки на строку.
 */
export function useFold(
  scroller: React.RefObject<HTMLElement | null>,
  sheet: React.RefObject<HTMLElement | null>,
  rows: number,
  task: string,
  wide: boolean,
) {
  const [fold, setFold] = useState(false);
  const [opened, setOpened] = useState(false);
  const measured = useRef({ rows: 0, height: 0 });
  // `undefined` — сворачивать нечего: строка «Сделано N» появляется только там, где список правда мешает листу.
  const folded = wide || !fold ? undefined : !opened;
  const tooTall = () => {
    const main = scroller.current,
      card = sheet.current;
    if (!main || !card || !rows) return false;
    const list = main.querySelector<HTMLElement>("[data-done-list]");
    if (list) measured.current = { rows, height: list.offsetHeight };
    const known = measured.current;
    const listHeight = list ? list.offsetHeight : Math.max(rows * ROW, known.height + (rows - known.rows) * ROW);
    const head = main.querySelector<HTMLElement>("header")?.offsetHeight ?? 0;
    const cloud = main.querySelector<HTMLElement>("[data-cloud]")?.offsetHeight ?? 0;
    const style = getComputedStyle(main);
    const chrome = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + 48;
    return head + listHeight + card.offsetHeight + cloud + chrome > main.clientHeight;
  };
  useLayoutEffect(() => {
    if (!wide) setFold(tooTall());
  }, [task, wide]);
  useEffect(() => {
    const main = scroller.current,
      card = sheet.current;
    if (!main || !card || wide) return;
    const observer = new ResizeObserver(() => {
      if (tooTall()) setFold(true);
    });
    observer.observe(main);
    observer.observe(card);
    return () => observer.disconnect();
  }, [task, wide, rows]);
  return { folded, setOpened };
}
