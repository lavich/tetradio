import type { ReactNode } from "react";
import { BackBar, BrandBar } from "./TopBar";
import ui from "../shared/ui.module.css";

/**
 * Оболочка экрана. Собрана в одном месте из-за `ui.screen`: от этого класса зависят не только отступы
 * содержимого, но и отступ под системную строку Telegram (`.app>.screen:first-child` в `ui.module.css`).
 * `bare` — экран без шапки: результат занятия, откуда шагу назад возвращаться некуда.
 */
export function Screen({
  back,
  right,
  onBack,
  subtitle,
  bare,
  roomy,
  children,
}: {
  back?: string;
  right?: ReactNode;
  onBack?: () => void;
  subtitle?: string;
  bare?: boolean;
  roomy?: boolean;
  children?: ReactNode;
}) {
  return (
    <>
      {bare ? null : back === undefined ? (
        <BrandBar subtitle={subtitle} />
      ) : (
        <BackBar title={back} right={right} onBack={onBack} />
      )}
      <main className={roomy ? `${ui.screen} ${ui.roomy}` : ui.screen}>{children}</main>
    </>
  );
}
