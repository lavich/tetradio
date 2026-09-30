import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Screen } from "../../app/Screen";
import { useLiveQuery } from "dexie-react-hooks";
import { parseImport } from "../../domain/import";
import { useAction } from "../../shared/action";
import { withCount, WORDS } from "../../shared/format";
import { useLessons } from "../../shared/store";
import { importPreview } from "../../storage/queries";
import { commitImport } from "../../storage/ops";
import ui from "../../shared/ui.module.css";
import { cx } from "../../shared/cx";

export function ImportScreen() {
  const lessons = useLessons() ?? [];
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [target, setTarget] = useState("new");
  const [title, setTitle] = useState("Урок 1.3");
  const { busy, problem, run } = useAction("Ничего не сохранено: хранилище недоступно.");
  const parsed = useMemo(() => parseImport(text), [text]);
  const preview = useLiveQuery(() => importPreview(parsed.rows), [text]);
  const duplicates = preview?.duplicates ?? 0,
    conflicts = preview?.conflicts ?? 0;

  const save = () =>
    run(
      async () => {
        const outcome = await commitImport({
          rows: parsed.rows,
          lessonId: target === "new" ? null : target,
          lessonTitle: title.trim() || "Новый набор",
        });
        void navigate(`/lessons/${outcome.lessonId}`);
      },
      (error) =>
        error instanceof Error ? `Ничего не сохранено: ${error.message}` : "Ничего не сохранено: хранилище недоступно.",
    );
  return (
    <Screen back="Импорт слов">
      <p className={ui.note}>
        Вставьте список из Quizlet: строки «слово / перевод» подряд или колонки через табуляцию. До нажатия «Сохранить»
        данные не меняются.
      </p>
      <Field>
        <FieldLabel htmlFor="text">Текст списка</FieldLabel>
        <Textarea
          id="text"
          className="min-h-40"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={"το σπίτι\nдом\nτο νερό\nвода"}
        />
      </Field>
      {text.trim() && (
        <Card className="mt-3 mb-3">
          <CardHeader>
            <CardTitle>Предпросмотр</CardTitle>
          </CardHeader>
          <CardContent>
            <p className={ui.note} style={{ margin: "0 0 8px" }}>
              Режим: {parsed.mode === "tsv" ? "колонки через табуляцию" : "чередование строк"} · распознано{" "}
              {withCount(parsed.rows.length, WORDS)} · служебных строк пропущено {parsed.ignored} · ошибок{" "}
              {parsed.errors.length}
            </p>
            {duplicates > 0 && (
              <p className={ui.note} style={{ margin: "0 0 8px" }}>
                {duplicates} уже есть в словаре — они будут добавлены в набор без дубликата.
              </p>
            )}
            {conflicts > 0 && (
              <p className={ui.small} style={{ margin: "0 0 8px", color: "var(--almost-fg)" }}>
                {conflicts} слов совпадают по написанию, но с другим переводом — будут созданы отдельные записи.
              </p>
            )}
            {parsed.errors.map((error) => (
              <p className={ui.error} key={error.line} style={{ margin: "2px 0" }}>
                Строка {error.line}: {error.message}
              </p>
            ))}
            <div className={ui.stack}>
              {parsed.rows.slice(0, 8).map((row, index) => (
                <div key={index} className={cx(ui.row, ui.between, ui.small)}>
                  <span>{row.greek}</span>
                  <span className={ui.muted}>
                    {row.russian}
                    {row.sourceMastered ? " · Mastered" : ""}
                  </span>
                </div>
              ))}
              {parsed.rows.length > 8 && (
                <p className={ui.note} style={{ margin: 0 }}>
                  …и ещё {parsed.rows.length - 8}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
      <Field>
        <FieldLabel htmlFor="target">Куда добавить</FieldLabel>
        <Select value={target} onValueChange={(value) => setTarget(value ?? "new")}>
          <SelectTrigger id="target" className="w-full">
            <SelectValue>
              {(value) =>
                value === "new"
                  ? "Новый набор"
                  : (lessons.find((lesson) => lesson.id === value)?.title ?? "Новый набор")
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="new">Новый набор</SelectItem>
              {lessons.map((lesson) => (
                <SelectItem key={lesson.id} value={lesson.id}>
                  {lesson.title}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </Field>
      {target === "new" && (
        <Field>
          <FieldLabel htmlFor="title">Название набора</FieldLabel>
          <Input id="title" value={title} onChange={(event) => setTitle(event.target.value)} />
          <FieldDescription>
            Дата занятия назначится по расписанию; свою дату можно задать на экране урока.
          </FieldDescription>
        </Field>
      )}
      {problem && (
        <p className={ui.error} role="alert">
          {problem}
        </p>
      )}
      <Button size="xl" style={{ marginTop: 16 }} disabled={busy || !parsed.rows.length} onClick={save}>
        Сохранить {parsed.rows.length ? withCount(parsed.rows.length, WORDS) : ""}
      </Button>
    </Screen>
  );
}
