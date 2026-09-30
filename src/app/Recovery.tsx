import { Component, type ErrorInfo, type ReactNode } from "react";
import { lifecycle, reportError } from "../reporting/reporting";
import { isStorageError, RECOVERY_ATTEMPTS, RECOVERY_WINDOW_MS, reopenDatabase } from "../storage/recovery";
import { CrashScreen } from "./CrashScreen";
import ui from "../shared/ui.module.css";

interface State {
  error: unknown;
  recovering: boolean;
  generation: number;
  reportId: string | null;
}

/**
 * Граница ошибок над приложением: без неё React снимает корень целиком, а перезагрузить Mini App нельзя.
 * Ошибка хранилища лечится переоткрытием базы и перемонтированием дерева по поколению; маршрут остаётся в адресе.
 * Вылеченный отказ хранилища даёт только крошку; отчёт категории «ui» со стеком компонентов уходит, когда лечение не помогло.
 * Граница ничего не пишет в базу: активное занятие уже лежит в IndexedDB, после перезапуска «Сегодня» предложит продолжить.
 */
export class Recovery extends Component<{ children: ReactNode }, State> {
  state: State = { error: null, recovering: false, generation: 0, reportId: null };
  private attempts: number[] = [];
  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { error };
  }
  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.warn("Экран упал, приложение восстанавливается", error, info.componentStack);
    const componentStack = info.componentStack ?? "";
    const report = () => reportError(error, { category: "ui", extra: { componentStack } });
    const now = Date.now();
    this.attempts = this.attempts.filter((at) => now - at < RECOVERY_WINDOW_MS);
    if (!isStorageError(error) || this.attempts.length >= RECOVERY_ATTEMPTS) {
      this.setState({ reportId: report() });
      return;
    }
    this.attempts.push(now);
    const attempt = this.attempts.length;
    this.setState({ recovering: true });
    reopenDatabase().then(
      () => {
        lifecycle("storageRecovered", { attempt });
        this.setState((state) => ({ error: null, recovering: false, generation: state.generation + 1 }));
      },
      (failure) => {
        console.warn("Не удалось переоткрыть локальную базу", failure);
        this.setState({ recovering: false, reportId: report() });
      },
    );
  }
  render() {
    const { error, recovering, generation } = this.state;
    if (error && recovering)
      return (
        <div className={ui.app}>
          <main className={`${ui.screen} ${ui.roomy}`} data-testid="recovering">
            <p className={ui.muted} role="status">
              Восстанавливаем доступ к данным…
            </p>
          </main>
        </div>
      );
    if (error)
      return (
        <CrashScreen
          testId="recovery-failed"
          title="Не удалось показать экран"
          description="Данные на устройстве сохранены. Перезапуск обычно помогает."
          error={error}
          reportId={this.state.reportId}
        />
      );
    return (
      <div key={generation} className="contents">
        {this.props.children}
      </div>
    );
  }
}
