import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { syncPhaseText } from "../../app/TelegramNotices";
import { CARDS, withCount, WORDS } from "../../shared/format";
import { megabytes, useOfflineStatus } from "../../shared/offline";
import { useCounts } from "../../shared/store";
import { launchContext } from "../../platform/launch";
import { useLaunchMode, usePlatform } from "../../platform/platform";
import { currentProfile } from "../../storage/profile";
import { sync, useSyncStatus } from "../../sync";
import ui from "../../shared/ui.module.css";
import css from "./progress.module.css";

export function DeviceStatus() {
  const offline = useOfflineStatus();
  const counts = useCounts();
  const profile = currentProfile();
  const status = useSyncStatus();
  const telegram = profile.kind === "telegram";
  const platform = usePlatform();
  const launch = launchContext();
  const mode = useLaunchMode();
  const MODES = { compact: "компактный", fullsize: "полноразмерный", fullscreen: "во весь экран" };
  return (
    <section className={css.device} aria-label="Устройство">
      <div data-testid="storage-scope">
        <p className={css.deviceTitle}>{profile.label}</p>
        <p className={css.deviceNote}>
          {telegram
            ? "Прогресс карточек, настройки и пройденные уроки синхронизируются между вашими устройствами в этом боте. Другие аккаунты Telegram — отдельные профили."
            : `Сборка разработки вне Telegram: тестовый пользователь ${profile.userId}, данные только в этом браузере, облачной синхронизации нет.`}
        </p>
        {telegram && profile.syncable && (
          <div className="flex items-center justify-between gap-2" data-testid="sync-status" data-phase={status.phase}>
            <span className="text-sm">
              {syncPhaseText(status.phase, status.lastConfirmedAt)}
              {status.dirty && status.phase !== "syncing" ? " · есть неотправленные изменения" : ""}
            </span>
            <Button
              size="sm"
              variant="quiet"
              disabled={status.phase === "syncing"}
              onClick={() => void sync.exchange()}
              aria-label="Повторить синхронизацию"
            >
              <RefreshCw data-icon="inline-start" />
              Повторить
            </Button>
          </div>
        )}
        {status.error && <p className={ui.error}>{status.error.message}</p>}
        {status.reason && <p className={css.deviceNote}>{status.reason}</p>}
        {status.keys && status.keys.used > status.keys.max * 0.8 && (
          <p className={css.deviceNote}>
            Облако заполнено на {Math.round((status.keys.used / status.keys.max) * 100)}%.
          </p>
        )}
        {telegram && (
          <p className={css.deviceNote} data-testid="launch-mode">
            Telegram {launch.platform ?? "?"} {launch.version ?? ""} · режим:{" "}
            {mode ? MODES[mode] : platform.kind === "telegram" ? "неизвестен" : "интеграция не загружена"}
          </p>
        )}
      </div>
      <div>
        <p className={css.deviceTitle}>
          {offline.checking
            ? "Проверяем офлайн-режим…"
            : offline.ready
              ? telegram
                ? "Скачанные данные доступны без сети"
                : "Готово офлайн"
              : offline.unsupported
                ? "Офлайн-кеш недоступен в этом клиенте"
                : "Офлайн-пакет ещё готовится"}
        </p>
        <p className={css.deviceNote}>
          {telegram
            ? "Уже открытое приложение продолжает работать со скачанными уроками при потере сети. Повторный запуск Mini App без сети зависит от клиента Telegram, и Τετράδιο его не обещает."
            : offline.ready
              ? "Оболочка приложения открывается без сети. Слова и медиа доступны для уроков, скачанных на экране урока."
              : offline.unsupported
                ? "Приложение работает онлайн; для запуска без сети установите его в браузере с поддержкой офлайн-кеша."
                : "Оставьте страницу открытой на несколько секунд — оболочка загружается в кеш."}
          {offline.quota > 0 && ` Занято ${megabytes(offline.usage)} из ${megabytes(offline.quota)}.`}
          {offline.persisted
            ? " Хранилище защищено от автоочистки."
            : " Клиент может очистить данные — делайте полную копию."}
        </p>
        {offline.problem && <p className={ui.error}>{offline.problem}</p>}
      </div>
      <p className={css.deviceNote}>
        Τετράδιο хранит{" "}
        {counts && counts.cards > counts.words ? withCount(counts.cards, CARDS) : withCount(counts?.words ?? 0, WORDS)}{" "}
        и {withCount(counts?.answers ?? 0, ["ответ", "ответа", "ответов"])}{" "}
        {telegram
          ? "на этом устройстве; в облако Telegram уходит только компактный прогресс"
          : "только на этом устройстве"}
        . Регистрация и сервер не нужны.
      </p>
      <p className={css.deviceNote} data-testid="credits">
        Картинки слов — Microsoft Fluent Emoji (лицензия MIT, © Microsoft Corporation). Звук — синтез речи вашего
        устройства.
      </p>
    </section>
  );
}
