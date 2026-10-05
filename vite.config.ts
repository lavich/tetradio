import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { VitePWA } from "vite-plugin-pwa";
import { sentryVitePlugin } from "@sentry/vite-plugin";
import { botName } from "./src/platform/bot-name.ts";
import { renderLanding } from "./src/landing/render.ts";
import { loadLandingData } from "./src/landing/sample.ts";

const base = process.env.BASE_PATH ?? "/";
/** Версия и сборка попадают в метки отчётов о сбоях и в имя релиза; без CI сборка называется `dev`. */
const appVersion = (JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string })
  .version;
const appBuild = (process.env.BUILD_SHA ?? process.env.GITHUB_SHA)?.slice(0, 7) ?? "dev";
/** Имя релиза для отчётов о сбоях — то же значение, что метки `app.version` и `app.build` в событии. */
const release = `tetradio@${appVersion}+${appBuild}`;
/**
 * Карты кода скрытые: без ссылок из бандла и без публикации на сайте. При наличии реквизитов плагин загружает их
 * в сервис учёта ошибок и удаляет `*.map` из `dist`; без токена (проверки pull request, локальная сборка) он не подключается.
 * `SENTRY_DEBUG_IDS=1` подключает его без реквизитов: без загрузки, но с теми же debug ID в чанках, что в deploy.
 */
const sentryUpload =
  (process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT) ||
  process.env.SENTRY_DEBUG_IDS === "1"
    ? [
        sentryVitePlugin({
          authToken: process.env.SENTRY_AUTH_TOKEN,
          org: process.env.SENTRY_ORG,
          project: process.env.SENTRY_PROJECT,
          telemetry: false,
          release: { name: release },
          sourcemaps: { filesToDeleteAfterUpload: ["dist/**/*.map"] },
        }),
      ]
    : [];

const spaFallback = (): Plugin => {
  let outDir = "dist";
  return {
    name: "spa-404",
    apply: "build",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      copyFileSync(path.join(outDir, "app/index.html"), path.join(outDir, "404.html"));
    },
  };
};

/**
 * Лендинг — статичная страница: разметка собирается из контента при сборке и в dev, в браузер идёт только скрипт
 * интерактивности без React. Запуск из Telegram по старому адресу уходит в `app/` до первого кадра.
 */
const landingPage = (): Plugin => {
  let root = process.cwd();
  let env: Record<string, string> = {};
  return {
    name: "landing-page",
    configResolved(config) {
      root = config.root;
      env = config.env as Record<string, string>;
    },
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        if (path.resolve(ctx.filename) !== path.join(root, "index.html")) return html;
        const read = (url: string) => {
          const file = path.join(root, "public", url);
          return existsSync(file) ? readFileSync(file, "utf8") : null;
        };
        const mock = /^[1-9]\d{0,15}$/.test(env.VITE_TELEGRAM_MOCK ?? "");
        const redirect = `<script>(function(){var h=location.hash;if(${mock}||/[#&]tgWebApp(Data|Platform)=/.test(h)){document.documentElement.style.visibility="hidden";location.replace(${JSON.stringify(base)}+"app/"+location.search+h)}})()</script>`;
        return html
          .replace("<head>", `<head>\n    ${redirect}`)
          .replace('<div id="root"></div>', renderLanding(loadLandingData(read), botName(env.VITE_TELEGRAM_BOT)));
      },
    },
  };
};

/** Глубокие адреса Mini App в dev и preview открывают приложение, как `404.html` на GitHub Pages; e2e держит рядом сборку в `/web/`. */
const appFallback = (): Plugin => {
  const rewrite = (req: { url?: string }, _res: unknown, next: () => void) => {
    const url = req.url ?? "";
    const pathname = url.split(/[?#]/)[0]!;
    const page = /^(.*\/)app\/[^.]*$/.exec(pathname);
    if (page) req.url = `${page[1]}app/index.html${url.slice(pathname.length)}`;
    next();
  };
  return {
    name: "app-fallback",
    configureServer(server) {
      server.middlewares.use(rewrite);
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewrite);
    },
  };
};

/** HTTPS-туннель для Mini App бота разработки: разрешается только конкретный hostname из переменной окружения. */
const tunnelHost = process.env.TUNNEL_HOST;

export default defineConfig({
  base,
  server: { allowedHosts: tunnelHost ? [tunnelHost] : undefined },
  define: { __APP_VERSION__: JSON.stringify(appVersion), __APP_BUILD__: JSON.stringify(appBuild) },
  // Карты кода нужны только для загрузки в сервис: без реквизитов их нет и в dist, с реквизитами плагин удаляет их после загрузки.
  // Service worker собирается позже этого удаления, поэтому его карты выключены отдельно (`workbox.sourcemap:false`).
  build: {
    sourcemap: sentryUpload.length ? "hidden" : false,
    // Лендинг на главной и Mini App в `app/` — отдельные страницы: лендинг не грузит код приложения.
    rollupOptions: {
      input: {
        landing: fileURLToPath(new URL("./index.html", import.meta.url)),
        app: fileURLToPath(new URL("./app/index.html", import.meta.url)),
      },
    },
  },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  plugins: [
    react(),
    tailwindcss(),
    landingPage(),
    spaFallback(),
    appFallback(),
    ...sentryUpload,
    VitePWA({
      registerType: "prompt",
      scope: `${base}app/`,
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Τετράδιο — курс греческого A2",
        short_name: "Τετράδιο",
        description: "Курс новогреческого A0 → A2",
        lang: "ru",
        theme_color: "#eef1f7",
        background_color: "#f9fafc",
        display: "standalone",
        start_url: `${base}app/`,
        scope: `${base}app/`,
        icons: [
          { src: `${base}icon.svg`, sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: `${base}icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
          { src: `${base}icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
        ],
      },
      workbox: {
        sourcemap: false,
        clientsClaim: true,
        skipWaiting: false,
        // Шрифты — только наборы символов курса (латиница, кириллица, греческий): Mini App должен открываться без сети.
        globPatterns: ["**/*.{js,css,html,svg,png,webp,json}", "**/*-{latin,cyrillic,greek}-wght-*.woff2"],
        globIgnores: ["**/content/**", "og.png", "icon-512.png"],
        navigateFallback: "app/index.html",
        navigateFallbackDenylist: [/\/content\//],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  // Unit-тесты открывают базу вне Telegram, как сборка с моком (`tetradio-mock-1`).
  test: { include: ["tests/**/*.test.{ts,tsx}"], environment: "node", env: { VITE_TELEGRAM_MOCK: "1" } },
});
