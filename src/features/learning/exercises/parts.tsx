import { Button } from "@/components/ui/button";
import type { Phrase, Word } from "../../../domain/types";
import { ExampleBox, ReadingNotes, SpeakButton, WordArt } from "../../words/WordCardView";
import ui from "../../../shared/ui.module.css";
import { cx } from "../../../shared/cx";
import { CloudAction, Instruction } from "../notebook";
import session from "../session.module.css";
import s from "./exercise.module.css";
import type { Status } from "./model";
import { SpeakText } from "./SpeakText";

/** Основное действие листа — в облачке занятия; `disabled` держит место, пока ответа нет. */
export function Primary({
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
        className={session.primary}
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
export function QuietActions({ children }: { children: React.ReactNode }) {
  return <div className={s.quietActions}>{children}</div>;
}
export function QuietButton({
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
export function GreekHead({
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
export function WordReveal({ word, speak, large }: { word: Word; speak?: boolean; large?: boolean }) {
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
export function PhraseReveal({ phrase, speak }: { phrase: Phrase; speak?: boolean }) {
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
export function Reveal({ children }: { children: React.ReactNode }) {
  return (
    <div data-testid="reveal" className={s.reveal}>
      {children}
    </div>
  );
}

/** Итог письменного ответа красной ручкой или галочкой: сообщение проверки, цвет — по исходу. */
export function Verdict({ status, children }: { status: Status; children: React.ReactNode }) {
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
export function TaskHead({ prompt, meaning, art }: { prompt: string; meaning: string; art?: React.ReactNode }) {
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
