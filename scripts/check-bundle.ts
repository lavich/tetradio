import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { inDistOf, measure, overLimits, type BundleLimits } from "./bundle-metrics.ts";

/**
 * Проверка сборки после `vite build`: стартовая загрузка не выросла сверх предела и не содержит SDK отчётов
 * о сбоях, SDK лежит в отдельном чанке, а карт кода в `dist` нет — ни без реквизитов загрузки, ни после неё.
 *
 * Меряется весь стартовый граф — модуль из `<script type="module">` вместе с чанками из `<link rel="modulepreload">`:
 * их браузер тянет до первого кадра, и делением одного файла на несколько стартовая загрузка не уменьшается.
 * Предел растёт только вместе с измеренной базой. Замеры одним чанком, пока все экраны грузились сразу:
 * 851 462 байта до отчётов о сбоях, 860 271 на `main` перед карточками трёх видов, 893 732 после них,
 * 902 808 перед разделением маршрутов. После разделения граф — 653 905 байт. На бандле deploy (с debug ID
 * отчётов о сбоях) — 700 168 перед отложенной загрузкой уведомлений и синхронизации, 583 884 после неё.
 * 592 461 с #151 (чанки синхронизации и service worker вне графа).
 * Текущий предел — этот замер плюс запас на лёгкий модуль и экран сбоя.
 * Замер 17.10.2026 бандла deploy (#160): gzip 202 122, brotli 177 271, CSS первого экрана 93 975 (gzip 19 085),
 * precache 1 479 087 из 87 файлов, шрифты в precache 250 952. Пределы — этот замер плюс 4–5% (CSS gzip +10%).
 * Замер 22.10.2026 бандла deploy с BASE_PATH=/ (#272, #273, #275): precache 1 555 725 из 107 файлов, предел 1 625 000 (+4,5%).
 */
const INITIAL_LIMIT = 620_000;
const LIMITS: Partial<BundleLimits> = {
  initialGzip: 210_000,
  initialBrotli: 185_000,
  cssRaw: 100_000,
  cssGzip: 21_000,
  precacheBytes: 1_625_000,
  fontBytes: 265_000,
};
/** Лендинг — статичный HTML со скриптом без React: 18 502 байта при переходе на статичную страницу. */
const LANDING_LIMIT = 40_000;
/** CSS лендинга без утилит приложения: 35 138 байт; со всем CSS приложения было 93 060. */
const LANDING_CSS_LIMIT = 45_000;
/** Облако, диалог конфликта и регистрация service worker грузятся после первого кадра: в стартовом графе их быть не должно. */
const DEFERRED_CHUNK = /(^|\/)(sync|TelegramNotices|workbox-window\.[\w.]+)-[\w-]+\.js$/;
const SDK_MARKER = "sentry.javascript.";
const flag = (name: string) => {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
};
const dist = flag("--dist") ?? "dist";
const jsonPath = flag("--json");
/** Адреса в HTML начинаются с базы сборки (`BASE_PATH`, как в vite.config.ts): без неё это путь внутри `dist`. */
const base = process.env.BASE_PATH ?? "/";
const inDist = inDistOf(base);
const problems: string[] = [];

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
const files = walk(dist);
const maps = files.filter((file) => file.endsWith(".map"));
if (maps.length) problems.push(`карты кода в dist: ${maps.join(", ")}`);

function checkPage(page: string, limit: number) {
  const html = readFileSync(join(dist, page), "utf8");
  const entrySrc = html.match(/<script[^>]+type="module"[^>]+src="([^"]+\.js)"/)?.[1];
  const entryPath = entrySrc && inDist(entrySrc);
  if (!entryPath) problems.push(`в ${page} не найден стартовый модуль`);
  else {
    const preloaded = [...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+\.js)"/g)].map((match) =>
      inDist(match[1]!),
    );
    const initialPaths = [entryPath, ...preloaded];
    const initial = initialPaths.map((path) => ({ path, code: readFileSync(join(dist, path), "utf8") }));
    const size = initial.reduce((sum, chunk) => sum + Buffer.byteLength(chunk.code), 0);
    const entry = initial[0]!.code;
    console.log(
      `${page}: стартовый граф ${initialPaths.length} чанк(ов): ${size} байт (предел ${limit}); из них ${entryPath}: ${Buffer.byteLength(entry)}`,
    );
    if (size > limit) problems.push(`${page}: стартовый граф ${size} байт больше предела ${limit}`);
    const early = initialPaths.filter((path) => DEFERRED_CHUNK.test(path));
    if (early.length) problems.push(`${page}: отложенные чанки попали в стартовый граф: ${early.join(", ")}`);
    const withSdk = initial.filter((chunk) => chunk.code.includes(SDK_MARKER));
    if (withSdk.length)
      problems.push(
        `${page}: SDK отчётов о сбоях попал в стартовый граф: ${withSdk.map((chunk) => chunk.path).join(", ")}`,
      );
    const sdkChunks = files.filter(
      (file) =>
        file.endsWith(".js") &&
        !initialPaths.some((path) => file === join(dist, path)) &&
        readFileSync(file, "utf8").includes(SDK_MARKER),
    );
    const referenced = sdkChunks.filter((file) => entry.includes(file.split("/").pop()!));
    console.log(
      sdkChunks.length
        ? `SDK в отдельном чанке: ${sdkChunks.map((file) => file.replace(`${dist}/`, "")).join(", ")}${referenced.length ? " (подключается из стартового)" : " (без адреса приёма стартовый чанк его не загружает)"}`
        : "SDK в сборке отсутствует",
    );
  }
}
checkPage("app/index.html", INITIAL_LIMIT);
checkPage("index.html", LANDING_LIMIT);

const landingCssLinks = [
  ...readFileSync(join(dist, "index.html"), "utf8").matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+\.css)"/g),
];
if (!landingCssLinks.length) problems.push("в index.html не найдены ссылки на CSS");
const landingCss = landingCssLinks
  .map((match) => statSync(join(dist, inDist(match[1]!))).size)
  .reduce((sum, size) => sum + size, 0);
console.log(`index.html: CSS ${landingCss} байт (предел ${LANDING_CSS_LIMIT})`);
if (landingCss > LANDING_CSS_LIMIT)
  problems.push(`index.html: CSS ${landingCss} байт больше предела ${LANDING_CSS_LIMIT}`);

const metrics = measure(dist, base);
if (metrics) {
  console.log(
    `метрики: ${Object.entries(metrics)
      .map(([key, value]) => `${key} ${value}`)
      .join(", ")}`,
  );
  problems.push(...overLimits(metrics, LIMITS));
  if (jsonPath) writeFileSync(jsonPath, JSON.stringify(metrics, null, 2));
}

const precached = [...readFileSync(join(dist, "sw.js"), "utf8").matchAll(/url:"([^"]+)"/g)].map((match) => match[1]!);
if (!precached.length) problems.push("в sw.js не найден список precache");
const outOfScope = precached.filter((url) => /^(index|404)\.html$|^assets\/landing-/.test(url));
if (outOfScope.length) problems.push(`в precache файлы вне области service worker: ${outOfScope.join(", ")}`);

if (problems.length) {
  console.error(`Проверка сборки не пройдена:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("Проверка сборки пройдена.");
