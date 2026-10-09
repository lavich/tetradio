import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Search } from "lucide-react";
import { Link, useParams } from "react-router-dom";
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
import { dictionary, matchesQuery, type CardMark, type DictionaryEntry } from "../../storage/dictionary";
import { EntrySheet } from "./WordSheet";
import css from "./dictionary.module.css";

type Filter = "all" | "learning" | "solid";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "все" },
  { key: "learning", label: "учу" },
  { key: "solid", label: "закреплены" },
];
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
  lessons: Awaited<ReturnType<typeof dictionary>>;
  current?: string;
  switcher?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const { names, code } = useProfile();
  const all = lessons.flatMap((lesson) => lesson.entries);
  const count = (key: Filter) => (key === "all" ? all.length : all.filter((entry) => entry.mark === key).length);
  const shown = lessons
    .map((lesson) => ({
      ...lesson,
      entries: lesson.entries.filter(
        (entry) => (filter === "all" || entry.mark === filter) && (!query.trim() || matchesQuery(entry, query)),
      ),
    }))
    .filter((lesson) => lesson.entries.length);
  const found = shown.flatMap((lesson) => lesson.entries);
  const phrases = found.filter((entry) => entry.phrase).length;
  return (
    <section className={cx(nb.page, css.page)} aria-label="Словарь">
      {switcher && <CourseSwitch />}
      <h1 className={nb.title}>Словарь</h1>
      <p className={nb.meta} data-testid="word-count">
        {[withCount(found.length - phrases, WORDS), phrases && withCount(phrases, ["фраза", "фразы", "фраз"])]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <label className={css.search}>
        <Search aria-hidden size={18} />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
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
            <button type="button" aria-pressed={filter === item.key} onClick={() => setFilter(item.key)}>
              {item.label} {count(item.key)}
            </button>
          </span>
        ))}
      </p>
      {!all.length ? (
        <p className={css.empty}>Слова и фразы появятся здесь, когда вы откроете первый урок курса.</p>
      ) : !shown.length ? (
        <p className={css.empty}>Ничего не нашлось.</p>
      ) : (
        shown.map((lesson, index) => {
          const solid = lesson.entries.filter((entry) => entry.mark === "solid").length;
          const newModule = index === 0 || shown[index - 1].moduleId !== lesson.moduleId;
          return (
            <section key={lesson.id} aria-label={lesson.title} data-testid="dictionary-lesson">
              {newModule && lesson.moduleId && (
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
                    <Link
                      to={entryPath(entry)}
                      className={css.row}
                      aria-current={current === `${entry.ref.kind}:${entry.ref.id}` ? "page" : undefined}
                    >
                      <span className={cx(css.greek, entry.phrase && css.phrase)} lang={code}>
                        {entry.greek}
                      </span>
                      <span className={css.russian}>{entry.russian}</span>
                      <Mark mark={entry.mark} />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </section>
  );
}

function Mark({ mark }: { mark: CardMark }) {
  if (mark === "solid") return <Tick className={css.tick} label={MARK_LABEL.solid} />;
  return <i className={cx(css.mark, mark === "learning" && css.learning)} role="img" aria-label={MARK_LABEL[mark]} />;
}
