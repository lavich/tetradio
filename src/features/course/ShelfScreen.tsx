import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useId, useRef, useState } from "react";
import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Screen } from "../../app/Screen";
import { shareCourse } from "../../platform/share";
import { moduleViews, type ModuleView } from "../../storage/course";
import { languages, shelfLanguage, type CourseEntry } from "../../storage/courses";
import { db } from "../../storage/db";
import { LanguageSwitch } from "../../shared/CourseSwitch";
import { courseName, useCoursePalette } from "../../shared/courses";
import { useAction } from "../../shared/action";
import { pausedSince } from "../../shared/format";
import { pauseCourse, resumeCourse } from "../../storage/pause-actions";
import { CourseMenu } from "./CourseMenu";
import { useCourseProfile } from "../../shared/language";
import { Tick } from "../../shared/Tick";
import { coverColor, mutedCover } from "../../shared/notebook";
import { CourseStart } from "../today/FirstRun";
import { checkpointLabels } from "./checkpoints";
import { ExamLine } from "./ExamLine";
import base from "./course.module.css";
import css from "./shelf.module.css";

function coverLabel(view: ModuleView) {
  if (view.module.status === "draft") return "Готовится";
  if (view.completed) return "Заполнена";
  const done = view.lessons.filter((lesson) => lesson.completed).length;
  return done ? `Урок ${done + 1} из ${view.lessons.length}` : "Открыта";
}

export function CourseScreen() {
  const language = useLiveQuery(async () => {
    const code = await shelfLanguage();
    return (await languages()).find((entry) => entry.code === code) ?? null;
  }, []);
  const [status, setStatus] = useState("");
  const { state } = useLocation() as { state: { course?: string } | null };
  const navigate = useNavigate();
  const [focus, setFocus] = useState(state?.course);
  // Адрес без состояния: перезагрузка и «Назад» не возвращают фокус и прокрутку к карточке.
  useEffect(() => {
    if (state?.course) void navigate(".", { replace: true, state: null });
  }, [state, navigate]);
  const code = language?.code;
  useEffect(() => setStatus(""), [code]);
  if (language === undefined) return <Screen />;
  const list = language?.courses ?? [];
  const started = list.filter((course) => course.started);
  const unstarted = list.filter((course) => !course.started).map((course) => course.id);
  return (
    <Screen>
      <LanguageSwitch shelf />
      <h1>Полка</h1>
      <p className="sr-only" role="status" data-testid="shelf-status">
        {status}
      </p>
      {started.map((course) => (
        <CourseShelf
          key={course.id}
          course={course}
          onStatus={setStatus}
          focused={course.id === focus}
          onFocused={() => setFocus(undefined)}
        />
      ))}
      {unstarted.length || !language ? (
        <CourseStart courseIds={unstarted} grouped={false} focus={focus} onFocused={() => setFocus(undefined)} />
      ) : null}
    </Screen>
  );
}

function CourseShelf({
  course,
  onStatus,
  focused,
  onFocused,
}: {
  course: CourseEntry;
  onStatus: (text: string) => void;
  focused: boolean;
  onFocused: () => void;
}) {
  const { id: courseId, pausedAt, title } = course;
  const views = useLiveQuery(() => moduleViews(courseId), [courseId]);
  const calendar = useLiveQuery(async () => (await db.courses.get(courseId))?.calendar, [courseId]);
  const { busy, problem, run } = useAction("Не удалось изменить курс");
  const trigger = useRef<HTMLButtonElement>(null);
  const resume = useRef<HTMLButtonElement>(null);
  // Кнопка, нажатая для паузы или возврата, исчезает: фокус переходит на ту, что её заменила, а не на body.
  const focusAfter = useRef<"resume" | "menu" | null>(null);
  useEffect(() => {
    if (focusAfter.current === "resume" && pausedAt) resume.current?.focus();
    else if (focusAfter.current === "menu" && !pausedAt) trigger.current?.focus();
    else return;
    focusAfter.current = null;
  }, [pausedAt]);
  const profile = useCourseProfile(courseId);
  const palette = useCoursePalette(courseId);
  const heading = useId();
  const section = useRef<HTMLElement>(null);
  const shown = !!views?.length;
  useEffect(() => {
    if (!focused || !shown) return;
    section.current?.scrollIntoView?.({ block: "start" });
    section.current?.focus({ preventScroll: true });
    onFocused();
  }, [focused, shown, onFocused]);
  if (!views?.length) return null;
  const toggle = () => {
    if (busy) return;
    focusAfter.current = pausedAt ? "menu" : "resume";
    return run(async () => {
      if (pausedAt) {
        await resumeCourse(courseId);
        onStatus(`Курс «${title}» продолжается.`);
      } else {
        await pauseCourse(courseId);
        onStatus(`Курс «${title}» на паузе. Вернуть его можно на полке или в настройках.`);
      }
    });
  };
  const filled = views.filter((view) => view.completed).length;
  const current = views.find((view) => view.module.status === "published" && !view.completed)?.module.id;
  const labels = checkpointLabels(calendar);
  return (
    <section ref={section} tabIndex={-1} className={css.course} aria-labelledby={heading} data-testid="course-shelf">
      <div className={css.head}>
        <h2 id={heading} className={css.title}>
          {courseName(course)}
        </h2>
        <span className={css.tools}>
          <span className={base.meta}>
            {filled} из {views.length} заполнено
          </span>
          <CourseMenu title={title} paused={!!pausedAt} onToggle={() => void toggle()} trigger={trigger} />
        </span>
      </div>
      <ExamLine courseId={courseId} />
      {problem && (
        <p className={css.problem} role="alert">
          {problem}
        </p>
      )}
      {pausedAt && (
        <div className={css.paused} data-testid="shelf-paused">
          <p className={css.pausedText}>На паузе с {pausedSince(pausedAt)}</p>
          <Button ref={resume} size="md" className="w-auto" onClick={() => void toggle()} aria-disabled={busy}>
            Продолжить курс
          </Button>
        </div>
      )}
      <button
        type="button"
        className={css.share}
        aria-label={`Поделиться курсом «${title}»`}
        onClick={() => void shareCourse(course)}
      >
        <Share2 aria-hidden size={16} /> Поделиться курсом
      </button>
      <div className={css.shelf}>
        {views.map((view) => {
          const { module } = view;
          const draft = module.status === "draft";
          const classes = [css.cover, draft ? css.draft : "", module.id === current ? css.current : ""].join(" ");
          return (
            <FragmentWithCheckpoint key={module.id} view={view} labels={labels}>
              <Link
                to={`/course/${module.id}`}
                className={classes}
                style={
                  draft
                    ? undefined
                    : {
                        background: pausedAt ? mutedCover(module.number, palette) : coverColor(module.number, palette),
                      }
                }
                aria-label={`Модуль ${module.number}: ${module.subtitle}. ${coverLabel(view)}`}
              >
                {view.completed ? <Tick className={css.coverStamp} label="заполнена" /> : null}
                <span className={css.coverNumber}>{String(module.number).padStart(2, "0")}</span>
                <span className={css.coverTitle} lang={profile.code}>
                  {module.title}
                </span>
                <span className={css.coverLabel}>{coverLabel(view)}</span>
              </Link>
            </FragmentWithCheckpoint>
          );
        })}
      </div>
    </section>
  );
}
/** Метка контрольной точки после модуля; когда точка опубликована — ссылка на неё, после прохождения — с галочкой. */
function FragmentWithCheckpoint({
  view,
  labels,
  children,
}: {
  view: ModuleView;
  labels: Record<number, string>;
  children: React.ReactNode;
}) {
  const point = view.checkpoint;
  const label = labels[view.module.number] ?? point?.title;
  return (
    <>
      {children}
      {label ? (
        point ? (
          <Link to={`/course/${view.module.id}/${point.id}`} className={`${css.checkpoint} ${css.checkpointLink}`}>
            {point.completed ? <Tick className={css.checkpointTick} label="пройдена" /> : null}
            {label}
          </Link>
        ) : (
          <div className={css.checkpoint}>{label}</div>
        )
      ) : null}
    </>
  );
}
