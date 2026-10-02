import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";
import { useBackHandler, usePlatform } from "../platform/platform";
import ui from "../shared/ui.module.css";
import top from "./TopBar.module.css";
import { cx } from "../shared/cx";
import { useGoBack } from "./navigation";

/**
 * В Telegram шапка главных экранов не нужна: имя показывает сам клиент. Раздел «Ещё» — в облачке навигации,
 * поэтому кнопки-бургера нет и в браузере. Остаётся только подзаголовок, если он есть.
 */
export function BrandBar({ subtitle }: { subtitle?: string }) {
  const compact = usePlatform().kind === "telegram";
  if (compact && !subtitle) return null;
  return (
    <header className={cx(top.topbar, compact && top.compact)}>
      {!compact && (
        <>
          <span className={top.brand}>τετράδιο</span>
          <span aria-hidden style={{ fontSize: 22 }}>
            🇬🇷
          </span>
        </>
      )}
      {subtitle && <span className={ui.note}>{subtitle}</span>}
    </header>
  );
}
/**
 * Возврат экрана: тот же обработчик у внутренней стрелки и у нативной кнопки Telegram.
 * Внутренняя стрелка скрывается только когда нативная кнопка доступна и подключена.
 */
export function BackBar({ title, right, onBack }: { title: string; right?: ReactNode; onBack?: () => void }) {
  const goBack = useGoBack();
  const back = onBack ?? goBack;
  const native = usePlatform().capabilities.back;
  useBackHandler(back);
  // Без заголовка шапка нужна только ради своей стрелки: в Telegram её заменяет нативная «Назад».
  if (!title && native && !right) return null;
  return (
    <header className={native && !right ? `${top.topbar} ${top.native}` : top.topbar}>
      {native ? (
        <span style={{ minWidth: 44 }} />
      ) : (
        <Button variant="ghost" size="icon-lg" className="size-11 -ml-2" onClick={back} aria-label="Назад">
          <ArrowLeft />
        </Button>
      )}
      <span className={top.spacer} />
      {title && <h1 className={top.title}>{title}</h1>}
      <span className={top.spacer} />
      {right ?? <span style={{ minWidth: 44 }} />}
    </header>
  );
}
