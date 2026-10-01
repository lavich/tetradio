import { ChevronRight, CloudDownload } from "lucide-react";
import { Link } from "react-router-dom";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Screen } from "../../app/Screen";
import { localDay } from "../../domain/learning";
import { byTargetDate, lessonOrder, preparedByCourse } from "../../domain/schedule";
import { useNow } from "../../shared/clock";
import { CARDS, shortTitle, withCount, WORDS } from "../../shared/format";
import { fileSize } from "../../shared/offline";
import { useCatalog, useCourses, useLessons, useSettings } from "../../shared/store";
import { installCourse } from "../../content/client";
import { groupByCourse, nextLessonIds } from "./courses";
import { CourseHeader } from "./CourseHeader";
import { LessonRow } from "./LessonRow";
import { ScheduleCard } from "./ScheduleCard";

export function LessonsScreen() {
  const { settings } = useSettings();
  const installed = useLessons(true) ?? [];
  const catalog = useCatalog();
  const courses = useCourses();
  const now = useNow();
  const today = localDay(now, settings.timezone);
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
    </Screen>
  );
}
