import { useState } from "react";
import { ChevronRight, Search, SearchX } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Screen } from "../../app/Screen";
import { withCount, WORDS } from "../../shared/format";
import { useLessons, useWordPages } from "../../shared/store";
import { PAGE_SIZE, type WordFilter } from "../../storage/queries";
import ui from "../../shared/ui.module.css";

const FILTERS: { key: WordFilter; label: string }[] = [
  { key: "all", label: "Все" },
  { key: "new", label: "Не начаты" },
  { key: "learning", label: "В изучении" },
  { key: "review", label: "На повторении" },
  { key: "solid", label: "Закреплены" },
];

export function WordsScreen() {
  const lessons = useLessons() ?? [];
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<WordFilter>("all");
  const [lessonId, setLessonId] = useState("all");
  const page = useWordPages({ query, filter, lessonId: lessonId === "all" ? null : lessonId });
  return (
    <Screen>
      <h1>Слова</h1>
      <InputGroup className="mb-1">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск по греческому или русскому"
          aria-label="Поиск слова"
        />
      </InputGroup>
      <p className={`${ui.note} mt-0 mb-2.5`}>
        Поиск по началу слов среди загруженных на устройство. Уроки из каталога, которые ещё не открывались, сюда не
        входят.
      </p>
      <div className="no-scrollbar flex gap-2 overflow-x-auto pb-2">
        {FILTERS.map((item) => (
          <Badge
            key={item.key}
            variant={filter === item.key ? "default" : "secondary"}
            render={<button type="button" aria-pressed={filter === item.key} onClick={() => setFilter(item.key)} />}
            className="h-8 cursor-pointer px-3.5 text-sm whitespace-nowrap"
          >
            {item.label}
          </Badge>
        ))}
      </div>
      <Field>
        <FieldLabel htmlFor="lesson-filter">Набор</FieldLabel>
        <Select value={lessonId} onValueChange={(value) => setLessonId(value ?? "all")}>
          <SelectTrigger id="lesson-filter" className="w-full">
            <SelectValue>
              {(value) =>
                value === "all" ? "Все наборы" : (lessons.find((lesson) => lesson.id === value)?.title ?? "Все наборы")
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="all">Все наборы</SelectItem>
              {lessons.map((lesson) => (
                <SelectItem key={lesson.id} value={lesson.id}>
                  {lesson.title}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        {lessonId !== "all" && <FieldDescription>Показаны только слова выбранного набора.</FieldDescription>}
      </Field>
      <p className="mt-3.5 mb-2 text-sm text-muted-foreground" data-testid="word-count">
        {page.hasMore
          ? `Показано ${withCount(page.items.length, WORDS)}, есть ещё`
          : withCount(page.items.length, WORDS)}
      </p>
      <ItemGroup className="gap-2.5">
        {page.items.map(({ word, group }) => (
          <Item key={word.id} variant="row" render={<Link to={`/words/${word.id}`} />}>
            <ItemContent>
              <ItemTitle className="text-base">{word.greek}</ItemTitle>
              <ItemDescription>
                {word.russian} · {FILTERS.find((f) => f.key === group)!.label.toLowerCase()}
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <ChevronRight className="text-muted-foreground" />
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
      {page.hasMore && (
        <Button size="md" variant="soft" className="mt-3" disabled={page.loading} onClick={page.loadMore}>
          {page.loading ? "Загружаем…" : `Показать ещё ${PAGE_SIZE}`}
        </Button>
      )}
      {page.ready && !page.items.length && (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchX />
            </EmptyMedia>
            <EmptyTitle>Ничего не найдено</EmptyTitle>
            <EmptyDescription>
              {query.trim()
                ? "Поиск ищет по началу слова среди загруженных уроков. Измените запрос или снимите фильтры."
                : "Откройте урок из каталога или импортируйте слова."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </Screen>
  );
}
