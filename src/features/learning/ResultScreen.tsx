import { Button } from "@/components/ui/button";
import { useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { formatDay, localDay } from "../../domain/learning";
import type { CardKind, LearningRef, ReviewEvent } from "../../domain/types";
import { useNow } from "../../shared/clock";
import { CARDS, minutes, PHRASES, plural, withCount, WORDS } from "../../shared/format";
import { useSettings } from "../../shared/store";
import { statesOf } from "../../storage/queries";
import { db } from "../../storage/db";
import { startSession } from "./session-actions";
import { compositionLine, DoneList, doneRows, markOf, PageHead } from "./notebook";
import s from "./session.module.css";

/** Состав уникальных карточек по видам: «2 слова · 1 фраза», только непустые группы. */
export const compositionText = (byKind: Record<CardKind, number>) =>
  (
    [
      ["word", WORDS],
      ["phrase", PHRASES],
    ] as const
  )
    .filter(([kind]) => byKind[kind])
    .map(([kind, forms]) => withCount(byKind[kind], forms))
    .join(" · ");

const greekOf = (event: ReviewEvent) =>
  "greek" in event.snapshot ? event.snapshot.greek : "text" in event.snapshot ? event.snapshot.text : "";
const keyOf = (ref: LearningRef) => JSON.stringify([ref.kind, ref.id]);

export function ResultScreen() {
  const { id } = useParams();
  const navigate = useNavigate();
  const now = useNow();
  const { settings } = useSettings();
  const session = useLiveQuery(() => (id ? db.sessions.get(id) : undefined), [id]);
  const result = useLiveQuery(async () => {
    const events = id ? await db.events.where("sessionId").equals(id).toArray() : [];
    const mistakes = events.filter(
      (event) => event.correct === false || (event.correct === null && event.rating === 1),
    );
    const mistakeRefs = [...new Map(mistakes.map((event) => [event.unitKey, event.ref])).values()];
    return { events, mistakes, mistakeRefs, states: await statesOf(mistakeRefs) };
  }, [id]);
  const events = result?.events ?? [],
    mistakes = result?.mistakes ?? [],
    mistakeRefs = result?.mistakeRefs ?? [];
  // Повторная попытка той же карточки не увеличивает число уникальных карточек.
  const unique = new Map(events.map((event) => [event.unitKey, event.ref]));
  const byKind: Record<CardKind, number> = { word: 0, phrase: 0 };
  // Снятый вид разряда в разбивке не занимает: его ответы остаются в общем числе и в точности.
  for (const ref of unique.values()) if (ref.kind in byKind) byKind[ref.kind]++;
  const mixed = byKind.phrase > 0;
  const objective = events.filter((event) => event.correct !== null);
  // «Сразу» — карточка без единой ошибки в занятии; остальные прошли с исправлением.
  const corrected = new Set(mistakes.map((event) => event.unitKey));
  const clean = [...unique.keys()].filter((key) => !corrected.has(key)).length;
  const readyAgain: LearningRef[] = mistakeRefs.filter((ref) => {
    const state = result?.states.get(keyOf(ref));
    return state && new Date(state.card.due).getTime() <= now.getTime();
  });
  // Когда вернутся ошибки — по сроку каждой карточки, сгруппировано по дням: общий срок не выдумываем.
  const returns = new Map<string, string[]>();
  for (const ref of mistakeRefs) {
    const state = result?.states.get(keyOf(ref));
    if (!state || readyAgain.includes(ref)) continue;
    const day = localDay(new Date(state.card.due), settings.timezone);
    const event = mistakes.find((entry) => entry.unitKey === keyOf(ref) || entry.ref.id === ref.id);
    returns.set(day, [...(returns.get(day) ?? []), event ? greekOf(event) : ""].filter(Boolean));
  }
  const today = localDay(now, settings.timezone);
  const tomorrow = localDay(new Date(now.getTime() + 86_400_000), settings.timezone);
  const dayName = (day: string) => (day === today ? "сегодня" : day === tomorrow ? "завтра" : formatDay(day));
  const rows = session ? doneRows(session, new Map(events.map((event) => [event.id, event]))) : [];
  const almost = events.filter((event) => markOf(event) === "almost").length;

  const repeat = async () => {
    const created = await startSession(now, { refs: readyAgain });
    void navigate(created ? "/session" : "/");
  };
  return (
    <main className={`${s.session} ${s.result}`}>
      <div className={s.page}>
        <PageHead day={session?.planDate ?? today} />
        <DoneList rows={rows} />
        <section className={s.summary} aria-labelledby="result-title">
          <h2 id="result-title" className={s.summaryTitle}>
            Занятие завершено
          </h2>
          <p className={s.summaryLine} data-testid="composition">
            {withCount(unique.size, mixed ? CARDS : WORDS)}
            {mixed && ` (${compositionText(byKind)})`} · {clean} сразу, {unique.size - clean} с исправлением.
          </p>
          {[...returns].map(([day, names]) => (
            <p key={day} className={s.summaryNote}>
              {plural(names.length, ["Ошибка вернётся", "Ошибки вернутся", "Ошибки вернутся"])} {dayName(day)}:{" "}
              <b lang="el">{names.join(", ")}</b>.
            </p>
          ))}
          <p className={s.summaryNote}>
            Упражнений: {events.length}, ошибок: {mistakes.length}
            {almost ? `, из них «почти»: ${almost}` : ""}.{" "}
            {objective.length
              ? `Объективная точность (выбор, сборка, аудирование, написание, пропуск): ${Math.round((objective.filter((event) => event.correct).length / objective.length) * 100)}% из ${withCount(objective.length, ["ответа", "ответов", "ответов"])}.`
              : "Объективных проверок в этом занятии не было — только самооценка. Точность: нет данных."}
          </p>
          <p className={s.summaryNote}>Активное время: {minutes(session?.activeTimeMs ?? 0)}</p>
          {readyAgain.length > 0 && (
            <div className={s.summaryActions}>
              <Button variant="soft" size="xl" onClick={repeat}>
                Повторить ошибки ({readyAgain.length})
              </Button>
            </div>
          )}
        </section>
      </div>
      <div className={s.cloud} role="group" aria-label="Итог занятия" data-cloud>
        <span className={s.count}>
          <span>
            {rows.length} из {session?.items.length ?? rows.length}
          </span>
          <small>{session ? compositionLine(session.items) : ""}</small>
        </span>
        <Button size="md" className={s.primary} onClick={() => navigate("/")}>
          Готово
        </Button>
      </div>
    </main>
  );
}
