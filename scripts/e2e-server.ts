import { spawn, spawnSync } from "node:child_process";
import { cpSync, rmSync } from "node:fs";
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
const vite = (args: string[], extra: Record<string, string> = {}) => {
  const run = spawnSync("npx", ["vite", ...args], { stdio: "inherit", env: { ...env, ...extra } });
  if (run.status !== 0) process.exit(run.status ?? 1);
};
vite(["build", "--outDir", outDir], { VITE_TELEGRAM_MOCK: "1" });
// Вариант для GitHub Pages — без мока, даже если он задан в окружении разработчика.
if (flags.includes("--web"))
  vite(["build", "--outDir", join(outDir, "web")], { BASE_PATH: "/web/", VITE_TELEGRAM_MOCK: "" });

const serve = ["vite", "preview", "--outDir", outDir, "--host", "0.0.0.0", "--port", port, "--strictPort"];
const preview = spawn("npx", serve, { stdio: "inherit", env });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => preview.kill(signal));
preview.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
