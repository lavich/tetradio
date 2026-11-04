import { useLiveQuery } from "dexie-react-hooks";
import { Fragment, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Screen } from "../../app/Screen";
import { glossSpans } from "../../content/course";
import type { PackageReading } from "../../content/schema";
import { sentenceRanges, sentencesOf } from "../../domain/sentences";
import type { Rate } from "../../shared/dialogue";
import { eventDay, WORDS, withCount } from "../../shared/format";
import { noVoice, ProfileContext, useLessonProfile, useProfile } from "../../shared/language";
import { useAssetSource } from "../../shared/store";
import { Tick } from "../../shared/Tick";
import { db } from "../../storage/db";
import { markRead, nextUnreadReading, readingPage } from "../../storage/readings";
import { PlayerButtons } from "./blocks/PlayerButtons";
import { readingExits, type ReadingEntry } from "./reading-groups";
import { useDialoguePlayer } from "./useDialoguePlayer";
import { Marked, TapHint, useFieldMarks, WordTaps } from "./WordTaps";
import ui from "../../shared/ui.module.css";
import base from "./course.module.css";
import blocks from "./blocks/blocks.module.css";

function Text({ reading, line }: { reading: PackageReading; line: number }) {
  const marks = useFieldMarks(reading.id, "text");
  const { code } = useProfile();
  const glosses = glossSpans(reading.text, reading.glosses).map(({ start, length, gloss }) => ({
    start,
    length,
    text: gloss.text,
    russian: gloss.russian,
  }));
  return (
    <p className={`${blocks.reading} whitespace-pre-line`} lang={code}>
      {sentenceRanges(reading.text).map(({ start, end }, index, ranges) => (
        <Fragment key={start}>
          {reading.text.slice(index ? ranges[index - 1].end : 0, start)}
          <span
            className={index === line ? blocks.speaking : undefined}
            data-testid={index === line ? "speaking" : undefined}
          >
            <Marked text={reading.text} marks={marks} glosses={glosses} from={start} to={end} />
          </span>
        </Fragment>
      ))}
    </p>
  );
}

/** По предложениям: длинное высказывание синтез может оборвать без ошибки. */
function Aloud({ reading, onLine }: { reading: PackageReading; onLine: (index: number) => void }) {
  const profile = useProfile();
  const source = useAssetSource();
  const [rate, setRate] = useState<Rate>("normal");
  const [problem, setProblem] = useState<{ text: string; failure: boolean } | null>(null);
  const lines = useMemo(() => {
    const sentences = sentencesOf(reading.text);
    // Пакет, поставленный до смены деления на предложения, не должен звучать чужими записями со сдвигом.
    const audio = reading.audio?.length === sentences.length ? reading.audio : undefined;
    return sentences.map((text, index) => ({ text, audioAssetId: audio?.[index] ?? undefined }));
  }, [reading.text, reading.audio]);
  const { phase, toggle, stop } = useDialoguePlayer({
    lines,
    rate,
    source,
    profile,
    lenient: true,
    onLine,
    onStart: () => setProblem(null),
    onResult: (result) => {
      if (result === "none") setProblem({ text: noVoice(profile), failure: false });
      if (result === "error") setProblem({ text: "Воспроизведение прервалось. Попробуйте ещё раз.", failure: true });
    },
  });
  return (
    <>
      <div className={blocks.player}>
        <PlayerButtons phase={phase} onToggle={toggle} onStop={stop} />
        <Button
          variant="quiet"
          size="sm"
          aria-pressed={rate === "slow"}
          onClick={() => setRate(rate === "slow" ? "normal" : "slow")}
        >
          {rate === "slow" ? "Медленно" : "Обычная скорость"}
        </Button>
      </div>
      {problem ? (
        <p className={problem.failure ? ui.error : ui.note} role={problem.failure ? "alert" : "status"}>
          {problem.text}
        </p>
      ) : null}
    </>
  );
}

export function ReadingScreen() {
  const { moduleId = "", readingId = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const page = useLiveQuery(async () => (await readingPage(readingId)) ?? null, [readingId]);
  const [line, setLine] = useState(-1);
  useEffect(() => setLine(-1), [readingId]);
  const profile = useLessonProfile(page?.after.id);
  const entry = location.state as ReadingEntry | null;
  const listNext = useLiveQuery(async () => {
    if (!entry?.fromReadings) return null;
    const module = await db.modules.get(moduleId);
    return module ? ((await nextUnreadReading(module.courseId, readingId)) ?? null) : null;
  }, [entry?.fromReadings, moduleId, readingId]);
  const toModule = () => {
    // Открыт с полки модуля или из списка — возвращаемся туда же, иначе она окажется в истории дважды.
    if (entry?.fromModule || entry?.fromReadings) void navigate(-1);
    else void navigate(`/course/${moduleId}`, { replace: true });
  };
  const exits = readingExits(entry, page?.next, listNext ?? undefined);
  if (page === undefined) return <Screen back="" />;
  if (page === null)
    return (
      <Screen back="" paper>
        <p className={ui.note}>Текста нет на устройстве: откройте модуль, его уроки и тексты скачаются.</p>
        <div className={base.actions}>
          <Button variant="soft" onClick={toModule}>
            {exits.label}
          </Button>
        </div>
      </Screen>
    );
  const { reading, open, readAt } = page;
  const next = exits.next;
  const openNext = () => {
    if (!next) return;
    void navigate(`/course/${next.moduleId}/read/${next.reading.id}`, { replace: true, state: location.state });
  };
  return (
    <ProfileContext value={profile}>
      <Screen back="" paper>
        {/* Свой ключ у каждого текста: звук, подсказка и ошибка прошлого текста не переезжают на следующий. */}
        <article key={reading.id} className={base.page} aria-labelledby="reading-title">
          <h1 id="reading-title" className={`${base.title} ${base.greek}`} lang={profile.code}>
            {reading.title}
          </h1>
          <p className={base.date}>
            {withCount(reading.words, WORDS)}
            {reading.review === "native" ? "" : " · Сгенерированный текст, носитель не вычитывал"}
          </p>
          {open ? (
            <>
              <TapHint />
              <Aloud key={reading.id} reading={reading} onLine={setLine} />
              <WordTaps marks={page.marks} cards={page.cards} page={0}>
                <Text reading={reading} line={line} />
              </WordTaps>
              {readAt ? (
                <>
                  <p className={base.print} data-testid="reading-done">
                    <span aria-hidden="true">
                      <Tick className={base.mark} />
                    </span>{" "}
                    Прочитано {eventDay(readAt)}
                  </p>
                  <div className={base.actions}>
                    {next ? <Button onClick={openNext}>Следующий текст</Button> : null}
                    <Button variant="soft" onClick={toModule}>
                      {exits.label}
                    </Button>
                    <Button variant="quiet" onClick={() => void markRead(reading.id, false)}>
                      Снять отметку
                    </Button>
                  </div>
                </>
              ) : (
                <div className={base.actions}>
                  <Button onClick={() => void markRead(reading.id, true)}>Прочитано</Button>
                </div>
              )}
            </>
          ) : (
            <p className={ui.note}>Текст откроется, когда будет пройден урок «{page.after.title}».</p>
          )}
        </article>
      </Screen>
    </ProfileContext>
  );
}
