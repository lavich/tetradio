import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

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
 * Текущий предел — этот замер плюс запас на лёгкий модуль и экран сбоя.
 */
const INITIAL_LIMIT = 700_000;
/** Лендинг — статичный HTML со скриптом без React: 18 502 байта при переходе на статичную страницу. */
const LANDING_LIMIT = 40_000;
const SDK_MARKER = "sentry.javascript.";
const dist = "dist";
/** Адреса в HTML начинаются с базы сборки (`BASE_PATH`, как в vite.config.ts): без неё это путь внутри `dist`. */
const base = process.env.BASE_PATH ?? "/";
const inDist = (href: string) => (href.startsWith(base) ? href.slice(base.length) : href.replace(/^\//, ""));
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

if (problems.length) {
  console.error(`Проверка сборки не пройдена:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log("Проверка сборки пройдена.");
