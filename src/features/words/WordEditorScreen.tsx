import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Screen } from "../../app/Screen";
import type { Example, Word } from "../../domain/types";
import { editExample } from "../../domain/examples";
import { checkMedia } from "../../shared/media";
import { useWord } from "../../shared/store";
import { deleteWord, putAsset, saveWord } from "../../storage/ops";
import ui from "../../shared/ui.module.css";

const emptyExample: Example = { greek: "", russian: "", target: "" };

export function WordEditorScreen() {
  const { id } = useParams();
  const stored = useWord(id);
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Word | null>(null);
  const [problem, setProblem] = useState("");
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (stored && !draft) setDraft(stored);
  }, [stored]);
  if (!draft)
    return (
      <Screen back="Редактор">
        <p className={ui.muted}>Слово не найдено.</p>
      </Screen>
    );

  const patch = (next: Partial<Word>) => {
    setDraft({ ...draft, ...next });
    setSaved(false);
  };
  const patchExample = (index: number, next: Partial<Example>) =>
    patch({ examples: draft.examples.map((example, i) => (i === index ? editExample(example, next) : example)) });

  const upload = async (file: File | undefined, kind: "image" | "audio") => {
    if (!file) return;
    setProblem("");
    const result = await checkMedia(file, kind);
    if (!result.ok) return setProblem(result.message); // старое медиа остаётся на месте
    const assetId = `${kind === "image" ? "img" : "snd"}-${draft.id}-${Date.now().toString(36)}`;
    await putAsset({
      id: assetId,
      kind,
      blob: result.blob,
      mimeType: file.type,
      source: "Загружено пользователем",
      alt: kind === "image" ? `Иллюстрация к слову «${draft.russian}»` : "",
    });
    const next = { ...draft, ...(kind === "image" ? { imageAssetId: assetId } : { audioAssetId: assetId }) };
    setDraft(next);
    await saveWord(next);
    setSaved(true);
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!draft.greek.trim() || !draft.russian.trim()) return setProblem("Нужны греческое слово и перевод.");
    await saveWord({
      ...draft,
      examples: draft.examples.filter((example) => example.greek.trim() && example.russian.trim()),
    });
    setSaved(true);
  };
  return (
    <Screen back="Редактор слова">
      <form onSubmit={submit}>
        <FieldGroup>
          <Field data-invalid={!!problem || undefined}>
            <FieldLabel htmlFor="greek">Греческое слово (с артиклем)</FieldLabel>
            <Input
              id="greek"
              value={draft.greek}
              aria-invalid={!!problem || undefined}
              onChange={(event) => patch({ greek: event.target.value })}
            />
          </Field>
          <Field data-invalid={!!problem || undefined}>
            <FieldLabel htmlFor="russian">Перевод</FieldLabel>
            <Input
              id="russian"
              value={draft.russian}
              aria-invalid={!!problem || undefined}
              onChange={(event) => patch({ russian: event.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="note">Заметка о грамматике</FieldLabel>
            <Input
              id="note"
              value={draft.note ?? ""}
              placeholder="Множественное число: τα χρόνια."
              onChange={(event) => patch({ note: event.target.value || undefined })}
            />
            <FieldDescription>Показывается в разборе под ударением.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="ipa">Транскрипция IPA</FieldLabel>
            <Input
              id="ipa"
              value={draft.ipa}
              placeholder="/to ˈspiti/"
              onChange={(event) => patch({ ipa: event.target.value, verified: false })}
            />
            <FieldDescription>
              {draft.verified
                ? "Фонетика проверена при подготовке исходного набора."
                : "Ваша запись хранится как пользовательская и не считается проверенной."}
            </FieldDescription>
          </Field>
        </FieldGroup>

        <h2>Примеры употребления</h2>
        {draft.examples.map((example, index) => (
          <Card key={index} className="mb-3">
            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor={`ex-g-${index}`}>Предложение по-гречески</FieldLabel>
                  <Input
                    id={`ex-g-${index}`}
                    value={example.greek}
                    onChange={(event) => patchExample(index, { greek: event.target.value })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`ex-r-${index}`}>Перевод</FieldLabel>
                  <Input
                    id={`ex-r-${index}`}
                    value={example.russian}
                    onChange={(event) => patchExample(index, { russian: event.target.value })}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor={`ex-t-${index}`}>Форма слова в предложении</FieldLabel>
                  <Input
                    id={`ex-t-${index}`}
                    value={example.target}
                    onChange={(event) => patchExample(index, { target: event.target.value })}
                  />
                </Field>
              </FieldGroup>
              <Button
                size="md"
                variant="quiet"
                type="button"
                className="mt-2.5"
                onClick={() => patch({ examples: draft.examples.filter((_, i) => i !== index) })}
              >
                Удалить пример
              </Button>
            </CardContent>
          </Card>
        ))}
        <Button
          size="xl"
          variant="soft"
          type="button"
          onClick={() => patch({ examples: [...draft.examples, { ...emptyExample }] })}
        >
          Добавить пример
        </Button>

        <h2>Медиа</h2>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="image">Изображение (PNG, JPEG, WebP, SVG, до 3 МБ)</FieldLabel>
            <Input
              id="image"
              type="file"
              accept="image/*"
              onChange={(event) => upload(event.target.files?.[0], "image")}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="audio">Аудиофайл (MP3, OGG, WAV, M4A, до 5 МБ)</FieldLabel>
            <Input
              id="audio"
              type="file"
              accept="audio/*"
              onChange={(event) => upload(event.target.files?.[0], "audio")}
            />
            <FieldDescription>
              {draft.audioAssetId
                ? "Аудиофайл сохранён в базе."
                : "Файла нет — слово озвучивается системным греческим голосом, если он доступен."}
            </FieldDescription>
          </Field>
        </FieldGroup>

        {problem && (
          <p className={ui.error} role="alert">
            {problem}
          </p>
        )}
        <Button size="xl" type="submit" className="mt-4">
          Сохранить
        </Button>
        {saved && (
          <p className="mt-2 text-sm text-(--ok)" role="status">
            Сохранено.
          </p>
        )}
      </form>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogTrigger
          render={
            <Button size="md" variant="quiet" className="mt-6">
              <Trash2 data-icon="inline-start" />
              Удалить слово
            </Button>
          }
        />
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Убрать слово из тренировок?</AlertDialogTitle>
            <AlertDialogDescription>
              История ответов останется, статистика не изменится. Слово исчезнет из очереди и наборов.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                setConfirming(false);
                await deleteWord(draft.id);
                void navigate("/words");
              }}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Screen>
  );
}
