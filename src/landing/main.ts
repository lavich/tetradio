import "@fontsource-variable/literata/wght.css";
import "@fontsource-variable/literata/wght-italic.css";
import "@fontsource-variable/manrope";
import "../styles.css";
import "./landing.css";
import type { ExerciseBlock, ExerciseItem } from "../content/course";
import { checkItem, type ItemResult } from "../domain/course";
import { dropServiceWorker } from "../platform/service-worker";

if ("serviceWorker" in navigator)
  void dropServiceWorker({
    scope: new URL(import.meta.env.BASE_URL, location.origin).href,
    container: navigator.serviceWorker,
    caches: typeof caches === "undefined" ? undefined : caches,
    session: sessionStorage,
    reload: () => location.reload(),
  }).catch((error) => console.warn("Service worker не снят", error));

const SVG = "http://www.w3.org/2000/svg";
function tick(almost: boolean) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 34 30");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", almost ? "почти" : "верно");
  svg.setAttribute("class", almost ? "lp-tick lp-almost" : "lp-tick");
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", "M3 16c3 1 6 5 8 9 4-9 10-16 20-22");
  for (const [name, value] of Object.entries({
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2.6",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  }))
    path.setAttribute(name, value);
  svg.append(path);
  return svg;
}
const node = (tag: string, className: string | null, ...children: (string | Node)[]) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.append(...children);
  return element;
};
const greek = (text: string) => {
  const span = node("span", null, text);
  span.lang = "el";
  return span;
};
const clause = (text: string) => text.charAt(0).toLocaleLowerCase("ru") + text.slice(1);

function setupShelf() {
  const track = document.querySelector<HTMLElement>(".lp-shelf");
  const prev = document.querySelector<HTMLButtonElement>(".lp-prev");
  const next = document.querySelector<HTMLButtonElement>(".lp-next");
  if (!track || !prev || !next) return;
  const measure = () => {
    prev.disabled = track.scrollLeft <= 4;
    next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
  };
  const page = (direction: 1 | -1) => track.scrollBy({ left: direction * track.clientWidth * 0.8, behavior: "smooth" });
  track.addEventListener("scroll", measure, { passive: true });
  addEventListener("resize", measure);
  prev.addEventListener("click", () => page(-1));
  next.addEventListener("click", () => page(1));
  measure();
}

interface TaskData {
  format: ExerciseBlock["format"];
  answer: string[];
  explanation: string | null;
}
interface Answer {
  given: string;
  result: ItemResult;
}

function setupLesson() {
  const root = document.querySelector<HTMLElement>("[data-lesson]");
  const raw = document.getElementById("lp-data")?.textContent;
  if (!root || !raw) return;
  const tasks = JSON.parse(raw) as TaskData[];
  const pristine = root.innerHTML;
  let current = 0;
  let answers: Answer[] = [];

  const form = (index: number) => root.querySelector<HTMLFormElement>(`[data-task="${index}"]`);

  function verdict(data: TaskData, { status, expected }: ItemResult) {
    const why = data.explanation ? ` — ${clause(data.explanation)}` : "";
    if (status === "correct") return node("p", "lp-okLine", `верно${why}`);
    if (status === "almost") return node("p", "lp-almostLine", "почти: ", greek(expected), why || " — проверьте тонос");
    return node("p", "lp-penLine", "правильно: ", greek(expected), why);
  }

  function markRow(index: number, { given, result }: Answer) {
    const row = root!.querySelector<HTMLElement>(`[data-row="${index}"]`)!;
    row.classList.remove("lp-empty");
    const slot = row.querySelector("[data-given]")!;
    const mark = row.querySelector("[data-mark]")!;
    if (result.status === "correct") slot.replaceChildren(" — ", node("i", "lp-ink", given));
    else {
      const almost = result.status === "almost";
      slot.replaceChildren(
        " — ",
        node("s", almost ? "lp-almostStrike" : "lp-penStrike", given),
        node("ins", almost ? "lp-almostIns" : "lp-penIns", result.expected),
      );
    }
    mark.replaceChildren(
      result.status === "wrong" ? node("span", "sr-only", "ошибка") : tick(result.status === "almost"),
    );
    root!.querySelector("[data-done]")!.textContent = String(answers.length);
  }

  function check(given: string) {
    const data = tasks[current];
    const sheet = form(current);
    if (!data || !sheet || answers[current] || !given.trim()) return;
    const result = checkItem({ format: data.format } as ExerciseBlock, { answer: data.answer } as ExerciseItem, given);
    const answer = { given: given.trim(), result };
    answers = [...answers, answer];
    for (const option of sheet.querySelectorAll<HTMLButtonElement>("[data-option]")) {
      const value = option.dataset.option!;
      option.disabled = true;
      option.setAttribute("aria-pressed", String(value === answer.given));
      if (value === result.expected) {
        option.classList.add("lp-right");
        option.append(tick(false));
      } else if (value === answer.given) option.classList.add("lp-wrong");
    }
    const input = sheet.querySelector<HTMLInputElement>(".lp-answer");
    if (input) input.readOnly = true;
    sheet.querySelector(".lp-hint")?.remove();
    const slot = sheet.querySelector<HTMLElement>(".lp-verdict")!;
    slot.replaceWith(verdict(data, result));
    sheet.querySelector<HTMLElement>("[data-check]")?.remove();
    const next = sheet.querySelector<HTMLButtonElement>("[data-next]")!;
    next.hidden = false;
    next.focus({ preventScroll: true });
    markRow(current, answer);
  }

  function advance() {
    form(current)!.hidden = true;
    current += 1;
    const sheet = form(current);
    if (sheet) {
      sheet.hidden = false;
      sheet.querySelector<HTMLInputElement>(".lp-answer")?.focus({ preventScroll: true });
      return;
    }
    const correct = answers.filter((answer) => answer.result.status === "correct").length;
    const almost = answers.filter((answer) => answer.result.status === "almost").length;
    root!.querySelector("[data-score]")!.textContent =
      `${correct} из ${tasks.length} верно${almost ? `, ${almost} почти` : ""}`;
    root!.querySelector<HTMLElement>("[data-summary]")!.hidden = false;
  }

  root.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const option = target.closest<HTMLButtonElement>("[data-option]");
    if (option) check(option.dataset.option!);
    if (target.closest("[data-restart]")) {
      root.innerHTML = pristine;
      current = 0;
      answers = [];
    }
  });
  root.addEventListener("input", (event) => {
    const input = event.target as HTMLInputElement;
    const button = input.closest("form")?.querySelector<HTMLButtonElement>("[data-check]");
    if (button) button.disabled = !input.value.trim();
  });
  root.addEventListener("submit", (event) => {
    event.preventDefault();
    if (answers[current]) advance();
    else check(form(current)?.querySelector<HTMLInputElement>(".lp-answer")?.value ?? "");
  });
}

setupShelf();
setupLesson();
