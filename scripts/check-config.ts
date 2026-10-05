import { loadConfigFromFile } from "vite";

/**
 * Конфиг Vite читается загрузчиком `native`, который Vite собирается сделать загрузчиком по умолчанию: Node выполняет
 * TypeScript без сборки и не угадывает расширения. Импорт без `.ts` в конфиге или в том, что он подтягивает, здесь падает.
 */
try {
  await loadConfigFromFile(
    { command: "build", mode: "production" },
    undefined,
    process.cwd(),
    "silent",
    undefined,
    "native",
  );
  console.log("Конфиг Vite читается загрузчиком native.");
} catch (error) {
  console.error("Конфиг Vite не читается загрузчиком native:", error instanceof Error ? error.message : error);
  process.exit(1);
}
