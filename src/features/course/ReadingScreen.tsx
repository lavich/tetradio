import { useLiveQuery } from "dexie-react-hooks";
import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Screen } from "../../app/Screen";
import { glossSpans } from "../../content/course";
import type { PackageReading } from "../../content/schema";
import { sentencesOf } from "../../domain/sentences";
import { playDialogue, stopDialogue, type Rate } from "../../shared/dialogue";
import { readDay, WORDS, withCount } from "../../shared/format";
import { noVoice, ProfileContext, useLessonProfile, useProfile } from "../../shared/language";
import { Tick } from "../../shared/Tick";
import { markRead, readingPage } from "../../storage/readings";
import { Marked, TapHint, useFieldMarks, WordTaps } from "./WordTaps";
import ui from "../../shared/ui.module.css";
import base from "./course.module.css";
import blocks from "./blocks/blocks.module.css";

function Text({ reading }: { reading: PackageReading }) {
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
      <Marked text={reading.text} marks={marks} glosses={glosses} />
    </p>
  );
}

/** Весь текст синтезом по предложениям: длинное высказывание синтез может оборвать без ошибки. */
function Aloud({ text }: { text: string }) {
  const profile = useProfile();
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState<Rate>("normal");
  const [problem, setProblem] = useState<{ text: string; failure: boolean } | null>(null);
  // Отмена приходит с задержкой: итог прошлого запуска не должен остановить новый.
  const run = useRef(0);
  useEffect(() => () => stopDialogue(), []);
  const play = async () => {
    if (playing) {
      run.current++;
      stopDialogue();
      setPlaying(false);
      return;
    }
    const mine = ++run.current;
    setProblem(null);
    setPlaying(true);
    const result = await playDialogue(
      sentencesOf(text).map((sentence) => ({ text: sentence })),
      rate,
      undefined,
      undefined,
      profile,
    );
    if (mine !== run.current) return;
    setPlaying(false);
    if (result === "none") setProblem({ text: noVoice(profile), failure: false });
    if (result === "error") setProblem({ text: "Воспроизведение прервалось. Попробуйте ещё раз.", failure: true });
  };
  return (
    <>
      <div className={blocks.player}>
        <button
          type="button"
          className={blocks.play}
          onClick={() => void play()}
          aria-label={playing ? "Остановить" : "Слушать"}
        >
          {playing ? <Pause size={20} aria-hidden /> : <Play size={20} aria-hidden />}
        </button>
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
  const profile = useLessonProfile(page?.after.id);
  const fromModule = !!(location.state as { fromModule?: boolean } | null)?.fromModule;
  const toModule = () => {
    // Открыт с полки модуля — возвращаемся на неё же, иначе модуль окажется в истории дважды.
    if (fromModule) void navigate(-1);
    else void navigate(`/course/${moduleId}`, { replace: true });
  };
  if (page === undefined) return <Screen back="" />;
  if (page === null)
    return (
      <Screen back="" paper>
        <p className={ui.note}>Текста нет на устройстве: откройте модуль, его уроки и тексты скачаются.</p>
        <div className={base.actions}>
          <Button variant="soft" onClick={toModule}>
            К модулю
          </Button>
        </div>
      </Screen>
    );
  const { reading, open, readAt, next } = page;
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
              <Aloud text={reading.text} />
              <WordTaps marks={page.marks} cards={page.cards} page={0}>
                <Text reading={reading} />
              </WordTaps>
              {readAt ? (
                <>
                  <p className={base.print} data-testid="reading-done">
                    <span aria-hidden="true">
                      <Tick className={base.mark} />
                    </span>{" "}
                    Прочитано {readDay(readAt)}
                  </p>
                  <div className={base.actions}>
                    {next?.open ? <Button onClick={openNext}>Следующий текст</Button> : null}
                    <Button variant="soft" onClick={toModule}>
                      К модулю
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
