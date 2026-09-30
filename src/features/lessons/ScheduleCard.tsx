import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { scheduleSet } from "../../domain/schedule";
import { defaultSchedule, fillSchedule, type Course } from "../../domain/types";
import { dayMonth } from "../../shared/format";
import { saveCourseTempo } from "../../storage/ops";
import ui from "../../shared/ui.module.css";

const SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
/** Час занятия выбирается из целых часов: минуты рубежу подготовки ничего не добавляют. */
const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
/** «Пн и Чт», «Пн, Ср и Пт» — дни всегда в порядке недели, а не в порядке нажатий. */
export const listDays = (days: number[]) => {
  const names = [...days].sort((a, b) => a - b).map((day) => SHORT[day - 1]);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} и ${names[names.length - 1]}` : (names[0] ?? "");
};

export function ScheduleCard({ course, today, first }: { course: Course; today: string; first?: string }) {
  const schedule = fillSchedule(course.schedule);
  const active = scheduleSet(schedule);
  const [editing, setEditing] = useState(false);
  const [start, setStart] = useState("");
  const [days, setDays] = useState<number[]>([]);
  const [hour, setHour] = useState(schedule.lessonHour);
  const [problem, setProblem] = useState("");
  const open = () => {
    setStart(schedule.startDate ?? "");
    setDays(schedule.weekdays);
    setHour(schedule.lessonHour);
    setProblem("");
    setEditing(true);
  };
  const toggle = (day: number) =>
    setDays((current) => (current.includes(day) ? current.filter((d) => d !== day) : [...current, day]));
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!days.length) return setProblem("Выберите хотя бы один день недели.");
    if (!start) return setProblem("Укажите дату первого занятия.");
    await saveCourseTempo(
      course.id,
      { schedule: { startDate: start, weekdays: [...days].sort((a, b) => a - b), lessonHour: hour } },
      new Date(),
    );
    setEditing(false);
  };
  const remove = async () => {
    await saveCourseTempo(course.id, { schedule: defaultSchedule }, new Date());
    setEditing(false);
  };
  return (
    <Card className="mb-3">
      <CardHeader>
        <CardTitle className="text-lg">Расписание и темп</CardTitle>
        {!editing && (
          <CardDescription>
            {active
              ? `${listDays(schedule.weekdays)}, первое занятие ${dayMonth(schedule.startDate!)}`
              : "Не задано — даты уроков назначаются вручную"}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent>
        {editing ? (
          <form onSubmit={save}>
            <Field data-invalid={problem.includes("дату") || undefined}>
              <FieldLabel htmlFor="start">Первое занятие</FieldLabel>
              <Input
                id="start"
                type="date"
                value={start}
                aria-invalid={problem.includes("дату") || undefined}
                onChange={(event) => {
                  setStart(event.target.value);
                  setProblem("");
                }}
              />
              {first && <FieldDescription>Первый урок по порядку — «{first}».</FieldDescription>}
              {start && start < today && (
                <FieldDescription>
                  Дата в прошлом: уроки, чьи дни уже прошли, будут отмечены проведёнными.
                </FieldDescription>
              )}
            </Field>
            <div className="mt-3 grid grid-cols-7 gap-1.5" role="group" aria-label="Дни недели">
              {SHORT.map((name, index) => {
                const day = index + 1,
                  on = days.includes(day);
                return (
                  <Button
                    key={day}
                    type="button"
                    size="sm"
                    variant={on ? "default" : "outline"}
                    className="px-0"
                    aria-pressed={on}
                    onClick={() => {
                      toggle(day);
                      setProblem("");
                    }}
                  >
                    {name}
                  </Button>
                );
              })}
            </div>
            <Field className="mt-3">
              <FieldLabel htmlFor={`lesson-hour-${course.id}`}>Время занятия</FieldLabel>
              <Select value={String(hour)} onValueChange={(value) => value && setHour(Number(value))}>
                <SelectTrigger id={`lesson-hour-${course.id}`} className="w-full">
                  <SelectValue>{(value: string) => hourLabel(Number(value))}</SelectValue>
                </SelectTrigger>
                {/* Двадцать четыре часа во весь экран уезжают под шапку клиента: список ограничен и прокручивается. */}
                <SelectContent alignItemWithTrigger={false} className="max-h-60">
                  <SelectGroup>
                    {HOURS.map((item) => (
                      <SelectItem key={item} value={String(item)}>
                        {hourLabel(item)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>После этого часа Lexi переходит к следующему набору.</FieldDescription>
            </Field>
            {problem && (
              <p className={ui.error} role="alert">
                {problem}
              </p>
            )}
            <div className="mt-3.5 grid grid-cols-2 gap-2.5">
              <Button size="md" type="submit">
                Сохранить
              </Button>
              <Button size="md" variant="quiet" type="button" onClick={() => setEditing(false)}>
                Отмена
              </Button>
            </div>
            {active && (
              <Button size="md" variant="destructive" type="button" className="mt-2.5" onClick={remove}>
                Убрать расписание
              </Button>
            )}
          </form>
        ) : (
          <>
            <Button size="md" variant="soft" onClick={open}>
              {active ? "Изменить расписание" : "Задать расписание"}
            </Button>
            <Field className="mt-3">
              <FieldLabel htmlFor={`per-day-${course.id}`}>Новых карточек в день</FieldLabel>
              <Input
                id={`per-day-${course.id}`}
                type="number"
                inputMode="numeric"
                min={0}
                max={100}
                defaultValue={course.newItemsPerDay}
                onBlur={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isInteger(value) && value >= 0 && value <= 100 && value !== course.newItemsPerDay)
                    void saveCourseTempo(course.id, { newItemsPerDay: value }, new Date());
                  else event.target.value = String(course.newItemsPerDay);
                }}
              />
              <FieldDescription>Предел этого курса. У других курсов он свой.</FieldDescription>
            </Field>
          </>
        )}
      </CardContent>
    </Card>
  );
}
