import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Volume2 } from "lucide-react";
import type { Phrase, SessionCard, SessionItem, Word } from "../../domain/types";
import { checkAnswer } from "../../domain/text-answer";
import { checkTextAnswer } from "../../domain/text-answer";
import { diffChars } from "../../domain/spelling";
import {
  assemblyOptions,
  assemblySkipMessage,
  checkAssembly,
  formatSyllables,
  maskWriting,
  type MaskSymbol,
  type WritingMask,
} from "../../domain/syllables";
import { playText, playWord, useAudioKind, useTextAudioKind } from "../../shared/audio";
import { ExampleBox, QUIET_SPEAK, ReadingNotes, SpeakButton, WordArt } from "../words/WordCardView";
import { Tick } from "../../shared/Tick";
import ui from "../../shared/ui.module.css";
import wordCss from "../../shared/word.module.css";
import s from "./session.module.css";
import { cx } from "../../shared/cx";
import { shortTitle, withCount } from "../../shared/format";
import { CloudAction, Instruction } from "./notebook";

export interface Answer {
  correct: boolean;
  text: string;
  status?: "correct" | "almost" | "wrong";
}
/** onAnswer возвращает false, если запись не удалась: тогда упражнение остаётся открытым для повтора. `onSkip` — пропуск без оценки. */
interface Props {
  item: SessionItem;
  onAnswer: (answer: Answer) => Promise<boolean>;
  onNext: () => void;
  onSkip?: () => void;
  /** Подпись кнопки после ответа: в занятии — «Далее», в упражнении по выбору — «Ещё раз». */
  nextLabel?: string;
}
type Status = "correct" | "almost" | "wrong";

/** Раскрытый ответ подводим к верху области прокрутки: иначе он остаётся под облачком. */
function useRevealed(active: boolean, block: ScrollLogicalPosition = "start") {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active) return;
    const smooth = typeof matchMedia === "function" && !matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => ref.current?.scrollIntoView({ block, behavior: smooth ? "smooth" : "auto" }));
  }, [active]);
  return ref;
}

export const lessonLabel = (item: Pick<SessionItem, "lessonTitle">) =>
  item.lessonTitle ? `Хвост урока ${shortTitle(item.lessonTitle)}` : null;
/** Слово карточки; для других видов упражнения слов не создаются. */
const wordOf = (card: SessionCard): Word => {
  if (card.kind !== "word") throw new Error("Упражнение для слова получило другую карточку");
  return card.word;
};

/**
 * Один автозапуск озвучки при открытии карточки. Карточки перемонтируются по `key`, поэтому
 * ссылка-флаг защищает от повторного запуска при перерисовке той же карточки.
 */
function useAutoSpeak(card: SessionCard, enabled: boolean) {
  const played = useRef(false);
  useEffect(() => {
    if (!enabled || played.current) return;
    played.current = true;
    if (card.kind === "word") void playWord(card.word);
    else void playText(card.phrase.text, card.phrase.audioAssetId);
  }, [card, enabled]);
}

/**
 * Один автозапуск озвучки раскрытия: до ответа в письме звук запрещён, поэтому запуск привязан не к открытию
 * карточки, а к появлению результата. `itemId` и `card` намеренно не в зависимостях — ответ сбрасывается
 * эффектом по `item.id`, и в первом кадре с новой карточкой `answered` ещё истинно: зависимость от карточки
 * озвучила бы новое слово до того, как его написали.
 */
function useRevealSpeech(card: SessionCard, itemId: string, answered: boolean, enabled: boolean) {
  const spoken = useRef<string | null>(null);
  useEffect(() => {
    if (!answered || !enabled || spoken.current === itemId) return;
    spoken.current = itemId;
    if (card.kind === "word") void playWord(card.word);
    else if (card.kind === "phrase") void playText(card.phrase.text, card.phrase.audioAssetId);
  }, [answered, enabled]);
}

/** Кнопка озвучки текста фразы или полного предложения; при отсутствии файла и голоса — подпись. */
export function SpeakText({
  text,
  audioAssetId,
  label,
  quiet,
}: {
  text: string;
  audioAssetId?: string;
  label: string;
  quiet?: boolean;
}) {
  const kind = useTextAudioKind(audioAssetId);
  const [failed, setFailed] = useState<"none" | "error" | null>(null);
  return (
    <div className={wordCss.speakBox}>
      <Button
        size="icon-xl"
        variant={quiet ? "outline" : "default"}
        className={quiet ? QUIET_SPEAK : "size-14 rounded-full [&_svg:not([class*='size-'])]:size-6.5"}
        disabled={kind === "none"}
        aria-label={kind === "none" ? "Озвучка недоступна" : label}
        onClick={() =>
          playText(text, audioAssetId).then((result) =>
            setFailed(result === "none" || result === "error" ? result : null),
          )
        }
      >
        <Volume2 aria-hidden />
      </Button>
      {(kind === "none" || failed === "none") && (
        <span className={ui.note}>Озвучка недоступна: нет файла и греческого голоса</span>
      )}
      {failed === "error" && (
        <span className={ui.note} role="status">
          Не удалось воспроизвести. Нажмите ещё раз.
        </span>
      )}
    </div>
  );
}

/** Основное действие листа — в облачке занятия; `disabled` держит место, пока ответа нет. */
function Primary({
  children,
  disabled,
  onClick,
  form,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  form?: string;
}) {
  return (
    <CloudAction>
      <Button
        size="md"
        className={s.primary}
        type={form ? "submit" : "button"}
        form={form}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </Button>
    </CloudAction>
  );
}

/** Тихие действия под заданием: «Не знаю» и отказ от аудио — текстом, без кнопок-плашек. */
function QuietActions({ children }: { children: React.ReactNode }) {
  return <div className={s.quietActions}>{children}</div>;
}
function QuietButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" className={s.quietButton} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

/** Строка греческого с озвучкой справа: слово крупно с IPA или фраза. */
function GreekHead({
  text,
  ipa,
  phrase,
  speak,
}: {
  text: string;
  ipa?: string;
  phrase?: boolean;
  speak?: React.ReactNode;
}) {
  return (
    <div className={s.greekRow}>
      <div className="min-w-0">
        <p className={phrase ? s.phrase : s.word} lang="el" data-testid={phrase ? "phrase-text" : undefined}>
          {text}
        </p>
        {ipa && <p className={s.ipa}>{ipa}</p>}
      </div>
      {speak}
    </div>
  );
}

/**
 * Карточка слова на листе: написание с IPA и озвучкой, перевод, картинка, заметки о чтении и пример.
 * `speak` добавляет кнопку озвучки: в раскрытии после аудирования она лишняя — повтор уже есть в задании.
 */
function WordReveal({ word, speak, large }: { word: Word; speak?: boolean; large?: boolean }) {
  return (
    <>
      <div className={s.greekRow}>
        <p className={large ? s.word : s.wordSmall} lang="el">
          {word.greek}
        </p>
        {speak && <SpeakButton word={word} quiet />}
      </div>
      <div className={s.cardRow}>
        <div className="min-w-0 flex-1">
          {word.ipa && <p className={s.ipa}>{word.ipa}</p>}
          <p className={s.meaning}>{word.russian}</p>
        </div>
        <WordArt word={word} className={s.pic} />
      </div>
      <ReadingNotes word={word} bare />
      {word.examples[0] && <ExampleBox example={word.examples[0]} bare />}
    </>
  );
}
/**
 * Карточка фразы: текст целиком, перевод, ситуация употребления и примечание.
 * `speak` добавляет кнопку озвучки — в знакомстве она нужна, в раскрытии после ответа
 * дублировала бы кнопку повтора аудио самого задания.
 */
function PhraseReveal({ phrase, speak }: { phrase: Phrase; speak?: boolean }) {
  return (
    <>
      <GreekHead
        text={phrase.text}
        phrase
        speak={
          speak && <SpeakText text={phrase.text} audioAssetId={phrase.audioAssetId} label="Послушать фразу" quiet />
        }
      />
      {phrase.translation ? (
        <p className={s.meaning}>{phrase.translation}</p>
      ) : (
        <p className={cx(ui.note, s.note)}>Перевода в материале нет</p>
      )}
      {phrase.usage && <p className={s.hint}>{phrase.usage}</p>}
      {phrase.note && <p className={s.hint}>{phrase.note}</p>}
    </>
  );
}
/** Раскрытие после ответа отделено от задания линейкой: это уже справка, а не вопрос. */
function Reveal({ children }: { children: React.ReactNode }) {
  return (
    <div data-testid="reveal" className={s.reveal}>
      {children}
    </div>
  );
}

export function Introduction({
  item,
  onReady,
  saving = false,
  autoSpeak = false,
}: {
  item: Pick<SessionItem, "card" | "lessonTitle">;
  onReady: () => void;
  saving?: boolean;
  autoSpeak?: boolean;
}) {
  const { card } = item;
  const label = lessonLabel(item);
  // Знакомство показывает материал, а не проверяет знание: отказ озвучки здесь не показывается — кнопка сама объясняет недоступность.
  useAutoSpeak(card, autoSpeak);
  return (
    <>
      <Instruction prompt={card.kind === "word" ? "Новое слово" : "Новая фраза"}>
        {label && (
          <>
            {" · "}
            <span data-testid="lesson-label">{label}</span>
          </>
        )}
      </Instruction>
      {card.kind === "word" && <WordReveal word={card.word} speak large />}
      {card.kind === "phrase" && <PhraseReveal phrase={card.phrase} speak />}
      <Primary disabled={saving} onClick={onReady}>
        {saving ? "Сохраняем…" : "Далее"}
      </Primary>
    </>
  );
}

/** Короткие варианты — сеткой 2 × 2, иначе строками α) β) γ) δ). Порог — то, что помещается в половину узкого листа. */
const SHORT_OPTION = 12;
const LETTERS = ["α", "β", "γ", "δ", "ε", "ζ"];
export const optionsFit = (options: string[]) =>
  options.length <= 4 && options.every((option) => [...option].length <= SHORT_OPTION);

function Choice({
  item,
  onAnswer,
  onNext,
  onSkip,
  nextLabel = "Далее",
  prompt,
  head,
  aside,
  options,
  greekOptions,
  correct,
  after,
  audio,
}: Props & {
  prompt: string;
  head?: React.ReactNode;
  aside?: React.ReactNode;
  options: string[];
  greekOptions?: boolean;
  correct: string;
  after?: React.ReactNode;
  /** Аудиоупражнение: кроме «Не знаю» можно честно отложить задание без оценки. */
  audio?: boolean;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const answered = picked !== null;
  const choose = async (option: string | null) => {
    if (answered || saving) return;
    setSaving(true);
    const saved = await onAnswer({ correct: option === correct, text: option ?? "" });
    setSaving(false);
    if (saved) setPicked(option ?? "");
  };
  useEffect(() => {
    setPicked(null);
    setSaving(false);
  }, [item.id]);
  // Выбор раскрывается строкой под вариантами: подводим её, не уводя варианты из вида.
  const revealed = useRevealed(answered, "nearest");
  const grid = optionsFit(options);
  const letter = (index: number) => LETTERS[index] ?? String(index + 1);
  const right = options.indexOf(correct);
  return (
    <>
      <div className={s.cardRow}>
        <div className="min-w-0 flex-1">
          <Instruction prompt={prompt} />
          {head}
        </div>
        {aside}
      </div>
      <div className={grid ? s.grid : s.lines} lang={greekOptions ? "el" : undefined}>
        {options.map((option) => {
          const mark = answered
            ? option === correct
              ? "correct"
              : option === picked
                ? "wrong"
                : undefined
            : undefined;
          return (
            <button
              key={option}
              type="button"
              data-testid="option"
              data-answer={mark}
              disabled={answered || saving}
              className={cx(grid ? s.chip : s.line, mark && s[mark])}
              onClick={() => choose(option)}
            >
              <span>{option}</span>
              {mark === "correct" && (
                <>
                  <Tick className={s.optionTick} label="верно" />
                  <span className="sr-only">Правильный ответ</span>
                </>
              )}
              {mark === "wrong" && <span className="sr-only">Неправильный ответ</span>}
            </button>
          );
        })}
      </div>
      {answered && (
        <p className={picked === correct ? s.okLine : s.fixLine} role="status" ref={revealed}>
          {picked === correct ? (
            "Верно."
          ) : (
            <>
              Верно:{" "}
              <span lang={greekOptions ? "el" : undefined}>
                {grid || right < 0 ? "" : `${letter(right)}) `}
                {correct}
              </span>
            </>
          )}
        </p>
      )}
      {!answered && (
        <QuietActions>
          <QuietButton disabled={saving} onClick={() => choose(null)}>
            Не знаю
          </QuietButton>
          {audio && onSkip && (
            <QuietButton disabled={saving} onClick={onSkip}>
              Не могу послушать сейчас
            </QuietButton>
          )}
        </QuietActions>
      )}
      {answered && after}
      <Primary disabled={!answered} onClick={onNext}>
        {nextLabel}
      </Primary>
    </>
  );
}

export function Recognition(props: Props & { autoSpeak?: boolean }) {
  const { card } = props.item;
  // Узнавание проверяет значение, а звучит показанное написание: подсказки нет, поэтому карточка озвучивается сама.
  useAutoSpeak(card, !!props.autoSpeak);
  if (card.kind === "phrase") {
    const phrase = card.phrase;
    return (
      <Choice
        {...props}
        prompt="Что значит эта фраза?"
        correct={phrase.translation ?? ""}
        options={props.item.options}
        head={
          <p className={s.phrase} lang="el">
            {phrase.text}
          </p>
        }
        aside={<SpeakText text={phrase.text} audioAssetId={phrase.audioAssetId} label="Послушать фразу" quiet />}
        after={phrase.usage ? <p className={s.hint}>{phrase.usage}</p> : undefined}
      />
    );
  }
  const word = wordOf(card);
  return (
    <Choice
      {...props}
      prompt="Что значит это слово?"
      correct={word.russian}
      options={props.item.options}
      head={<GreekHead text={word.greek} ipa={word.ipa} speak={<SpeakButton word={word} quiet />} />}
      after={word.examples[0] && <ExampleBox example={word.examples[0]} bare />}
    />
  );
}

interface Replay {
  text: string;
  kind: ReturnType<typeof useAudioKind>;
  failed: boolean;
  play: () => void;
}
/**
 * Звуковая часть аудирования и понимания на слух: что звучит, доступно ли это и не отказало ли воспроизведение.
 * Пропуск сюда не приходит: `listening` и `comprehension` создаются только для слов и фраз (`domain/learning.ts`).
 */
function useReplay(card: SessionCard, itemId: string, autoSpeak: boolean | undefined): Replay {
  const word = card.kind === "word" ? card.word : null;
  const phrase = card.kind === "phrase" ? card.phrase : null;
  const audioAssetId = word ? word.audioAssetId : phrase?.audioAssetId;
  const wordKind = useAudioKind(word ?? undefined);
  const textKind = useTextAudioKind(audioAssetId);
  const played = useRef(false);
  const [failed, setFailed] = useState(false);
  const text = word ? word.greek : (phrase?.text ?? "");
  const play = () =>
    (word ? playWord(word) : playText(text, audioAssetId)).then((result) =>
      setFailed(result === "error" || result === "none"),
    );
  useEffect(() => {
    if (autoSpeak && !played.current) {
      played.current = true;
      void play();
    }
  }, [itemId, autoSpeak]);
  if (!word && !phrase) throw new Error("Аудиоупражнение получило карточку с пропуском");
  return { text, kind: word ? wordKind : textKind, failed, play };
}
/** Большая кнопка повтора над вариантами и сообщение об отказе воспроизведения — одинаковые в обоих аудиоупражнениях. */
function ReplayHead({ replay, onSkip }: { replay: Replay; onSkip?: () => void }) {
  return (
    <>
      <div className={s.play}>
        <Button
          size="icon-xl"
          className="size-14 rounded-full [&_svg:not([class*='size-'])]:size-6.5"
          disabled={replay.kind === "none"}
          aria-label="Повторить аудио"
          onClick={replay.play}
        >
          <Volume2 aria-hidden />
        </Button>
        <span className={s.playNote}>{replay.kind === "none" ? "Озвучка недоступна" : "Послушать ещё раз"}</span>
      </div>
      {replay.failed && (
        <div data-testid="audio-failed" role="alert" className={s.audioFailed}>
          <p>Аудио не воспроизвелось. Это не влияет на прогресс: попробуйте ещё раз или продолжите без аудирования.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={replay.play}>
              Повторить
            </Button>
            {onSkip && (
              <Button size="sm" variant="outline" onClick={onSkip}>
                Продолжить без аудио
              </Button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Аудирование. Отказ воспроизведения не засчитывается как ошибка знания: можно повторить или продолжить без аудио —
 * упражнение пропускается без события и без сдвига интервалов. Варианты для фразы — фразы, для слова — слова.
 * После ответа раскрывается карточка со значением: выбрать написание на слух можно и не зная смысла,
 * поэтому верный ответ показывает её наравне с ошибкой и с «Не знаю». Показ ничего не сохраняет.
 */
export function Listening(props: Props & { autoSpeak?: boolean }) {
  const { card } = props.item;
  const replay = useReplay(card, props.item.id, props.autoSpeak);
  return (
    <Choice
      {...props}
      audio
      prompt="Что прозвучало?"
      correct={replay.text}
      options={props.item.options}
      greekOptions
      head={<ReplayHead replay={replay} onSkip={props.onSkip} />}
      after={
        <Reveal>
          {card.kind === "phrase" ? <PhraseReveal phrase={card.phrase} /> : <WordReveal word={wordOf(card)} />}
        </Reveal>
      }
    />
  );
}

/**
 * Понимание на слух: звучит слово или фраза, варианты ответа — переводы. До ответа письменной опоры нет,
 * иначе проверялось бы чтение. После ответа раскрывается та же карточка со значением, что и в аудировании:
 * из ошибки должно быть что извлечь. Отказ воспроизведения тоже ведёт себя как в аудировании.
 */
export function Comprehension(props: Props & { autoSpeak?: boolean }) {
  const { card } = props.item;
  const replay = useReplay(card, props.item.id, props.autoSpeak);
  const correct =
    card.kind === "word" ? card.word.russian : card.kind === "phrase" ? (card.phrase.translation ?? "") : "";
  return (
    <Choice
      {...props}
      audio
      prompt="Что это значит?"
      correct={correct}
      options={props.item.options}
      head={<ReplayHead replay={replay} onSkip={props.onSkip} />}
      after={
        <Reveal>
          {card.kind === "word" ? (
            <WordReveal word={card.word} />
          ) : card.kind === "phrase" ? (
            <PhraseReveal phrase={card.phrase} />
          ) : null}
        </Reveal>
      }
    />
  );
}

/** Итог письменного ответа красной ручкой или галочкой: сообщение проверки, цвет — по исходу. */
function Verdict({ status, children }: { status: Status; children: React.ReactNode }) {
  return (
    <div
      data-testid="feedback"
      role="status"
      className={cx(
        s.verdict,
        status === "correct" ? s.verdictOk : status === "almost" ? s.verdictAlmost : s.verdictBad,
      )}
    >
      {children}
    </div>
  );
}
/** Задание письма и сборки: перевод крупно печатью, картинка справа. */
function TaskHead({ prompt, meaning, art }: { prompt: string; meaning: string; art?: React.ReactNode }) {
  return (
    <div className={s.cardRow}>
      <div className="min-w-0 flex-1">
        <Instruction prompt={prompt} />
        <p className={s.task}>{meaning}</p>
      </div>
      {art}
    </div>
  );
}

/**
 * Ступень перед свободным написанием: слово собирается из перемешанных слогов в строку листа. Только для слов.
 * После проверки собранное остаётся на строке, а деление на слоги — в итоге: в карточке его нет, а собирали именно его.
 */
export function Assembly({
  item,
  onAnswer,
  onNext,
  nextLabel = "Далее",
  autoSpeak = false,
}: Props & { autoSpeak?: boolean }) {
  const [placed, setPlaced] = useState<number[]>([]);
  const [result, setResult] = useState<{
    status: Status;
    message: string;
    answer?: string;
    skipped?: boolean;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setPlaced([]);
    setResult(null);
    setSaving(false);
  }, [item.id]);
  const revealed = useRevealed(!!result);
  const word = wordOf(item.card);
  useRevealSpeech(item.card, item.id, !!result, autoSpeak);
  const pool = assemblyOptions(word.greek, item.options);
  const complete = placed.length === pool.length;

  const check = async (skip = false) => {
    if ((!complete && !skip) || result || saving) return;
    const checked = checkAssembly(
      word.greek,
      placed.map((index) => pool[index]),
    );
    setSaving(true);
    const saved = await onAnswer(
      skip
        ? { correct: false, text: "" }
        : { correct: checked.status === "correct", text: checked.answer, status: checked.status },
    );
    setSaving(false);
    if (saved) setResult(skip ? { status: "wrong", message: assemblySkipMessage(word.greek), skipped: true } : checked);
  };
  return (
    <>
      {!result && (
        <>
          <TaskHead prompt="Собери слово" meaning={word.russian} art={<WordArt word={word} className={s.pic} />} />
          <div className={s.assembled} aria-label="Собранное слово" data-testid="assembled" lang="el">
            {placed.length === 0 ? (
              <span className={s.slotsHint}>Нажимай слоги по порядку</span>
            ) : (
              placed.map((index, position) => (
                <button
                  key={`${index}-${position}`}
                  type="button"
                  data-testid="placed"
                  disabled={saving}
                  className={s.placed}
                  onClick={() => setPlaced(placed.filter((_, i) => i !== position))}
                >
                  {pool[index]}
                </button>
              ))
            )}
          </div>
          <div className={s.tiles} lang="el">
            {pool.map((tile, index) => (
              <button
                key={`${tile}-${index}`}
                type="button"
                data-testid="tile"
                disabled={placed.includes(index) || saving}
                className={s.tile}
                onClick={() => setPlaced([...placed, index])}
              >
                {tile}
              </button>
            ))}
          </div>
          <QuietActions>
            <QuietButton disabled={saving} onClick={() => check(true)}>
              Не знаю
            </QuietButton>
          </QuietActions>
        </>
      )}
      {result && (
        <div ref={revealed}>
          <Instruction prompt="Собери слово" />
          {!result.skipped && result.answer && (
            <p className={s.written} lang="el">
              <span>{result.answer}</span>
              {result.status !== "wrong" && (
                <Tick
                  className={cx(s.writtenTick, result.status === "almost" && s.almost)}
                  label={result.status === "almost" ? "почти" : "верно"}
                />
              )}
            </p>
          )}
          <Verdict status={result.status}>
            <p>{result.message}</p>
            <p className={s.syllables} lang="el">
              {formatSyllables(word.greek)}
            </p>
          </Verdict>
          <Reveal>
            <WordReveal word={word} speak />
          </Reveal>
        </div>
      )}
      {result ? (
        <Primary onClick={onNext}>{nextLabel}</Primary>
      ) : (
        <Primary disabled={!complete || saving} onClick={() => check()}>
          {saving ? "Сохраняем…" : "Проверить"}
        </Primary>
      )}
    </>
  );
}

/**
 * Подсказка длины ответа внутри поля ввода: ячейка на каждую букву, первая буква каждого слова открыта, знаки
 * показаны как есть, пробел разбивает маску на группы по словам. Набранное занимает ячейки, и маска остаётся
 * на экране до самого ответа: она и есть строка ввода, а собственный текст поля скрыт.
 *
 * Слова набора ложатся в группы по порядку: пробел переводит набор к следующему слову, а буквы сверх длины
 * слова показываются тут же, за его ячейками. Раскладывать набранное подряд, пропуская пробелы, нельзя: тогда
 * «ηγάτα» выглядело бы как «η γάτα», хотя пробела в ответе нет и проверка засчитает пропуск. Маска показывает
 * ровно то, что лежит в поле.
 *
 * Каретка стоит сразу за последней введённой буквой, а в пустом слове — перед его первой ячейкой. Своей
 * площадки у места пробела нет: подчёркивание там читалось бы ещё одной буквой. Сам пробел не подставляется:
 * ответ без артикля — разрешённый ответ со своим исходом «Почти», и подстановка превратила бы его в ошибку.
 *
 * Поле при этом ничего не ограничивает: ответить короче, длиннее и без артикля по-прежнему можно.
 * Диктору маска отдаётся числом слов и букв и открытыми буквами: разрывов между группами он не видит.
 */
function AnswerMask({ mask, value }: { mask: WritingMask | null; value: string }) {
  if (!mask?.letters) return null;
  const { groups, letters } = mask;
  const typed = value.split(/\s/);
  const caret = { word: typed.length - 1, at: (typed.at(-1) ?? "").length };
  const leads = groups
    .flat()
    .filter((symbol) => symbol.kind === "lead")
    .map((symbol) => symbol.char);
  const count = withCount(letters, ["буквы", "букв", "букв"]);
  const words = groups.length > 1 ? `${withCount(groups.length, ["слова", "слов", "слов"])}, ` : "";
  const first = leads.length > 1 ? `, первые буквы ${leads.join(", ")}` : leads.length ? `, первая ${leads[0]}` : "";
  /** Каретка держится за последнюю введённую букву; в пустом слове ей не за что держаться — встаёт перед первой ячейкой. */
  const side = (index: number, offset: number) =>
    index !== caret.word
      ? undefined
      : caret.at === 0 && offset === 0
        ? "before"
        : offset === caret.at - 1
          ? "after"
          : undefined;
  const mark = (where: "before" | "after" | undefined) => ({
    className: cx(where === "before" && s.maskCaretBefore, where === "after" && s.maskCaretAfter),
    "data-testid": where ? "mask-caret" : undefined,
    "data-caret": where,
  });
  /** Слово набора в ячейках своей группы: что не поместилось — следом за ними. */
  const word = (group: MaskSymbol[], text: string, index: number) => {
    const cells = group.map((symbol, offset) => ({ symbol, char: text[offset], offset }));
    const over = Array.from(text.slice(group.length), (char, offset) => ({
      symbol: null,
      char,
      offset: group.length + offset,
    }));
    return [...cells, ...over].map(({ symbol, char, offset }) => {
      const { className, ...rest } = mark(side(index, offset));
      return symbol?.kind === "mark" ? (
        <span key={offset} className={cx(char && s.maskTyped, className)} {...rest}>
          {char ?? symbol.char}
        </span>
      ) : (
        <b
          key={offset}
          {...rest}
          className={cx(s.maskLetter, char && s.maskTyped, !char && symbol?.kind === "lead" && s.maskLead, className)}
        >
          {char ?? (symbol?.kind === "lead" ? symbol.char : undefined)}
        </b>
      );
    });
  };
  return (
    <>
      <div className={s.mask} data-testid="answer-mask" aria-hidden>
        {[...groups, ...typed.slice(groups.length).map(() => [] as MaskSymbol[])].map((group, index) => (
          <span key={index} className={s.maskWord} data-testid="mask-word">
            {word(group, typed[index] ?? "", index)}
          </span>
        ))}
      </div>
      <span className="sr-only">
        Ответ из {words}
        {count}
        {first}
      </span>
    </>
  );
}

/** Ответ на строке листа после проверки: совпавшее чернилами, лишнее зачёркнуто ручкой, нужное — ручкой сверху. */
function Corrected({ value, expected }: { value: string; expected: string }) {
  return (
    <p className={s.written} data-testid="chars" lang="el">
      <span>
        {diffChars(value, expected).map((part, index) =>
          part.type === "same" ? (
            <span key={index}>{part.text}</span>
          ) : part.type === "wrong" ? (
            <span key={index} className={s.fixPair}>
              <s>{part.text}</s>
              {part.fix && <sup>{part.fix}</sup>}
            </span>
          ) : (
            <ins key={index}>{part.text}</ins>
          ),
        )}
      </span>
    </p>
  );
}

/**
 * Написание слова по переводу или фразы целиком по её переводу. У фразы проверка без послаблений артиклю.
 * После ответа задание уходит с листа: перевод и картинка входят в раскрытие, отдельно они задвоились бы.
 */
export function Spelling({
  item,
  onAnswer,
  onNext,
  nextLabel = "Далее",
  autoSpeak = false,
}: Props & { autoSpeak?: boolean }) {
  const [value, setValue] = useState("");
  const [result, setResult] = useState<{
    status: Status;
    message: string;
    skipped?: boolean;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const formId = useId();
  useEffect(() => {
    setValue("");
    setResult(null);
    setSaving(false);
  }, [item.id]);
  const revealed = useRevealed(!!result);
  const { card } = item;
  const expected = card.kind === "phrase" ? card.phrase.text : wordOf(card).greek;
  const mask = maskWriting(expected, { lead: true });
  const prompt = card.kind === "phrase" ? (card.phrase.translation ?? "") : wordOf(card).russian;
  useRevealSpeech(card, item.id, !!result, autoSpeak);
  const skip = async () => {
    if (result || saving) return;
    setSaving(true);
    const saved = await onAnswer({ correct: false, text: "" });
    setSaving(false);
    if (saved) setResult({ status: "wrong", message: "Ничего страшного — вот как это пишется.", skipped: true });
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!value.trim() || result || saving) return;
    const checked = card.kind === "phrase" ? checkTextAnswer(value, [card.phrase.text]) : checkAnswer(value, expected);
    setSaving(true);
    const saved = await onAnswer({ correct: checked.status === "correct", text: value, status: checked.status });
    setSaving(false);
    if (saved) setResult(checked);
  };
  if (result)
    return (
      <>
        <div ref={revealed}>
          <Instruction prompt="Напиши по-гречески" />
          {!result.skipped &&
            (result.status === "correct" ? (
              <p className={s.written} lang="el">
                <span>{value}</span>
                <Tick className={s.writtenTick} label="верно" />
              </p>
            ) : (
              <Corrected value={value} expected={expected} />
            ))}
          <Verdict status={result.status}>
            <p>{result.message}</p>
            {result.status !== "correct" && !result.skipped && (
              <p className={s.legend}>Зачёркнуто — лишнее, сверху ручкой — как надо.</p>
            )}
          </Verdict>
          <Reveal>
            {card.kind === "phrase" ? (
              <PhraseReveal phrase={card.phrase} speak />
            ) : (
              <WordReveal word={wordOf(card)} speak />
            )}
          </Reveal>
        </div>
        <Primary onClick={onNext}>{nextLabel}</Primary>
      </>
    );
  return (
    <form id={formId} onSubmit={submit}>
      <TaskHead
        prompt="Напиши по-гречески"
        meaning={prompt}
        art={card.kind === "word" ? <WordArt word={card.word} className={s.pic} /> : undefined}
      />
      <div className={cx(s.field, card.kind === "phrase" && s.fieldPhrase)}>
        <AnswerMask mask={mask} value={value} />
        <input
          className={cx(s.answer, mask && s.masked)}
          type="text"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={saving}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          aria-label="Твой ответ по-гречески"
          lang="el"
        />
      </div>
      <QuietActions>
        <QuietButton disabled={saving} onClick={skip}>
          Не знаю
        </QuietButton>
      </QuietActions>
      <Primary form={formId} disabled={!value.trim() || saving}>
        {saving ? "Сохраняем…" : "Проверить"}
      </Primary>
    </form>
  );
}
