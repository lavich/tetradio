import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { copyFileSync, readFileSync } from "node:fs";
import { VitePWA } from "vite-plugin-pwa";
import { sentryVitePlugin } from "@sentry/vite-plugin";

const base = process.env.BASE_PATH ?? "/";
/** Версия и сборка попадают в метки отчётов о сбоях и в имя релиза; без CI сборка называется `dev`. */
const appVersion = (JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string })
  .version;
const appBuild = process.env.GITHUB_SHA?.slice(0, 7) ?? "dev";
/** Имя релиза для отчётов о сбоях — то же значение, что метки `app.version` и `app.build` в событии. */
const release = `lexi@${appVersion}+${appBuild}`;
/**
 * Карты кода скрытые: без ссылок из бандла и без публикации на сайте. При наличии реквизитов плагин загружает их
 * в сервис учёта ошибок и удаляет `*.map` из `dist`; без токена (проверки pull request, локальная сборка) он не подключается.
 */
const sentryUpload =
  process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT
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

const spaFallback = (): Plugin => ({
  name: "spa-404",
  apply: "build",
  closeBundle() {
    copyFileSync("dist/index.html", "dist/404.html");
  },
});

/** HTTPS-туннель для Mini App бота разработки: разрешается только конкретный hostname из переменной окружения. */
const tunnelHost = process.env.TUNNEL_HOST;

export default defineConfig({
  base,
  server: { allowedHosts: tunnelHost ? [tunnelHost] : undefined },
  define: { __APP_VERSION__: JSON.stringify(appVersion), __APP_BUILD__: JSON.stringify(appBuild) },
  // Карты кода нужны только для загрузки в сервис: без реквизитов их нет и в dist, с реквизитами плагин удаляет их после загрузки.
  // Service worker собирается позже этого удаления, поэтому его карты выключены отдельно (`workbox.sourcemap:false`).
  build: { sourcemap: sentryUpload.length ? "hidden" : false },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  plugins: [
    react(),
    tailwindcss(),
    spaFallback(),
    ...sentryUpload,
    VitePWA({
      registerType: "prompt",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Lexi — греческий к каждому занятию",
        short_name: "Lexi",
        description: "Ваш личный тренажёр греческих слов",
        lang: "ru",
        theme_color: "#0d5eaf",
        background_color: "#f7f7f5",
        display: "standalone",
        start_url: base,
        scope: base,
        icons: [{ src: `${base}icon.svg`, sizes: "any", type: "image/svg+xml", purpose: "any" }],
      },
      workbox: {
        sourcemap: false,
        clientsClaim: true,
        skipWaiting: false,
        globPatterns: ["**/*.{js,css,html,svg,png,webp,json}"],
        globIgnores: ["**/content/**"],
        navigateFallbackDenylist: [/\/content\//],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  test: { include: ["tests/**/*.test.{ts,tsx}"], environment: "node" },
});
