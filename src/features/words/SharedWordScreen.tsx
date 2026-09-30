import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Navigate, useParams } from "react-router-dom";
import { CloudOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Screen } from "../../app/Screen";
import { previewPackage, refreshCatalog, wordFromPackage, type PackagePreview } from "../../content/client";
import { shortTitle } from "../../shared/format";
import { AssetSourceContext, packageAssetSource, useCatalogPhase, useWordLesson } from "../../shared/store";
import { db } from "../../storage/db";
import { ExampleBox, ReadingNotes, WordSummary } from "./WordCardView";
import ui from "../../shared/ui.module.css";

type Preview =
  { status: "loading" } | { status: "ready"; preview: PackagePreview } | { status: "error"; message: string };

/**
 * Слово по ссылке. Установленное и не удалённое открывается обычным экраном; иначе карточка собирается
 * из пакета урока в памяти и показывается только для просмотра: ни урок, ни подписка, ни медиа в базу не попадают.
 */
export function SharedWordScreen() {
  const { id = "" } = useParams();
  const local = useLiveQuery(async () => (await db.words.get(id)) ?? null, [id]);
  const lesson = useWordLesson(id);
  const catalogSize = useLiveQuery(() => db.catalog.count(), []);
  const phase = useCatalogPhase();
  const [preview, setPreview] = useState<Preview>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const lessonId = lesson?.id,
    version = lesson?.version;

  useEffect(() => {
    if (!lessonId) return;
    let alive = true;
    setPreview((current) =>
      current.status === "ready" && current.preview.entry.id === lessonId && current.preview.entry.version === version
        ? current
        : { status: "loading" },
    );
    previewPackage(lessonId).then(
      (result) => alive && setPreview({ status: "ready", preview: result }),
      (error: Error) => alive && setPreview({ status: "error", message: error.message }),
    );
    return () => {
      alive = false;
    };
  }, [lessonId, version, attempt]);

  const ready = preview.status === "ready" && preview.preview.entry.id === lessonId ? preview.preview : null;
  const source = useMemo(() => (ready ? packageAssetSource(ready.pack) : null), [ready?.pack]);

  if (local && !local.deletedAt) return <Navigate to={`/words/${encodeURIComponent(id)}`} replace />;
  const loading = (
    <Screen back="Слово">
      <div className="flex flex-col gap-3 py-2" aria-busy="true" role="status" aria-label="Загрузка слова">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    </Screen>
  );
  const failure = (message: string, retry: () => void) => (
    <Screen back="Слово">
      <Card className="mb-3 bg-soft ring-0">
        <CardHeader>
          <CardDescription className="flex items-center gap-2 text-accent-foreground">
            <CloudOff />
            Слово не загрузилось
          </CardDescription>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button size="md" variant="soft" onClick={retry}>
            <RefreshCw data-icon="inline-start" />
            Повторить
          </Button>
        </CardContent>
      </Card>
    </Screen>
  );
  const missing = (
    <Screen back="Слово">
      <p className={ui.muted}>Слово не найдено.</p>
    </Screen>
  );

  if (local === undefined || lesson === undefined || catalogSize === undefined) return loading;
  if (!lesson) {
    if (phase === "loading") return loading;
    if (phase === "error" && catalogSize === 0)
      return failure("Не удалось загрузить каталог уроков. Проверьте соединение и повторите.", () => {
        refreshCatalog().catch(() => undefined);
      });
    return missing;
  }
  if (preview.status === "error") return failure(preview.message, () => setAttempt((n) => n + 1));
  if (!ready || !source) return loading;
  const card = ready.pack.words.find((word) => word.id === id);
  if (!card) return missing;
  const word = wordFromPackage(card, "");
  return (
    <AssetSourceContext.Provider value={source}>
      <Screen back="Слово">
        <WordSummary word={word} />
        <ReadingNotes word={word} />
        {word.examples.map((example, index) => (
          <ExampleBox key={index} example={example} />
        ))}
        <p className={ui.note} data-testid="shared-lesson">
          Слово из урока {shortTitle(ready.entry.title)}
        </p>
      </Screen>
    </AssetSourceContext.Provider>
  );
}
