import { useState } from "react";
import { ChevronRight, CloudDownload, Plus } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Screen } from "../../app/Screen";
import { localDay } from "../../domain/learning";
import { byTargetDate, lessonOrder, preparedByCourse } from "../../domain/schedule";
import { useNow } from "../../shared/clock";
import { CARDS, shortTitle, withCount, WORDS } from "../../shared/format";
import { fileSize } from "../../shared/offline";
import { useCatalog, useCourses, useLessons, useSettings } from "../../shared/store";
import { installCourse } from "../../content/client";
import { createLesson } from "../../storage/ops";
import { groupByCourse, nextLessonIds } from "./courses";
import { CourseHeader } from "./CourseHeader";
import { LessonRow } from "./LessonRow";
import { ScheduleCard } from "./ScheduleCard";
import ui from "../../shared/ui.module.css";

export function LessonsScreen() {
  const { settings } = useSettings();
  const installed = useLessons(true) ?? [];
  const catalog = useCatalog();
  const courses = useCourses();
  const now = useNow();
  const today = localDay(now, settings.timezone);
  const [params, setParams] = useSearchParams();
  const [title, setTitle] = useState("");
  const [problem, setProblem] = useState("");
  const open = params.get("new") === "1";
  const add = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return setProblem("Введите название занятия, например «Урок 1.3».");
    await createLesson(title.trim());
    setTitle("");
    setProblem("");
    setParams({});
  };
  const groups = groupByCourse(courses ?? [], [...installed].sort(byTargetDate), catalog?.entries ?? []);
  const next = nextLessonIds(installed, preparedByCourse(courses ?? [], now, settings.timezone));
  return (
    <Screen>
      <h1>Уроки</h1>
      {groups.map((group) => (
        <section key={group.id} className="mt-3">
          <CourseHeader group={group} onLearn={() => installCourse(group.id).catch(() => undefined)} />
          {group.course && (
            <ScheduleCard course={group.course} today={today} first={[...group.lessons].sort(lessonOrder)[0]?.title} />
          )}
          <ItemGroup className="gap-2.5">
            {group.lessons.map((lesson) => (
              <LessonRow key={lesson.id} lesson={lesson} next={next.has(lesson.id)} />
            ))}
            {group.available.map((entry) => (
              <Item key={entry.id} variant="row" render={<Link to={`/lessons/${entry.id}`} />}>
                <ItemMedia variant="icon">
                  <CloudDownload />
                </ItemMedia>
                <ItemContent>
                  <ItemTitle className="text-base">{shortTitle(entry.title)} · не загружен</ItemTitle>
                  <ItemDescription>
                    {entry.phraseCount ? withCount(entry.cardCount, CARDS) : withCount(entry.wordCount, WORDS)} ·{" "}
                    {fileSize(entry.bytes + entry.media.bytes)}
                  </ItemDescription>
                </ItemContent>
                <ItemActions>
                  <ChevronRight className="text-muted-foreground" />
                </ItemActions>
              </Item>
            ))}
          </ItemGroup>
        </section>
      ))}
      {open ? (
        <Card className="mt-3">
          <CardHeader>
            <CardTitle className="text-lg">Новое занятие</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={add}>
              <FieldGroup>
                <Field data-invalid={!!problem || undefined}>
                  <FieldLabel htmlFor="title">Название</FieldLabel>
                  <Input
                    id="title"
                    value={title}
                    placeholder="Урок 1.3"
                    aria-invalid={!!problem || undefined}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                  <FieldDescription>
                    Набор попадёт в «Мои слова»; дату назначит расписание этого курса или можно задать её на экране
                    урока.
                  </FieldDescription>
                </Field>
              </FieldGroup>
              {problem && <p className={ui.error}>{problem}</p>}
              <div className="mt-3.5 grid grid-cols-2 gap-2.5">
                <Button size="md" type="submit">
                  Создать
                </Button>
                <Button size="md" variant="quiet" type="button" onClick={() => setParams({})}>
                  Отмена
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Button size="xl" variant="soft" className="mt-2.5" onClick={() => setParams({ new: "1" })}>
          <Plus data-icon="inline-start" />
          Добавить занятие
        </Button>
      )}
      <Button size="md" variant="quiet" className="mt-2.5" render={<Link to="/more/import" />}>
        Импортировать слова из Quizlet
      </Button>
    </Screen>
  );
}
