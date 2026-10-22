import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CloudOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Screen } from "../../app/Screen";
import { refreshCatalog } from "../../content/client";
import { reportError } from "../../reporting/reporting";
import { useAllCourses } from "../../shared/courses";
import { useCatalogPhase } from "../../shared/store";
import { courses, followCourse } from "../../storage/courses";

/** Полка курса по ссылке: только показывает курс; неизвестный курс — «Сегодня». */
export function SharedCourseScreen() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const list = useAllCourses();
  const phase = useCatalogPhase();
  const [failed, setFailed] = useState(false);
  const known = !!list?.some((course) => course.id === id);
  const settled = list !== undefined && (known || phase !== "loading");
  useEffect(() => {
    if (!settled) return;
    let alive = true;
    // Список из живого запроса мог отстать от записи каталога: решает свежее чтение, а не он.
    void (async () => {
      const found = (await courses()).some((course) => course.id === id);
      if (!alive) return;
      if (!found) {
        if (phase === "ready") void navigate("/", { replace: true });
        else setFailed(true);
        return;
      }
      await followCourse(id).catch((error: unknown) => void reportError(error, { category: "storage" }));
      if (alive) void navigate("/course", { replace: true, state: { course: id } });
    })();
    return () => {
      alive = false;
    };
  }, [settled, phase, id, navigate]);

  if (!failed || phase === "loading")
    return (
      <Screen back="Курс">
        <div className="flex flex-col gap-3 py-2" aria-busy="true" role="status" aria-label="Загрузка курса">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      </Screen>
    );
  return (
    <Screen back="Курс">
      <Card className="mb-3 bg-soft ring-0">
        <CardHeader>
          <CardDescription className="flex items-center gap-2 text-accent-foreground">
            <CloudOff />
            Каталог не загрузился
          </CardDescription>
          <CardDescription>Проверьте соединение и повторите.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            size="md"
            variant="soft"
            onClick={() => {
              refreshCatalog().catch(() => undefined);
            }}
          >
            <RefreshCw data-icon="inline-start" />
            Повторить
          </Button>
        </CardContent>
      </Card>
    </Screen>
  );
}
