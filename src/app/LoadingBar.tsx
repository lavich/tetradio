import { useSlowLoading } from "./loading";
import css from "./loading.module.css";

export function LoadingBar() {
  const slow = useSlowLoading();
  // Живая область стоит в DOM заранее: появившийся вместе с текстом живую область читалка не озвучивает.
  return (
    <>
      <p aria-live="polite" className="sr-only">
        {slow ? "Загрузка экрана" : ""}
      </p>
      {slow ? <div className={css.bar} aria-hidden /> : null}
    </>
  );
}
