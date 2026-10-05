import { coverColor } from "../shared/notebook";
import type { LandingData, SampleTask } from "./sample";

const SHELF_SIZE = 24;

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const icon = (paths: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const SEND = icon(
  '<path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/>',
);
const CHEVRON_LEFT = icon('<path d="m15 18-6-6 6-6"/>');
const CHEVRON_RIGHT = icon('<path d="m9 18 6-6-6-6"/>');

export const splitPrompt = (prompt: string) => {
  const at = prompt.search(/[[(]/);
  return at < 0 ? { greek: prompt, gloss: "" } : { greek: prompt.slice(0, at).trim(), gloss: prompt.slice(at).trim() };
};

const modulesLabel = (count: number) => {
  const tens = count % 100,
    ones = count % 10;
  return `${count} ${ones === 1 && tens !== 11 ? "модуля" : "модулей"}`;
};

const longDate = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${iso}T12:00:00Z`),
  );

const botLink = (bot: string | null, label: string, start = false) =>
  bot
    ? `<a class="lp-cta" href="https://t.me/${bot}${start ? "?startapp" : ""}">${SEND}${label}</a>`
    : '<p class="lp-note">Найдите бота курса в Telegram и откройте приложение из него.</p>';

function shelf(data: LandingData) {
  const slots = data.modules.length ? data.modules : Array.from({ length: SHELF_SIZE }, () => null);
  const books = slots
    .map((module, index) => {
      const number = module?.number ?? index + 1;
      const label = module
        ? `<span class="lp-bookLabel"><span lang="el">${escape(module.title)}</span><small>${escape(module.subtitle)}</small></span>`
        : "";
      return `<li class="lp-book${index === 0 ? " lp-out" : ""}" style="background:${coverColor(number)}"><b>${String(number).padStart(2, "0")}</b>${label}</li>`;
    })
    .join("");
  return `<div class="lp-shelfWrap">
<ol class="lp-shelf" aria-label="Модули курса" tabindex="0">${books}</ol>
<button type="button" class="lp-shelfArrow lp-prev" aria-label="Предыдущие модули" disabled>${CHEVRON_LEFT}</button>
<button type="button" class="lp-shelfArrow lp-next" aria-label="Следующие модули">${CHEVRON_RIGHT}</button>
</div>`;
}

function task({ block, item }: SampleTask, index: number, total: number) {
  const { greek, gloss } = splitPrompt(item.prompt);
  const answer =
    block.format === "choice"
      ? `<div class="lp-options" role="group" aria-label="Варианты ответа">${(item.options ?? [])
          .map(
            (option) =>
              `<button type="button" class="lp-option" data-option="${escape(option)}" aria-pressed="false">${escape(option)}</button>`,
          )
          .join("")}</div>`
      : `<input class="lp-answer" lang="el" placeholder="ответ по-гречески" aria-label="Ваш ответ" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
<p class="lp-hint">Ответ без тоноса засчитается как «почти».</p>`;
  const check =
    block.format === "text" ? '<button type="submit" class="lp-go" data-check disabled>Проверить</button>' : "";
  return `<form class="lp-sheet" data-task="${index}"${index ? " hidden" : ""}>
<p class="lp-instruction">${escape(block.instruction)}</p>
<p class="lp-prompt"><span lang="el">${escape(greek)}</span><small>${escape(gloss.replace(/^\(|\)$/g, ""))}</small></p>
${answer}
<p class="lp-verdict" hidden></p>
<div class="lp-cloud"><span class="lp-count">${index + 1} из ${total}<small>урок 1.1 · модуль 01</small></span>${check}<button type="submit" class="lp-go" data-next hidden>${index + 1 === total ? "К итогу" : "Далее ›"}</button></div>
</form>`;
}

function lesson(tasks: SampleTask[], bot: string | null) {
  if (!tasks.length) return '<p class="lp-print">Пробный урок не загрузился. Весь курс доступен в Telegram.</p>';
  const rows = tasks
    .map(
      ({ item }, index) =>
        `<li class="lp-row lp-empty" data-row="${index}"><span class="lp-n">${index + 1}</span><span><b lang="el">${escape(splitPrompt(item.prompt).greek)}</b><span data-given></span></span><span data-mark></span></li>`,
    )
    .join("");
  return `<div class="lp-lessonGrid" data-lesson>
<section class="lp-sheetCol" aria-live="polite">
${tasks.map((item, index) => task(item, index, tasks.length)).join("\n")}
<div class="lp-sheet" data-summary hidden>
<h3 class="lp-summaryTitle" data-score></h3>
<p class="lp-print">Здесь были четыре задания из урока 1.1. В боте урок открывается полностью: правила чтения, ударение, глагол <span lang="el">είμαι</span> и остальные упражнения. За ним идут уроки 1.2 и 1.3 и контрольная модуля.</p>
<div class="lp-summaryActions">${botLink(bot, "Продолжить урок в Telegram", true)}<button type="button" class="lp-quiet" data-restart>Пройти ещё раз</button></div>
</div>
</section>
<section class="lp-doneCol">
<div class="lp-doneHead"><h3>Задания урока</h3><span class="lp-label">сделано <span data-done>0</span> из ${tasks.length}</span></div>
<ol class="lp-rows">${rows}</ol>
</section>
</div>`;
}

/** Задания пробного урока для скрипта страницы: только то, что нужно проверке ответа. */
export const lessonData = (tasks: SampleTask[]) =>
  tasks.map(({ block, item }) => ({
    format: block.format,
    answer: item.answer,
    explanation: item.explanation ?? null,
  }));

export function renderLanding(data: LandingData, bot: string | null) {
  const first = data.modules[0];
  const exam = data.exam;
  const examLine = exam
    ? `${escape(exam.title)} — <b>${longDate(exam.date)}</b>${exam.localConfirmed ? "" : '<span class="lp-caveat">дата для Кипра не подтверждена</span>'}`
    : "&nbsp;";
  return `<div class="lp-page" data-testid="open-in-telegram">
<div class="lp-wrap">
<header class="lp-top">
<div>
<h1 class="lp-title">Греческий <em>с нуля</em> до экзамена A2</h1>
<p class="lp-lede">Курс из ${modulesLabel(data.modules.length || SHELF_SIZE)} для подготовки к экзамену <span lang="el">ΚΕΓ</span>. В каждом есть объяснение грамматики, тексты, диалоги с аудио, задания на письмо и речь. Ответы проверяются сразу, к ошибкам есть пояснения.</p>
</div>
<div class="lp-side">
${botLink(bot, "Открыть в Telegram")}
<p class="lp-meta">Регистрация не нужна: курс открывается в Telegram, прогресс сохраняется в вашем аккаунте и доступен на телефоне и компьютере.</p>
</div>
</header>
${shelf(data)}
<p class="lp-exam">${examLine}</p>
<section class="lp-open" aria-labelledby="sample-title">
<div class="lp-lid" style="background:${coverColor(1)}">
<span class="lp-num">01</span>
<div><h2 id="sample-title" lang="el">${escape(first?.title ?? "Γνωριμία")}</h2><p>Попробуйте урок 1.1 на этой странице</p></div>
${first?.goal ? `<p class="lp-goal">Цель модуля: ${escape(first.goal)}.</p>` : ""}
</div>
<div class="lp-pg notebook">${lesson(data.tasks, bot)}</div>
</section>
<section class="lp-facts">
<div><h3>Уроки по порядку</h3><p>Каждый урок идёт от объяснения к практике и проверке. Слова и фразы из пройденных уроков повторяются на карточках.</p></div>
<div><h3>Четыре навыка</h3><p>Чтение, аудирование, письмо и речь оцениваются по отдельности, поэтому видно, какой навык отстаёт.</p></div>
<div><h3>План к экзамену</h3><p>Курс рассчитан на 2–3 занятия по часу в неделю и 10–15 минут повторения в день. Отставание от календаря курса показано на экране прогресса.</p></div>
</section>
<footer class="lp-close"><h2>Начните с тетради 01</h2>${botLink(bot, "Открыть в Telegram", true)}</footer>
</div>
</div>
<script type="application/json" id="lp-data">${JSON.stringify(lessonData(data.tasks)).replace(/</g, "\\u003c")}</script>`;
}
