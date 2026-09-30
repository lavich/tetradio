import {
  BarChart3,
  ChevronRight,
  Cloud,
  CloudOff,
  Download,
  RefreshCw,
  Settings,
  Upload,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Screen } from "../../app/Screen";
import { syncPhaseText } from "../../app/TelegramNotices";
import { CARDS, withCount, WORDS } from "../../shared/format";
import { megabytes, useOfflineStatus } from "../../shared/offline";
import { useCounts } from "../../shared/store";
import { launchContext } from "../../platform/launch";
import { useLaunchMode, usePlatform } from "../../platform/platform";
import { currentProfile } from "../../storage/profile";
import { sync, useSyncStatus } from "../../sync";
import ui from "../../shared/ui.module.css";

const LINKS = [
  { to: "/more/stats", label: "Статистика", sub: "Ответы, сроки и слабые навыки", Icon: BarChart3 },
  { to: "/more/settings", label: "Настройки", sub: "Дневной лимит, размер занятия, зона", Icon: Settings },
  { to: "/more/import", label: "Импорт слов", sub: "Вставка из Quizlet или TSV", Icon: Upload },
  { to: "/more/backup", label: "Копия данных", sub: "Полный экспорт и восстановление", Icon: Download },
];
export function MoreScreen() {
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
    <Screen>
      <h1>Ещё</h1>
      <Card className="mb-3" data-testid="storage-scope">
        <CardContent className="flex flex-col gap-1.5">
          <p className="m-0 flex items-center gap-2.5 font-semibold">
            {telegram ? (
              <Cloud className="size-5 text-muted-foreground" />
            ) : (
              <CloudOff className="size-5 text-muted-foreground" />
            )}
            {profile.label}
          </p>
          <p className="m-0 text-sm text-muted-foreground">
            {telegram
              ? profile.syncable
                ? "Прогресс стандартных слов, настройки и даты уроков синхронизируются между вашими устройствами в этом боте. Обычный браузер и другие аккаунты — отдельные профили."
                : "Telegram не передал сведения о пользователе: данные хранятся только на устройстве, облачная запись приостановлена."
              : "Данные хранятся только в этом браузере. Вход через Telegram здесь не нужен и не предлагается; перенос — полной копией."}
          </p>
          {telegram && profile.syncable && (
            <div
              className="flex items-center justify-between gap-2"
              data-testid="sync-status"
              data-phase={status.phase}
            >
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
          {status.reason && <p className="m-0 text-sm text-muted-foreground">{status.reason}</p>}
          {status.keys && status.keys.used > status.keys.max * 0.8 && (
            <p className="m-0 text-sm text-muted-foreground">
              Облако заполнено на {Math.round((status.keys.used / status.keys.max) * 100)}%.
            </p>
          )}
          {telegram && (
            <p className="m-0 text-sm text-muted-foreground" data-testid="launch-mode">
              Telegram {launch.platform ?? "?"} {launch.version ?? ""} · режим:{" "}
              {mode ? MODES[mode] : platform.kind === "telegram" ? "неизвестен" : "интеграция не загружена"}
            </p>
          )}
        </CardContent>
      </Card>
      <Card className="mb-3">
        <CardContent className="flex flex-col gap-1.5">
          <p className="m-0 flex items-center gap-2.5 font-semibold">
            {offline.ready ? (
              <Wifi className="size-5 text-muted-foreground" />
            ) : (
              <WifiOff className="size-5 text-muted-foreground" />
            )}
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
          <p className="m-0 text-sm text-muted-foreground">
            {telegram
              ? "Уже открытое приложение продолжает работать со скачанными уроками при потере сети. Повторный запуск Mini App без сети зависит от клиента Telegram, и Lexi его не обещает."
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
        </CardContent>
      </Card>
      <ItemGroup className="gap-2.5">
        {LINKS.map(({ to, label, sub, Icon }) => (
          <Item key={to} variant="row" render={<Link to={to} />}>
            <ItemMedia variant="icon">
              <Icon />
            </ItemMedia>
            <ItemContent>
              <ItemTitle className="text-base">{label}</ItemTitle>
              <ItemDescription>{sub}</ItemDescription>
            </ItemContent>
            <ItemActions>
              <ChevronRight className="text-muted-foreground" />
            </ItemActions>
          </Item>
        ))}
      </ItemGroup>
      <p className="mt-5 text-sm text-muted-foreground">
        Lexi хранит{" "}
        {counts && counts.cards > counts.words ? withCount(counts.cards, CARDS) : withCount(counts?.words ?? 0, WORDS)}{" "}
        и {withCount(counts?.answers ?? 0, ["ответ", "ответа", "ответов"])}{" "}
        {telegram
          ? "на этом устройстве; в облако Telegram уходит только компактный прогресс"
          : "только на этом устройстве"}
        . Регистрация и сервер не нужны.
      </p>
    </Screen>
  );
}
