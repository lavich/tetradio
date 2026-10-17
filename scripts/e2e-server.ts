import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { writeContent } from "../content/build.ts";

/** Свой каталог на конфиг: общий `public/` прогон не трогает, иначе подменил бы курс dev-сервера, а конфиги гонялись бы. */
const [name, fixture, port, ...flags] = process.argv.slice(2);
if (!name || !fixture || !port) throw new Error("e2e-server: нужны имя, фикстура и порт");
const dir = join(".e2e", name);
const publicDir = join(dir, "public");
const outDir = join(dir, "dist");

rmSync(dir, { recursive: true, force: true });
cpSync("public", publicDir, { recursive: true, filter: (src) => src !== join("public", "content") });
writeContent(publicDir, fixture);

const env = { ...process.env, PUBLIC_DIR: publicDir };
const children = new Set<ChildProcess>();
const stop = (code: number) => {
  for (const child of children) child.kill();
  process.exit(code);
};
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => stop(1));
const vite = (args: string[], extra: Record<string, string> = {}) =>
  new Promise<void>((resolve) => {
    const run = spawn("npx", ["vite", ...args], { stdio: "inherit", env: { ...env, ...extra } });
    children.add(run);
    run.on("exit", (code) => (code === 0 ? resolve() : stop(code ?? 1)));
  });
// Вариант для GitHub Pages — без мока, даже если он задан в окружении разработчика. Собирается рядом, а не в `dist/web`:
// сборка `dist` очищает каталог и стёрла бы вложенный вариант.
const webTmp = join(dir, "web-tmp");
await Promise.all([
  vite(["build", "--outDir", outDir], { VITE_TELEGRAM_MOCK: "1" }),
  flags.includes("--web")
    ? vite(["build", "--outDir", webTmp], { BASE_PATH: "/web/", VITE_TELEGRAM_MOCK: "" })
    : undefined,
]);
if (flags.includes("--web")) renameSync(webTmp, join(outDir, "web"));

const serve = ["vite", "preview", "--outDir", outDir, "--host", "0.0.0.0", "--port", port, "--strictPort"];
const preview = spawn("npx", serve, { stdio: "inherit", env });
children.clear();
children.add(preview);
preview.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
