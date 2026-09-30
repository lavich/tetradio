import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Плитка с числом в сетке `ui.tiles`: результат занятия и статистика считают одинаково.
 */
export function StatTile({
  head,
  value,
  label,
  note,
  testId,
}: {
  head?: ReactNode;
  value: ReactNode;
  label?: ReactNode;
  note?: ReactNode;
  testId?: string;
}) {
  return (
    <Card size="sm">
      <CardContent>
        {head && <div className="flex items-center gap-2 text-sm text-muted-foreground">{head}</div>}
        <div className="text-[30px] leading-tight font-bold text-primary">{value}</div>
        {label && <div className="text-sm text-muted-foreground">{label}</div>}
        {note && (
          <div className="mt-1 text-sm text-muted-foreground" data-testid={testId}>
            {note}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
