import { Button } from "@/components/ui/button";
import ui from "../shared/ui.module.css";

export function ErasingScreen({
  message,
  onRetry,
  onCancel,
}: {
  message: string;
  onRetry?: () => void;
  onCancel?: () => void;
}) {
  return (
    <div className={ui.app}>
      <main className={`${ui.screen} ${ui.roomy}`} data-testid="erasing">
        <p role="status">{message}</p>
        {onRetry && (
          <Button size="xl" className="mt-4" onClick={onRetry}>
            Повторить
          </Button>
        )}
        {onCancel && (
          <Button size="xl" variant="outline" className="mt-2" onClick={onCancel}>
            Отменить удаление
          </Button>
        )}
      </main>
    </div>
  );
}
