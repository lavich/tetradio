import { useSlowLoading } from "./loading";
import css from "./loading.module.css";

export function LoadingBar() {
  return useSlowLoading() ? <div className={css.bar} role="status" aria-label="Загрузка экрана" /> : null;
}
