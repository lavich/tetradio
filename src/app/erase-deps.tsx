import { forgetMessages } from "../platform/feedback-send";
import { initPlatform, telegramBridge } from "../platform/platform";
import { db } from "../storage/db";
import { clearErase } from "../storage/erase-marker";
import type { EraseDeps } from "../storage/erase";
import { currentProfile } from "../storage/profile";
import { loadSync } from "./deferred";
import { ErasingScreen } from "./ErasingScreen";
import { showStatic } from "./root";

const restart = () => location.replace(`${import.meta.env.BASE_URL}app/`);

export const eraseDeps = (): EraseDeps => ({
  database: db,
  profile: currentProfile(),
  bridge: telegramBridge,
  sync: () => loadSync().then((module) => module.sync),
  forget: () => forgetMessages(),
  showErasing: (message) => showStatic(<ErasingScreen message={message} />),
  reload: restart,
});

export const startupEraseDeps = () => ({
  ...eraseDeps(),
  ready: () => initPlatform(),
  showChoice: () =>
    showStatic(
      <ErasingScreen
        message="Облако Telegram недоступно — удаление не завершено. Проверьте сеть и повторите."
        onRetry={() => location.reload()}
        onCancel={() => {
          clearErase(db.name);
          restart();
        }}
      />,
    ),
});
