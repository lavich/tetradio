import { useEffect, useRef, useState, type FormEvent } from "react";
import { ChevronLeft, ChevronRight, Send } from "lucide-react";
import type { CatalogModule } from "../../content/course";
import { fetcher } from "../../content/fetcher";
import { checkItem, type ItemResult } from "../../domain/course";
import { coverColor } from "../../shared/notebook";
import { Tick } from "../../shared/Tick";
import { loadLanding, type LandingContent, type SampleTask } from "./sample";
import css from "./landing.module.css";

const SHELF_SIZE = 24;

function BotLink({ bot, start, children }: { bot: string | null; start?: boolean; children: string }) {
  if (!bot) return <p className={css.note}>Найдите бота курса в Telegram и откройте приложение из него.</p>;
  return (
    <a className={css.cta} href={`https://t.me/${bot}${start ? "?startapp" : ""}`}>
      <Send aria-hidden="true" />
      {children}
    </a>
  );
}

function Shelf({ modules }: { modules: CatalogModule[] }) {
  const slots = modules.length ? modules : Array.from({ length: SHELF_SIZE }, () => null);
  const track = useRef<HTMLOListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  const measure = () => {
    const el = track.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  };
  useEffect(measure, [slots.length]);
  const page = (direction: 1 | -1) => {
    const el = track.current;
    if (el) el.scrollBy({ left: direction * el.clientWidth * 0.8, behavior: "smooth" });
  };
  return (
    <div className={css.shelfWrap}>
      <ol ref={track} className={css.shelf} aria-label="Модули курса" tabIndex={0} onScroll={measure}>
        {slots.map((module, index) => (
          <li
            key={module?.id ?? index}
            className={index === 0 ? `${css.book} ${css.out}` : css.book}
            style={{ background: coverColor(module?.number ?? index + 1) }}
          >
            <b>{String(module?.number ?? index + 1).padStart(2, "0")}</b>
            {module && (
              <span className={css.bookLabel}>
                <span lang="el">{module.title}</span>
                <small>{module.subtitle}</small>
              </span>
            )}
          </li>
        ))}
      </ol>
      <button
        type="button"
        className={`${css.shelfArrow} ${css.prev}`}
        aria-label="Предыдущие модули"
        disabled={edges.start}
        onClick={() => page(-1)}
      >
        <ChevronLeft aria-hidden="true" />
      </button>
      <button
        type="button"
        className={`${css.shelfArrow} ${css.next}`}
        aria-label="Следующие модули"
        disabled={edges.end}
        onClick={() => page(1)}
      >
        <ChevronRight aria-hidden="true" />
      </button>
    </div>
  );
}

const modulesLabel = (count: number) => {
  const tens = count % 100,
    ones = count % 10;
  const word = tens >= 11 && tens <= 14 ? "модулей" : ones === 1 ? "модуля" : "модулей";
  return `${count} ${word}`;
};

const longDate = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${iso}T12:00:00Z`),
  );

interface Answer {
  given: string;
  result: ItemResult;
}

const splitPrompt = (prompt: string) => {
  const at = prompt.search(/[[(]/);
  return at < 0 ? { greek: prompt, gloss: "" } : { greek: prompt.slice(0, at).trim(), gloss: prompt.slice(at).trim() };
};
const clause = (text: string) => text.charAt(0).toLocaleLowerCase("ru") + text.slice(1);

function Verdict({ task, answer }: { task: SampleTask; answer: Answer }) {
  const { status, expected } = answer.result;
  const why = task.item.explanation;
  if (status === "correct") return <p className={css.okLine}>верно{why ? ` — ${clause(why)}` : ""}</p>;
  if (status === "almost")
    return (
      <p className={css.almostLine}>
        почти: <span lang="el">{expected}</span>
        {why ? ` — ${clause(why)}` : " — проверьте тонос"}
      </p>
    );
  return (
    <p className={css.penLine}>
      правильно: <span lang="el">{expected}</span>
      {why ? ` — ${clause(why)}` : ""}
    </p>
  );
}

function DoneRow({ index, task, answer }: { index: number; task: SampleTask; answer?: Answer }) {
  const status = answer?.result.status;
  return (
    <li className={answer ? css.row : `${css.row} ${css.empty}`}>
      <span className={css.n}>{index + 1}</span>
      <span>
        <b lang="el">{splitPrompt(task.item.prompt).greek}</b>
        {answer && (
          <>
            {" — "}
            {status === "correct" ? (
              <i className={css.ink}>{answer.given}</i>
            ) : (
              <>
                <s className={status === "almost" ? css.almostStrike : css.penStrike}>{answer.given}</s>
                <ins className={status === "almost" ? css.almostIns : css.penIns}>{answer.result.expected}</ins>
              </>
            )}
          </>
        )}
      </span>
      {status === "correct" && <Tick className={css.tick} label="верно" />}
      {status === "almost" && <Tick className={`${css.tick} ${css.almost}`} label="почти" />}
      {status === "wrong" && <span className="sr-only">ошибка</span>}
    </li>
  );
}

function Lesson({ tasks, bot }: { tasks: SampleTask[]; bot: string | null }) {
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const task = tasks[current];
  const answer = answers[current];
  const finished = answers.length === tasks.length && current >= tasks.length;

  useEffect(() => {
    if (answer) next.current?.focus({ preventScroll: true });
  }, [answer]);

  const check = (given: string) => {
    if (!task || answer || !given.trim()) return;
    setAnswers((list) => [...list, { given: given.trim(), result: checkItem(task.block, task.item, given) }]);
  };
  const advance = () => {
    setDraft("");
    setCurrent((index) => index + 1);
    requestAnimationFrame(() => input.current?.focus({ preventScroll: true }));
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (answer) advance();
    else check(draft);
  };
  const restart = () => {
    setAnswers([]);
    setDraft("");
    setCurrent(0);
  };

  const correct = answers.filter((item) => item.result.status === "correct").length;
  const almost = answers.filter((item) => item.result.status === "almost").length;

  return (
    <div className={css.lessonGrid}>
      <section className={css.sheetCol} aria-live="polite">
        {finished ? (
          <div className={css.sheet}>
            <h3 className={css.summaryTitle}>
              {correct} из {tasks.length} верно{almost ? `, ${almost} почти` : ""}
            </h3>
            <p className={css.print}>
              Здесь были четыре задания из урока 1.1. В боте урок открывается полностью: правила чтения, ударение,
              глагол είμαι и остальные упражнения. За ним идут уроки 1.2 и 1.3 и контрольная модуля.
            </p>
            <div className={css.summaryActions}>
              <BotLink bot={bot} start>
                Продолжить урок в Telegram
              </BotLink>
              <button type="button" className={css.quiet} onClick={restart}>
                Пройти ещё раз
              </button>
            </div>
          </div>
        ) : (
          task && (
            <form className={css.sheet} onSubmit={submit}>
              <p className={css.instruction}>{task.block.instruction}</p>
              <p className={css.prompt}>
                <span lang="el">{splitPrompt(task.item.prompt).greek}</span>
                <small>{splitPrompt(task.item.prompt).gloss.replace(/^\(|\)$/g, "")}</small>
              </p>
              {task.block.format === "choice" ? (
                <div className={css.options} role="group" aria-label="Варианты ответа">
                  {task.item.options?.map((option) => {
                    const picked = answer?.given === option;
                    const right = answer && option === answer.result.expected;
                    const state = right ? css.right : picked ? css.wrong : "";
                    return (
                      <button
                        key={option}
                        type="button"
                        className={`${css.option} ${state}`}
                        disabled={!!answer}
                        aria-pressed={picked}
                        onClick={() => check(option)}
                      >
                        {option}
                        {right && <Tick className={css.tick} label="верно" />}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <input
                  ref={input}
                  className={css.answer}
                  lang="el"
                  value={answer ? answer.given : draft}
                  readOnly={!!answer}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="ответ по-гречески"
                  aria-label="Ваш ответ"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                />
              )}
              {answer ? (
                <Verdict task={task} answer={answer} />
              ) : (
                task.block.format === "text" && <p className={css.hint}>Ответ без тоноса засчитается как «почти».</p>
              )}
              <div className={css.cloud}>
                <span className={css.count}>
                  {current + 1} из {tasks.length}
                  <small>урок 1.1 · модуль 01</small>
                </span>
                {answer ? (
                  <button ref={next} type="submit" className={css.go}>
                    {current + 1 === tasks.length ? "К итогу" : "Далее ›"}
                  </button>
                ) : (
                  task.block.format === "text" && (
                    <button type="submit" className={css.go} disabled={!draft.trim()}>
                      Проверить
                    </button>
                  )
                )}
              </div>
            </form>
          )
        )}
      </section>
      <section className={css.doneCol}>
        <div className={css.doneHead}>
          <h3>Задания урока</h3>
          <span className={css.label}>
            сделано {answers.length} из {tasks.length}
          </span>
        </div>
        <ol className={css.rows}>
          {tasks.map((item, index) => (
            <DoneRow key={`${item.block.id}-${item.item.id}`} index={index} task={item} answer={answers[index]} />
          ))}
        </ol>
      </section>
    </div>
  );
}

export default function Landing({ bot }: { bot: string | null }) {
  const [content, setContent] = useState<LandingContent | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    loadLanding(fetcher).then(setContent, () => setFailed(true));
  }, []);

  const course = content?.catalog.courses[0];
  const modules = (content?.catalog.modules ?? [])
    .filter((module) => !course || module.courseId === course.id)
    .sort((a, b) => a.number - b.number);
  const first = modules[0];
  const exam = course?.exam;
  const count = modules.length || SHELF_SIZE;

  return (
    <div className={css.page} data-testid="open-in-telegram">
      <div className={css.wrap}>
        <header className={css.top}>
          <div>
            <h1 className={css.title}>
              Греческий <em>с нуля</em> до экзамена A2
            </h1>
            <p className={css.lede}>
              Курс из {modulesLabel(count)} для подготовки к экзамену <span lang="el">ΚΕΓ</span>. В каждом есть
              объяснение грамматики, тексты, диалоги с аудио, задания на письмо и речь. Ответы проверяются сразу, к
              ошибкам есть пояснения.
            </p>
          </div>
          <div className={css.side}>
            <BotLink bot={bot}>Открыть в Telegram</BotLink>
            <p className={css.meta}>
              Регистрация не нужна: курс открывается в Telegram, прогресс сохраняется в вашем аккаунте и доступен на
              телефоне и компьютере.
            </p>
          </div>
        </header>

        <Shelf modules={modules} />
        <p className={css.exam}>
          {exam ? (
            <>
              {exam.title} — <b>{longDate(exam.date)}</b>
              {!exam.localConfirmed && <span className={css.caveat}>дата для Кипра не подтверждена</span>}
            </>
          ) : (
            " "
          )}
        </p>

        <section className={css.open} aria-labelledby="sample-title">
          <div className={css.lid} style={{ background: coverColor(1) }}>
            <span className={css.num}>01</span>
            <div>
              <h2 id="sample-title" lang="el">
                {first?.title ?? "Γνωριμία"}
              </h2>
              <p>Попробуйте урок 1.1 на этой странице</p>
            </div>
            {first?.goal && <p className={css.goal}>Цель модуля: {first.goal}.</p>}
          </div>
          <div className={`${css.pg} notebook`}>
            {content?.tasks.length ? (
              <Lesson tasks={content.tasks} bot={bot} />
            ) : (
              <p className={css.print}>
                {failed
                  ? "Не удалось загрузить задания. Проверьте соединение и обновите страницу."
                  : content
                    ? "Пробный урок не загрузился. Весь курс доступен в Telegram."
                    : "Загружаем задания урока 1.1…"}
              </p>
            )}
          </div>
        </section>

        <section className={css.facts}>
          <div>
            <h3>Уроки по порядку</h3>
            <p>
              Каждый урок идёт от объяснения к практике и проверке. Слова и фразы из пройденных уроков повторяются на
              карточках.
            </p>
          </div>
          <div>
            <h3>Четыре навыка</h3>
            <p>Чтение, аудирование, письмо и речь оцениваются по отдельности, поэтому видно, какой навык отстаёт.</p>
          </div>
          <div>
            <h3>План к экзамену</h3>
            <p>
              Курс рассчитан на 2–3 занятия по часу в неделю и 10–15 минут повторения в день. Отставание от календаря
              курса показано на экране прогресса.
            </p>
          </div>
        </section>

        <footer className={css.close}>
          <h2>Начните с тетради 01</h2>
          <BotLink bot={bot} start>
            Открыть в Telegram
          </BotLink>
        </footer>
      </div>
    </div>
  );
}
