import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { DEFAULT_LANGUAGE, PROFILES } from "../../domain/language";
import { addDays, deviceTimezone, formatDay, isDue, reviewCutoff, studyDay } from "../../domain/learning";
import type { LearningRef, ReviewEvent } from "../../domain/types";
import { useNow } from "../../shared/clock";
import { CARDS, withCount } from "../../shared/format";
import { statesOf } from "../../storage/queries";
import { languageCourses, sessionLanguage } from "../../storage/courses";
import { db } from "../../storage/db";
import { ProfileContext } from "../../shared/language";
import { sessionPath, startSession } from "./session-actions";
import { DoneList, doneRows, PageHead } from "./notebook";
import { answersLine, cardOutcomes, isMistake, limitNames, splitRows } from "./result";
import s from "./session.module.css";

/** Подпись карточки из снимка ответа: у задания урока — его вопрос. */
export const snapshotLabel = ({ snapshot }: Pick<ReviewEvent, "snapshot">) =>
  "greek" in snapshot
    ? snapshot.greek
    : "text" in snapshot
      ? snapshot.text
      : "prompt" in snapshot
        ? snapshot.prompt
        : "";
/** Когда вернутся ошибки — по учебному дню срока каждой карточки, сгруппировано по дням: общий срок не выдумываем. */
export function returnDays(now: Date, timezone: string, returns: { due: Date | string; label: string }[]) {
  const today = studyDay(now, timezone);
  const tomorrow = addDays(today, 1);
  const days = new Map<string, string[]>();
  for (const { due, label } of returns) {
    const day = studyDay(new Date(due), timezone);
    days.set(day, [...(days.get(day) ?? []), label]);
  }
  return [...days].map(
    ([day, names]) => [day === today ? "сегодня" : day === tomorrow ? "завтра" : formatDay(day), names] as const,
  );
}
const keyOf = (ref: LearningRef) => JSON.stringify([ref.kind, ref.id]);

export function ResultScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const now = useNow();
  const [cleanFolded, setCleanFolded] = useState(true);
  const session = useLiveQuery(() => (id ? db.sessions.get(id) : undefined), [id]);
  const profile =
    useLiveQuery(async () => (session ? PROFILES[await sessionLanguage(session)] : undefined), [session?.id]) ??
    PROFILES[DEFAULT_LANGUAGE];
  const result = useLiveQuery(async () => {
    const events = id ? await db.events.where("sessionId").equals(id).toArray() : [];
    const mistakes = events.filter(isMistake);
    const mistakeRefs = [...new Map(mistakes.map((event) => [event.unitKey, event.ref])).values()];
    return { events, mistakes, mistakeRefs, states: await statesOf(mistakeRefs) };
  }, [id]);
  const events = result?.events ?? [],
    mistakeRefs = result?.mistakeRefs ?? [];
  const { cells, corrected, clean } = cardOutcomes(events);
  const cutoff = reviewCutoff(now, deviceTimezone());
  const readyAgain: LearningRef[] = mistakeRefs.filter((ref) => {
    const state = result?.states.get(keyOf(ref));
    return state && isDue(state.card, now, cutoff);
  });
  const returns = returnDays(
    now,
    deviceTimezone(),
    mistakeRefs.flatMap((ref) => {
      const state = result?.states.get(keyOf(ref));
      if (!state || readyAgain.includes(ref)) return [];
      const event = result?.mistakes.find((entry) => entry.unitKey === keyOf(ref) || entry.ref.id === ref.id);
      const label = event ? snapshotLabel(event) : "";
      return label ? [{ due: state.card.due, label }] : [];
    }),
  );
  const rows = session ? doneRows(session, new Map(events.map((event) => [event.id, event]))) : [];
  const groups = splitRows(rows, corrected);

  const repeat = async () => {
    const created = await startSession(now, {
      refs: readyAgain,
      courseIds: session ? await languageCourses(session) : undefined,
    });
    void navigate(created ? await sessionPath(created) : "/", { replace: true });
  };
  return (
    <ProfileContext value={profile}>
      <main className={`${s.session} ${s.result}`}>
        <div className={s.page}>
          <PageHead day={session?.planDate ?? studyDay(now, deviceTimezone())} title="Занятие завершено" />
          {result && (
            <section className={s.recap} aria-label="Результат занятия">
              {cells.length ? (
                <>
                  <p className={s.big} data-testid="result-count">
                    <b>{clean}</b> <span>из {cells.length} без ошибок</span>
                  </p>
                  <div className={s.strip} aria-hidden="true" data-testid="result-cells">
                    {cells.map((kind, index) => (
                      <i
                        key={index}
                        className={kind === "wrong" ? s.cellWrong : kind === "almost" ? s.cellAlmost : ""}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <p className={s.big}>
                  <span>Ответов нет</span>
                </p>
              )}
              {returns.map(([day, names]) => {
                const { shown, rest } = limitNames(names);
                return (
                  <p key={day} className={s.back}>
                    <small>
                      {names.length > 1 ? "Вернутся" : "Вернётся"} {day}
                    </small>
                    <b lang={profile.code}>{shown.join(", ")}</b>
                    {rest > 0 && ` и ещё ${rest}`}
                  </p>
                );
              })}
              {cells.length > 0 && <p className={s.meta}>{answersLine(events, session?.activeTimeMs ?? 0)}</p>}
              {readyAgain.length > 0 && (
                <Button variant="soft" size="xl" className={s.again} onClick={repeat}>
                  Повторить ошибки ({readyAgain.length})
                </Button>
              )}
            </section>
          )}
          {result && (
            <>
              <DoneList rows={groups.fixed} title={`С исправлением · ${groups.fixedCards}`} />
              <DoneList rows={groups.skipped} title={`Пропущено · ${groups.skipped.length}`} />
              <DoneList
                rows={groups.clean}
                folded={cleanFolded}
                onToggle={() => setCleanFolded(!cleanFolded)}
                foldLabel="Без ошибок"
              />
            </>
          )}
        </div>
        <div className={s.cloud} role="group" aria-label="Итог занятия" data-cloud>
          <span className={s.count}>
            <span>{cells.length ? withCount(cells.length, CARDS) : ""}</span>
          </span>
          <Button size="md" className={s.primary} onClick={() => navigate("/", { replace: true })}>
            Готово
          </Button>
        </div>
      </main>
    </ProfileContext>
  );
}
