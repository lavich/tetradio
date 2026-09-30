import { useCallback, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { takeStartRoute } from "../platform/launch";

/**
 * Единый возврат для внутренней кнопки и Telegram BackButton. Внутренняя история определяется по индексу
 * маршрутизатора, а не по `history.length`, который включает внешние страницы; без истории — на «Сегодня».
 */
export function useGoBack() {
  const navigate = useNavigate();
  return useCallback(() => {
    const index = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (index > 0) void navigate(-1);
    else void navigate("/", { replace: true });
  }, [navigate]);
}

/** Переход по параметру запуска Mini App — один раз на запуск и с заменой: назад ведёт на «Сегодня», а не обратно к слову. */
export function useStartRoute() {
  const navigate = useNavigate();
  useEffect(() => {
    const route = takeStartRoute();
    if (route) void navigate(route, { replace: true });
  }, [navigate]);
}
