import { Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useNavigate, useParams } from "react-router-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { Screen } from "../../app/Screen";
import { formatDay, localDay } from "../../domain/learning";
import type { CardKind, LearningRef } from "../../domain/types";
import { useNow } from "../../shared/clock";
import { CARDS, minutes, PHRASES, plural, withCount, WORDS } from "../../shared/format";
import { StatTile } from "../../shared/StatTile";
import { useSettings } from "../../shared/store";
import { statesOf } from "../../storage/queries";
import { db } from "../../storage/db";
import { startSession } from "./session-actions";
import ui from "../../shared/ui.module.css";

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
  const readyAgain: LearningRef[] = mistakeRefs.filter((ref) => {
    const state = result?.states.get(JSON.stringify([ref.kind, ref.id]));
    return state && new Date(state.card.due).getTime() <= now.getTime();
  });
  const nextDue = [...(result?.states.values() ?? [])]
    .map((state) => new Date(state.card.due))
    .sort((a, b) => a.getTime() - b.getTime())[0];

  const repeat = async () => {
    const created = await startSession(now, { refs: readyAgain });
    void navigate(created ? "/session" : "/");
  };
  return (
    <Screen bare roomy>
      <h1>Занятие завершено</h1>
      <div className={ui.tiles}>
        <StatTile
          value={unique.size}
          label={`${plural(unique.size, mixed ? CARDS : WORDS)} в занятии`}
          testId="composition"
          note={mixed && compositionText(byKind)}
        />
        <StatTile value={events.length} label="упражнений выполнено" />
      </div>
      <Card className="mb-3">
        <CardContent className="flex flex-col gap-1.5">
          <p className="m-0">
            Ошибок: <b>{mistakes.length}</b>
          </p>
          <p className="m-0 text-sm text-muted-foreground">
            {objective.length
              ? `Объективная точность (выбор, сборка, аудирование, написание, пропуск): ${Math.round((objective.filter((event) => event.correct).length / objective.length) * 100)}% из ${withCount(objective.length, ["ответа", "ответов", "ответов"])}`
              : "Объективных проверок в этом занятии не было — только самооценка. Точность: нет данных."}
          </p>
          <p className="m-0 text-sm text-muted-foreground">Активное время: {minutes(session?.activeTimeMs ?? 0)}</p>
        </CardContent>
      </Card>
      {mistakeRefs.length > 0 &&
        (readyAgain.length > 0 ? (
          <Button variant="soft" size="xl" onClick={repeat}>
            Повторить ошибки ({readyAgain.length})
          </Button>
        ) : (
          <Alert className="mb-3">
            <Info />
            <AlertDescription>
              Карточки с ошибками вернутся
              {nextDue ? ` ${formatDay(localDay(nextDue, settings.timezone))}` : " в ближайшем занятии"} — так интервалы
              остаются честными.
            </AlertDescription>
          </Alert>
        ))}
      <Button size="xl" style={{ marginTop: 12 }} onClick={() => navigate("/")}>
        Готово
      </Button>
    </Screen>
  );
}
