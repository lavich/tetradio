import "@fontsource-variable/literata/wght.css";
import "@fontsource-variable/literata/wght-italic.css";
import "@fontsource-variable/manrope";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Landing from "./features/landing/Landing";
import { CONFIGURED_BOT, parseLaunch } from "./platform/launch";
import { dropServiceWorker } from "./platform/service-worker";
import { MOCK_USER } from "./storage/profile";
import "./styles.css";

const base = import.meta.env.BASE_URL;
// Старый адрес Mini App и запуск разработки ведут в приложение с теми же параметрами запуска.
if (parseLaunch(location).kind === "telegram" || MOCK_USER !== null) {
  location.replace(`${base}app/${location.search}${location.hash}`);
} else {
  if ("serviceWorker" in navigator)
    void dropServiceWorker({
      scope: new URL(base, location.origin).href,
      container: navigator.serviceWorker,
      caches: typeof caches === "undefined" ? undefined : caches,
      session: sessionStorage,
      reload: () => location.reload(),
    }).catch((error) => console.warn("Service worker не снят", error));
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <Landing bot={CONFIGURED_BOT} />
    </StrictMode>,
  );
}
