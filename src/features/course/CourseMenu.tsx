import { Ellipsis } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import css from "./shelf.module.css";

/**
 * «⋯» у заголовка полки: действия с курсом. Своё меню, а не Base UI: его позиционирование тянуло в чанк полки
 * floating-ui и выводило предкеш за предел `check:bundle`.
 */
export function CourseMenu({
  title,
  paused,
  onToggle,
  disabled,
}: {
  title: string;
  paused: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const item = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    item.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };
  return (
    <div className={css.menu} ref={box}>
      <button
        ref={trigger}
        type="button"
        className={css.menuTrigger}
        aria-label={`Действия с курсом «${title}»`}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="course-menu"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <Ellipsis aria-hidden size={20} />
      </button>
      {open && (
        <div
          role="menu"
          aria-label={`Действия с курсом «${title}»`}
          className={css.menuPopup}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              close(true);
            } else if (event.key === "Tab") close(false);
          }}
        >
          <button
            ref={item}
            type="button"
            role="menuitem"
            className={css.menuItem}
            onClick={() => {
              close(true);
              onToggle();
            }}
          >
            {paused ? "Продолжить курс" : "Приостановить курс"}
          </button>
        </div>
      )}
    </div>
  );
}
