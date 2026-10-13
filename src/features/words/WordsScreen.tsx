import { memo, useDeferredValue, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Search } from "lucide-react";
import { useHref, useLocation, useNavigate, useNavigationType, useParams, useSearchParams } from "react-router-dom";
import { KEEP_SCROLL, rememberScroll } from "../../app/scroll";
import { Screen } from "../../app/Screen";
import { CourseSwitch } from "../../shared/CourseSwitch";
import { useCardCourse, useFollowCourse } from "../../shared/courses";
import { cx } from "../../shared/cx";
import { withCount, WORDS } from "../../shared/format";
import { useSpread } from "../../shared/media";
import nb from "../../shared/notebook.module.css";
import { ProfileContext, useCourseProfile, useProfile } from "../../shared/language";
import { Tick } from "../../shared/Tick";
import { currentCourse } from "../../storage/courses";
import {
  countMarks,
  dictionary,
  filterDictionary,
  type CardMark,
  type DictionaryEntry,
  type DictionaryLesson,
} from "../../storage/dictionary";
import { EntrySheet } from "./WordSheet";
import css from "./dictionary.module.css";

type Filter = "all" | "learning" | "solid";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "все" },
  { key: "learning", label: "учу" },
  { key: "solid", label: "закреплены" },
];
const toFilter = (value: string | null): Filter => FILTERS.find((item) => item.key === value)?.key ?? "all";
const searchOf = (query: string, filter: Filter) =>
  new URLSearchParams({ ...(query && { q: query }), ...(filter !== "all" && { filter }) });
const URL_DELAY = 300;
const MARK_LABEL: Record<CardMark, string> = { new: "не начато", learning: "учу", solid: "закреплено" };

export const entryPath = (entry: Pick<DictionaryEntry, "ref">) =>
  entry.ref.kind === "word"
    ? `/words/${encodeURIComponent(entry.ref.id)}`
    : `/words/phrase/${encodeURIComponent(entry.ref.id)}`;

export function WordsScreen() {
  const spread = useSpread();
  const data = useLiveQuery(async () => {
    const courseId = await currentCourse();
    return { courseId, lessons: await dictionary(courseId) };
  }, []);
  const profile = useCourseProfile(data?.courseId);
  if (!data) return <Screen />;
  const list = <Dictionary lessons={data.lessons} switcher />;
  return (
    <ProfileContext value={profile}>
      <Screen wide={spread}>
        {spread ? (
          <div className={cx(nb.spread, css.spread)}>
            {list}
            <div className={cx(nb.page, css.page)}>
              <p className={css.pick}>Выберите слово — оно откроется на этой странице.</p>
            </div>
          </div>
        ) : (
          list
        )}
      </Screen>
    </ProfileContext>
  );
}

export function EntryScreen({ kind }: { kind: "word" | "phrase" }) {
  const { id = "" } = useParams();
  const spread = useSpread();
  const course = useCardCourse({ kind, id });
  useFollowCourse(course ?? undefined);
  const lessons = useLiveQuery(() => (course === undefined ? undefined : dictionary(course ?? undefined)), [course]);
  const profile = useCourseProfile(course ?? undefined);
  if (!lessons) return <Screen back="" paper />;
  const sheet = <EntrySheet kind={kind} id={id} lessons={lessons} courseId={course ?? undefined} />;
  if (!spread)
    return (
      <ProfileContext value={profile}>
        <Screen back="" paper>
          {sheet}
        </Screen>
      </ProfileContext>
    );
  return (
    <ProfileContext value={profile}>
      <Screen wide paper>
        <div className={cx(nb.spread, nb.spine, css.spread)}>
          <Dictionary lessons={lessons} current={`${kind}:${id}`} />
          <div className={cx(nb.page, css.page)}>{sheet}</div>
        </div>
      </Screen>
    </ProfileContext>
  );
}

function Dictionary({
  lessons,
  current,
  switcher,
}: {
  lessons: DictionaryLesson[];
  current?: string;
  switcher?: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const { key } = useLocation();
  const navigation = useNavigationType();
  const spread = useSpread();
  // Не из адреса напрямую: обновление адреса у маршрутизатора не срочное и отставало бы от ввода.
  const [query, setQuery] = useState(() => params.get("q") ?? "");
  const [filter, setFilter] = useState(() => toFilter(params.get("filter")));
  const [seen, setSeen] = useState(key);
  if (seen !== key) {
    setSeen(key);
    if (navigation !== "REPLACE") {
      setQuery(params.get("q") ?? "");
      setFilter(toFilter(params.get("filter")));
    }
  }
  const navigate = useNavigate();
  const base = useHref("/").replace(/\/$/, "");
  const timer = useRef<number | undefined>(undefined);
  // Замена, а не новая запись: «Назад» со слова возвращает тот же поиск, а история не копит буквы.
  const write = (q: string, mark: Filter) => {
    clearTimeout(timer.current);
    timer.current = undefined;
    setParams(searchOf(q, mark), { replace: true });
    rememberScroll();
  };
  const flush = () => {
    if (timer.current !== undefined) write(query, filter);
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (navigation === "REPLACE") return;
    clearTimeout(timer.current);
    timer.current = undefined;
  }, [key, navigation]);
  const changeQuery = (q: string) => {
    setQuery(q);
    clearTimeout(timer.current);
    // WebKit бросает SecurityError после ~100 replaceState за 10 с, поэтому адрес — не на каждый символ.
    timer.current = window.setTimeout(() => write(q, filter), URL_DELAY);
  };
  const changeFilter = (mark: Filter) => {
    setFilter(mark);
    write(query, mark);
  };
  // Строки — обычные ссылки без подписки на адрес: иначе каждый символ поиска перерисовывал бы все ~1300.
  const open = (event: MouseEvent) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    const link = (event.target as Element).closest<HTMLAnchorElement>("a[data-path]");
    if (!link?.dataset.path) return;
    event.preventDefault();
    flush();
    if (spread)
      void navigate(
        { pathname: link.dataset.path, search: searchOf(query, filter).toString() },
        { state: KEEP_SCROLL },
      );
    else void navigate(link.dataset.path);
  };
  const shownQuery = useDeferredValue(query);
  const shownFilter = useDeferredValue(filter);
  const { names, code } = useProfile();
  const counts = useMemo(() => countMarks(lessons), [lessons]);
  const shown = useMemo(() => filterDictionary(lessons, shownFilter, shownQuery), [lessons, shownFilter, shownQuery]);
  const found = useMemo(() => {
    let words = 0;
    let phrases = 0;
    for (const lesson of shown)
      for (const entry of lesson.entries) {
        if (entry.phrase) phrases++;
        else words++;
      }
    return { words, phrases };
  }, [shown]);
  const currentLesson = useMemo(
    () => (current ? shown.find((lesson) => lesson.entries.some((entry) => refKey(entry) === current))?.id : undefined),
    [shown, current],
  );
  return (
    <section className={cx(nb.page, css.page)} aria-label="Словарь" onClick={open}>
      {switcher && <CourseSwitch />}
      <h1 className={nb.title}>Словарь</h1>
      <p className={nb.meta} data-testid="word-count">
        {[withCount(found.words, WORDS), found.phrases && withCount(found.phrases, ["фраза", "фразы", "фраз"])]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <label className={css.search}>
        <Search aria-hidden size={18} />
        <input
          type="search"
          value={query}
          onChange={(event) => changeQuery(event.target.value)}
          onBlur={flush}
          placeholder="Найти слово или фразу"
          aria-label={`Поиск ${names.by} или русскому`}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </label>
      <p className={css.filters} role="group" aria-label="Состояние">
        {FILTERS.map((item, index) => (
          <span key={item.key}>
            {index > 0 && <span aria-hidden> · </span>}
            <button type="button" aria-pressed={filter === item.key} onClick={() => changeFilter(item.key)}>
              {item.label} {counts[item.key]}
            </button>
          </span>
        ))}
      </p>
      {!counts.all ? (
        <p className={css.empty}>Слова и фразы появятся здесь, когда вы откроете первый урок курса.</p>
      ) : !shown.length ? (
        <p className={css.empty}>Ничего не нашлось.</p>
      ) : (
        shown.map((lesson, index) => (
          <LessonSection
            // Новый элемент при другом числе строк: contain-intrinsic-size: auto помнил бы высоту прежнего набора.
            key={`${lesson.id}:${lesson.entries.length}`}
            lesson={lesson}
            newModule={index === 0 || shown[index - 1].moduleId !== lesson.moduleId}
            code={code}
            current={lesson.id === currentLesson ? current : undefined}
            base={base}
          />
        ))
      )}
    </section>
  );
}

const refKey = (entry: DictionaryEntry) => `${entry.ref.kind}:${entry.ref.id}`;

const LessonSection = memo(function LessonSection({
  lesson,
  newModule,
  code,
  current,
  base,
}: {
  lesson: DictionaryLesson;
  newModule: boolean;
  code: string;
  current?: string;
  base: string;
}) {
  const heading = newModule && !!lesson.moduleId;
  const solid = lesson.entries.filter((entry) => entry.mark === "solid").length;
  return (
    <section
      className={css.section}
      // Оценка занижена: страница длиннее настоящей не вернула бы позицию у конца списка после «Назад».
      style={{ containIntrinsicSize: `auto ${lesson.entries.length * 48 + (heading ? 112 : 52)}px` }}
      aria-label={lesson.title}
      data-testid="dictionary-lesson"
    >
      {heading && (
        <p className={css.module}>
          Модуль {String(lesson.moduleNumber).padStart(2, "0")} · <span lang={code}>{lesson.moduleTitle}</span>
        </p>
      )}
      <h2 className={css.lesson}>
        {lesson.number && <span className={css.number}>{lesson.number}</span>}
        <span className={css.lessonTitle}>{lesson.title}</span>
        <span className={css.solid} aria-label={`закреплено ${solid} из ${lesson.entries.length}`}>
          {solid} из {lesson.entries.length}
        </span>
      </h2>
      <ul className={css.rows}>
        {lesson.entries.map((entry) => (
          <li key={entry.key}>
            <a
              href={base + entryPath(entry)}
              data-path={entryPath(entry)}
              className={css.row}
              aria-current={current === refKey(entry) ? "page" : undefined}
            >
              <span className={cx(css.greek, entry.phrase && css.phrase)} lang={code}>
                {entry.greek}
              </span>
              <span className={css.russian}>{entry.russian}</span>
              <Mark mark={entry.mark} />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
});

function Mark({ mark }: { mark: CardMark }) {
  if (mark === "solid") return <Tick className={css.tick} label={MARK_LABEL.solid} />;
  return <i className={cx(css.mark, mark === "learning" && css.learning)} role="img" aria-label={MARK_LABEL[mark]} />;
}
