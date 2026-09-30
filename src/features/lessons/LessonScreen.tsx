import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, CloudDownload, CloudOff, Inbox, RefreshCw } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Skeleton } from "@/components/ui/skeleton";
import { Screen } from "../../app/Screen";
import { downloadLessonMedia, installLesson, type InstallResult } from "../../content/client";
import { isCheckable } from "../../domain/learning";
import { unitKey } from "../../domain/refs";
import type { CardKind, LearningRef, LessonItem, Phrase, SessionCard } from "../../domain/types";
import { useGreekVoice } from "../../shared/audio";
import { useNow } from "../../shared/clock";
import { CARDS, dayMonth, DAYS, PHRASES, withCount, WORDS } from "../../shared/format";
import { useOfflineStatus } from "../../shared/offline";
import { useCatalog, useInstallPhase, useLesson, usePhraseCount, usePlan, useReadiness } from "../../shared/store";
import { removeFromLesson, updateLesson } from "../../storage/ops";
import { SpeakText } from "../learning/exercises";
import { startSession } from "../learning/session-actions";
import ui from "../../shared/ui.module.css";

export function reportInstall(result: InstallResult) {
  if (result.status === "current") return;
  const summary =
    result.status === "installed"
      ? `Урок загружен: ${withCount(result.added, CARDS)}.`
      : `Урок обновлён: новых ${result.added}, изменено ${result.changed}.`;
  if (!result.conflicts.length) return void toast.success(summary);
  toast.warning(
    `${summary} Ваши правки сохранены для ${withCount(result.conflicts.length, CARDS)}: ${result.conflicts
      .slice(0, 3)
      .map((c) => c.label)
      .join(", ")}${result.conflicts.length > 3 ? "…" : ""}. Новая версия этих полей не применена.`,
    { duration: 12000 },
  );
}

const GROUPS: { kind: CardKind; title: string; forms: [string, string, string] }[] = [
  { kind: "word", title: "Слова", forms: WORDS },
  { kind: "phrase", title: "Фразы", forms: PHRASES },
];
/** Состав урока: только слова — «30 слов»; смешанный — «13 карточек: 10 слов · 3 фразы». */
export function compositionLabel(counts: Record<CardKind, number>) {
  const total = counts.word + counts.phrase;
  if (!counts.phrase) return withCount(counts.word, WORDS);
  return `${withCount(total, CARDS)}: ${GROUPS.filter((group) => counts[group.kind])
    .map((group) => withCount(counts[group.kind], group.forms))
    .join(" · ")}`;
}
function PhraseRow({ phrase, checkable, onRemove }: { phrase: Phrase; checkable: boolean; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Item variant="row" data-testid="phrase-row">
      <ItemContent>
        <ItemTitle className="text-base">
          <button
            type="button"
            className="text-left text-foreground"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {phrase.text}
          </button>
        </ItemTitle>
        <ItemDescription>
          {phrase.translation ?? "Перевода в материале нет"}
          {!checkable && (
            <>
              {" "}
              ·{" "}
              <Badge variant="soft" className="h-6 px-2 text-xs" data-testid="unavailable-badge">
                Нет доступного упражнения
              </Badge>
            </>
          )}
        </ItemDescription>
        {open && (
          <div className="mt-2 flex w-full flex-col gap-2 text-sm" data-testid="phrase-details">
            {phrase.usage && <p className="m-0">{phrase.usage}</p>}
            {phrase.note && <p className={`m-0 ${ui.muted}`}>{phrase.note}</p>}
            {!checkable && (
              <p className={`m-0 ${ui.muted}`}>
                Фраза доступна для просмотра: без перевода и озвучки её нельзя проверить объективно. Квоту новых она не
                занимает.
              </p>
            )}
            <p className={`m-0 ${ui.muted}`}>
              Источник: {phrase.provenance.sourceLabel}
              {phrase.provenance.locator ? ` · ${phrase.provenance.locator}` : ""}
            </p>
            <SpeakText text={phrase.text} audioAssetId={phrase.audioAssetId} label="Послушать фразу" />
          </div>
        )}
      </ItemContent>
      <ItemActions>
        <Button size="sm" variant="quiet" onClick={onRemove}>
          Убрать
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={open ? "Свернуть" : "Подробнее"}
          onClick={() => setOpen(!open)}
        >
          {open ? <ChevronDown /> : <ChevronRight />}
        </Button>
      </ItemActions>
    </Item>
  );
}
export function LessonScreen() {
  const { id } = useParams();
  const detail = useLesson(id); // из выборки: урок с датой по расписанию, связанные живые карточки и их состояния
  const catalog = useCatalog();
  const phase = useInstallPhase(id);
  const readiness = useReadiness(id);
  const shell = useOfflineStatus();
  const now = useNow();
  const navigate = useNavigate();
  const plan = usePlan(now);
  const hasVoice = useGreekVoice();
  const phrasePool = usePhraseCount() ?? 0;
  const [date, setDate] = useState("");
  const [saved, setSaved] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [mediaProblem, setMediaProblem] = useState("");
  const [practiceProblem, setPracticeProblem] = useState("");
  const entry = catalog?.entries.find((item) => item.id === id);
  const lesson = detail?.lesson;
  useEffect(() => {
    if (lesson) setDate(lesson.targetDate ?? "");
  }, [lesson?.id, lesson?.targetDate]);

  const install = () => {
    if (id)
      installLesson(id)
        .then(reportInstall)
        .catch(() => undefined);
  };
  // Открытие неустановленного урока из каталога загружает его пакет; без сети покажется ошибка с повтором.
  const notInstalled = detail === null;
  useEffect(() => {
    if (notInstalled && entry && phase.phase === "idle") install();
  }, [notInstalled, entry?.id, phase.phase]);

  if (detail === undefined || (detail === null && catalog === undefined))
    return (
      <Screen back="Урок">
        <div className="flex flex-col gap-3 py-2">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      </Screen>
    );
  if (detail === null) {
    if (!entry)
      return (
        <Screen back="Урок">
          <p className={ui.muted}>Урок не найден.</p>
        </Screen>
      );
    return (
      <Screen back={entry.title}>
        <Card className="mb-3 bg-soft ring-0">
          <CardHeader>
            <CardDescription className="flex items-center gap-2 text-accent-foreground">
              {phase.phase === "error" ? <CloudOff /> : <CloudDownload />}
              {phase.phase === "loading"
                ? "Загружаем карточки урока…"
                : phase.phase === "error"
                  ? "Пакет не загружен"
                  : "Урок не загружен на устройство"}
            </CardDescription>
            <CardTitle className="text-xl font-semibold">
              {compositionLabel({ word: entry.wordCount, phrase: entry.phraseCount })}
            </CardTitle>
            <CardDescription>
              {phase.phase === "error"
                ? phase.message
                : "Карточки и связи сохранятся локально после проверки пакета. Картинки подгружаются при просмотре."}
            </CardDescription>
          </CardHeader>
          {phase.phase === "error" && (
            <CardContent>
              <Button size="md" variant="soft" onClick={install}>
                <RefreshCw data-icon="inline-start" />
                Повторить загрузку
              </Button>
            </CardContent>
          )}
        </Card>
        {phase.phase === "loading" && (
          <div className="flex flex-col gap-3" aria-busy="true" role="status" aria-label="Загрузка урока">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        )}
      </Screen>
    );
  }
  const { items, cards, words, phrases, states } = detail;
  const counts: Record<CardKind, number> = { word: words.length, phrase: phrases.length };
  const total = items.length;
  const deadline = plan?.deadlines.find((item) => item.lessonId === lesson!.id);
  const checkable = (phrase: Phrase) =>
    isCheckable(
      { kind: "phrase", hasTranslation: !!phrase.translation, hasAudio: !!phrase.audioAssetId },
      { hasVoice, phrasePool },
    );
  const unavailable = phrases.filter((phrase) => !checkable(phrase)).length;
  const notStarted = items.filter((item) => !states.has(item.unitKey)).length;
  const offlineReady = !!readiness?.installed && readiness.missing.length === 0 && shell.ready;

  const applyDate = async () => {
    await updateLesson(lesson!.id, { targetDate: date || null });
    setSaved(true);
  };
  // Отметка закрепляет текущую дату как свою, чтобы урок остался якорем для следующих.
  const toggle = async () => {
    await updateLesson(
      lesson!.id,
      lesson!.status === "completed" ? { status: "upcoming" } : { status: "completed", targetDate: lesson!.targetDate },
    );
  };
  /** Ручная тренировка урока либо группы в авторском порядке связей; группа без доступных заданий сообщает об этом. */
  const practice = async (kind?: CardKind) => {
    setPracticeProblem("");
    const refs: LearningRef[] = items.filter((item) => !kind || item.ref.kind === kind).map((item) => item.ref);
    const created = refs.length ? await startSession(now, { refs, mode: "practice" }) : null;
    if (!created)
      return setPracticeProblem(
        kind
          ? `В группе «${GROUPS.find((group) => group.kind === kind)!.title}» нет доступных заданий.`
          : "В уроке нет доступных заданий.",
      );
    void navigate("/session");
  };
  const download = async () => {
    setDownloading(true);
    setMediaProblem("");
    try {
      const result = await downloadLessonMedia(lesson!.id);
      if (result.failed.length)
        setMediaProblem(
          `Не удалось загрузить ${withCount(result.failed.length, ["файл", "файла", "файлов"])}. Урок не считается готовым офлайн — повторите позже.`,
        );
    } catch (error) {
      setMediaProblem(error instanceof Error ? error.message : "Не удалось скачать медиа.");
    } finally {
      setDownloading(false);
    }
  };
  const remove = (item: LessonItem) => removeFromLesson(lesson!.id, item.ref);
  const rowsOf = (kind: CardKind) =>
    items
      .filter((item) => item.ref.kind === kind)
      .map((item) => [item, cards.get(item.unitKey)!] as [LessonItem, SessionCard]);
  return (
    <Screen back={lesson!.title}>
      <Card className="mb-3 bg-soft ring-0">
        <CardHeader>
          <CardDescription className="text-accent-foreground">
            {lesson!.targetDate ? `Занятие ${dayMonth(lesson!.targetDate)}` : "Дата не назначена"}
          </CardDescription>
          <CardTitle className="text-xl font-semibold" data-testid="composition">
            {compositionLabel(counts)}, новых {notStarted}
          </CardTitle>
          <CardDescription>
            {deadline
              ? deadline.daysLeft === 0
                ? "Сегодня день занятия — идёт догоняющая подготовка."
                : `${withCount(deadline.daysLeft, DAYS)} на подготовку, нужный темп — ${withCount(deadline.requiredPerDay, CARDS)} в день`
              : lesson!.status === "completed"
                ? "Набор проведён, карточки остаются в обычной очереди повторений."
                : "Дата в прошлом или не задана — карточки идут в общей очереди."}
            {unavailable > 0 &&
              ` ${withCount(unavailable, PHRASES)} без доступного упражнения: не в квоте и не в темпе.`}
          </CardDescription>
        </CardHeader>
      </Card>
      {readiness?.installed && (
        <Card className="mb-3" data-testid="lesson-offline">
          <CardHeader>
            <CardTitle className="text-base">
              {offlineReady
                ? "Готов офлайн"
                : readiness.missing.length
                  ? "Карточки доступны локально"
                  : "Карточки и медиа на устройстве"}
            </CardTitle>
            <CardDescription>
              {readiness.required
                ? `Медиа: ${readiness.present} из ${readiness.required}${readiness.missing.length ? " — остальное подгружается при просмотре карточек." : "."}`
                : "У этого урока нет обязательных медиа: текстовые задания работают без голоса."}
              {!shell.ready && !shell.checking ? " Оболочка приложения ещё не закеширована для работы без сети." : ""}
              {readiness.updateAvailable ? " Доступна новая версия урока." : ""}
            </CardDescription>
          </CardHeader>
          {(readiness.missing.length > 0 || readiness.updateAvailable || phase.phase === "error") && (
            <CardContent className="flex flex-col gap-2">
              {readiness.missing.length > 0 && (
                <Button size="md" variant="soft" disabled={downloading} onClick={download}>
                  <CloudDownload data-icon="inline-start" />
                  {downloading ? "Скачиваем…" : "Скачать для офлайн"}
                </Button>
              )}
              {readiness.updateAvailable && (
                <Button size="md" variant="quiet" disabled={phase.phase === "loading"} onClick={install}>
                  <RefreshCw data-icon="inline-start" />
                  {phase.phase === "loading" ? "Обновляем…" : "Обновить урок"}
                </Button>
              )}
              {phase.phase === "error" && (
                <p className={ui.error} role="alert">
                  {phase.message}
                </p>
              )}
            </CardContent>
          )}
          {mediaProblem && (
            <CardContent>
              <p className={ui.error} role="alert">
                {mediaProblem}
              </p>
            </CardContent>
          )}
        </Card>
      )}
      <Field>
        <FieldLabel htmlFor="date">Дата занятия</FieldLabel>
        <Input
          id="date"
          type="date"
          value={date}
          onChange={(event) => {
            setDate(event.target.value);
            setSaved(false);
          }}
        />
        {lesson!.dateSource === "schedule" && (
          <FieldDescription>Дата по расписанию. Своя дата сдвинет следующие уроки.</FieldDescription>
        )}
        {lesson!.dateSource === "manual" && lesson!.status !== "completed" && (
          <Button
            size="sm"
            variant="quiet"
            className="w-auto justify-self-start"
            onClick={() => {
              void updateLesson(lesson!.id, { targetDate: null });
              setSaved(false);
            }}
          >
            Вернуть в расписание
          </Button>
        )}
      </Field>
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        <Button size="md" onClick={applyDate}>
          Сохранить дату
        </Button>
        <Button size="md" variant="quiet" className="whitespace-normal leading-tight" onClick={toggle}>
          {lesson!.status === "completed" ? "Вернуть в предстоящие" : "Отметить проведённым"}
        </Button>
      </div>
      {saved && (
        <p className="mt-2 text-sm text-(--ok)" role="status">
          Дата сохранена, план пересчитан. История ответов не изменилась.
        </p>
      )}
      {total > 0 && (
        <Button size="xl" variant="soft" className="mt-3" onClick={() => practice()}>
          Потренировать набор
        </Button>
      )}
      {practiceProblem && (
        <p className={ui.error} role="alert">
          {practiceProblem}
        </p>
      )}
      {GROUPS.filter((group) => counts[group.kind] > 0).map((group) => (
        <section key={group.kind} data-testid={`group-${group.kind}`}>
          <div className="mt-4 mb-2 flex items-center justify-between gap-2">
            <h2 className="m-0">
              {group.title} · {counts[group.kind]}
            </h2>
            {counts.phrase > 0 && (
              <Button size="sm" variant="quiet" className="w-auto" onClick={() => practice(group.kind)}>
                Потренировать группу
              </Button>
            )}
          </div>
          <ItemGroup className="gap-2.5">
            {rowsOf(group.kind).map(([item, card]) =>
              card.kind === "word" ? (
                <Item key={item.unitKey} variant="row" className="relative isolate">
                  <ItemContent>
                    <ItemTitle className="text-base">
                      <Link
                        to={`/words/${card.word.id}`}
                        className="text-foreground no-underline after:absolute after:inset-0"
                      >
                        {card.word.greek}
                      </Link>
                    </ItemTitle>
                    <ItemDescription>{card.word.russian}</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <Button size="sm" variant="quiet" className="relative z-10" onClick={() => remove(item)}>
                      Убрать
                    </Button>
                    <ChevronRight className="text-muted-foreground" />
                  </ItemActions>
                </Item>
              ) : (
                <PhraseRow
                  key={item.unitKey}
                  phrase={card.phrase}
                  checkable={checkable(card.phrase)}
                  onRemove={() => remove(item)}
                />
              ),
            )}
          </ItemGroup>
        </section>
      ))}
      {!total && (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Inbox />
            </EmptyMedia>
            <EmptyTitle>В наборе пока нет карточек</EmptyTitle>
            <EmptyDescription>Импортируйте список из Quizlet или добавьте слова вручную.</EmptyDescription>
          </EmptyHeader>
          <Button size="md" variant="soft" className="w-auto" render={<Link to="/more/import" />}>
            Импортировать слова
          </Button>
        </Empty>
      )}
    </Screen>
  );
}
export const keyOf = (ref: LearningRef) => unitKey(ref);
