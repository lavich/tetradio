import { lazy, Suspense, useState, type ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { feedbackBot, formAvailable, openFeedback } from "../../platform/feedback";

type Look = Pick<ComponentProps<typeof Button>, "size" | "variant" | "className">;

const ChatLink = ({ reportId, ...look }: { reportId: string | null } & Look) => (
  <Button {...look} data-testid="feedback-button" onClick={() => openFeedback(reportId)}>
    Написать автору
  </Button>
);

// Чанк формы может не загрузиться (старая страница после выкатки, нет сети): ошибка из lazy уронила бы и экран сбоя.
const FeedbackForm = lazy(() =>
  import("./FeedbackForm").catch(() => ({
    default: ({ reportId }: { reportId: string | null }) => <ChatLink reportId={reportId} size="md" variant="soft" />,
  })),
);

/**
 * Доступность формы проверяется в момент нажатия: экран отказа базы появляется раньше, чем загружается мост Telegram.
 * Форма грузится отдельным чанком — экран сбоя в стартовом графе.
 */
export function FeedbackButton({
  reportId,
  size = "md",
  variant = "soft",
  className,
}: { reportId: string | null } & Look) {
  const [open, setOpen] = useState(false);
  const look = { size, variant, className };
  if (!feedbackBot()) return null;
  if (open)
    return (
      <Suspense
        fallback={
          <Button {...look} disabled>
            Написать автору
          </Button>
        }
      >
        <FeedbackForm reportId={reportId} />
      </Suspense>
    );
  return (
    <Button
      {...look}
      data-testid="feedback-button"
      onClick={() => (formAvailable() ? setOpen(true) : openFeedback(reportId))}
    >
      Написать автору
    </Button>
  );
}
