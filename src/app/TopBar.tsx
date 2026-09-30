import { ArrowLeft, Menu } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";
import { useBackHandler, usePlatform } from "../platform/platform";
import ui from "../shared/ui.module.css";
import top from "./TopBar.module.css";
import { cx } from "../shared/cx";
import { useGoBack } from "./navigation";

/**
 * В Telegram шапка главных экранов не нужна: имя показывает сам клиент, а раздел «Ещё» доступен
 * из нижней навигации, поэтому дублирующая кнопка-бургер убрана. Остаётся только подзаголовок, если он есть.
 */
export function BrandBar({ subtitle }: { subtitle?: string }) {
  const navigate = useNavigate();
  const compact = usePlatform().kind === "telegram";
  if (compact && !subtitle) return null;
  return (
    <header className={cx(top.topbar, compact && top.compact)}>
      {!compact && (
        <>
          <span className={top.brand}>lexi</span>
          <span aria-hidden style={{ fontSize: 22 }}>
            🇬🇷
          </span>
        </>
      )}
      {subtitle && <span className={ui.note}>{subtitle}</span>}
      <span className={top.spacer} />
      {!compact && (
        <Button variant="ghost" size="icon-lg" className="size-11" onClick={() => navigate("/more")} aria-label="Ещё">
          <Menu />
        </Button>
      )}
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
  return (
    <header className={top.topbar}>
      {native ? (
        <span style={{ minWidth: 44 }} />
      ) : (
        <Button variant="ghost" size="icon-lg" className="size-11 -ml-2" onClick={back} aria-label="Назад">
          <ArrowLeft />
        </Button>
      )}
      <span className={top.spacer} />
      <h1 className={top.title}>{title}</h1>
      <span className={top.spacer} />
      {right ?? <span style={{ minWidth: 44 }} />}
    </header>
  );
}
