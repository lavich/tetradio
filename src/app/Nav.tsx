import { BookOpen, ChartNoAxesColumn, Home, Rows3 } from "lucide-react";
import { useEffect, useRef } from "react";
import { NavLink, useLocation } from "react-router-dom";
import nav from "./Nav.module.css";

const LINKS: { to: string; label: string; Icon: typeof Home; also?: string }[] = [
  { to: "/", label: "Сегодня", Icon: Home },
  { to: "/course", label: "Курс", Icon: BookOpen },
  { to: "/words", label: "Слова", Icon: Rows3 },
  /** Настройки, копия и статистика открываются со страницы прогресса и остаются под этой вкладкой. */
  { to: "/progress", label: "Прогресс", Icon: ChartNoAxesColumn, also: "/more" },
];
export function Nav() {
  const ref = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  // Фокус с клавиатуры не прячется под навигацией (WCAG 2.4.11). Chromium при Tab не учитывает
  // scroll-padding страницы, а scrollIntoView учитывает — докручиваем только то, что ушло под полосу.
  useEffect(() => {
    const reveal = (event: FocusEvent) => {
      const target = event.target;
      const bar = ref.current;
      if (!(target instanceof HTMLElement) || !bar || bar.contains(target)) return;
      // Браузер докручивает к фокусу сам и уже после события — проверяем на следующем кадре.
      requestAnimationFrame(() => {
        if (target.getBoundingClientRect().bottom > bar.getBoundingClientRect().top)
          target.scrollIntoView({ block: "nearest" });
      });
    };
    document.addEventListener("focusin", reveal);
    return () => document.removeEventListener("focusin", reveal);
  }, []);
  return (
    <nav ref={ref} className={nav.nav} aria-label="Основные разделы">
      <div className={nav.inner}>
        {LINKS.map(({ to, label, Icon, also }) => {
          // Вкладка «Курс» активна и на прежнем списке уроков: для словарного курса это тот же раздел.
          const alias = !!also && pathname.startsWith(also);
          return (
            <NavLink key={to} to={to} end={to === "/"} className={nav.link} aria-current={alias ? "page" : undefined}>
              {({ isActive }) => (
                <>
                  <Icon size={22} strokeWidth={isActive || alias ? 2.4 : 1.9} aria-hidden />
                  <span>{label}</span>
                </>
              )}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}
