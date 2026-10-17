import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";

export interface BundleMetrics {
  initialRaw: number;
  initialGzip: number;
  initialBrotli: number;
  cssRaw: number;
  cssGzip: number;
  precacheBytes: number;
  fontBytes: number;
}

export type BundleLimits = Record<keyof BundleMetrics, number>;

export const METRIC_LABELS: Record<keyof BundleMetrics, string> = {
  initialRaw: "стартовый JS без сжатия",
  initialGzip: "стартовый JS gzip",
  initialBrotli: "стартовый JS brotli",
  cssRaw: "CSS первого экрана без сжатия",
  cssGzip: "CSS первого экрана gzip",
  precacheBytes: "precache",
  fontBytes: "шрифты в precache",
};

export const gzipSize = (data: Buffer) => gzipSync(data, { level: 9 }).length;
export const brotliSize = (data: Buffer) => brotliCompressSync(data).length;

/** Адреса в HTML начинаются с базы сборки (`BASE_PATH`): без неё это путь внутри `dist`. */
export const inDistOf = (base: string) => (href: string) =>
  href.startsWith(base) ? href.slice(base.length) : href.replace(/^\//, "");

export function startGraph(html: string, inDist: (href: string) => string) {
  const entrySrc = html.match(/<script[^>]+type="module"[^>]+src="([^"]+\.js)"/)?.[1];
  if (!entrySrc) return undefined;
  const preloaded = [...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+\.js)"/g)].map((match) =>
    inDist(match[1]!),
  );
  const styles = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+\.css)"/g)].map((match) =>
    inDist(match[1]!),
  );
  return { scripts: [inDist(entrySrc), ...preloaded], styles };
}

export function precacheUrls(serviceWorker: string) {
  return [...serviceWorker.matchAll(/url:"([^"]+)"/g)].map((match) => match[1]!);
}

export function measure(dist: string, base: string): BundleMetrics | undefined {
  const graph = startGraph(readFileSync(join(dist, "app/index.html"), "utf8"), inDistOf(base));
  if (!graph) return undefined;
  const js = Buffer.concat(graph.scripts.map((path) => readFileSync(join(dist, path))));
  const css = Buffer.concat(graph.styles.map((path) => readFileSync(join(dist, path))));
  const precached = precacheUrls(readFileSync(join(dist, "sw.js"), "utf8"));
  const sizeOf = (url: string) => statSync(join(dist, url)).size;
  return {
    initialRaw: js.length,
    initialGzip: graph.scripts.reduce((sum, path) => sum + gzipSize(readFileSync(join(dist, path))), 0),
    initialBrotli: graph.scripts.reduce((sum, path) => sum + brotliSize(readFileSync(join(dist, path))), 0),
    cssRaw: css.length,
    cssGzip: graph.styles.reduce((sum, path) => sum + gzipSize(readFileSync(join(dist, path))), 0),
    precacheBytes: precached.reduce((sum, url) => sum + sizeOf(url), 0),
    fontBytes: precached.filter((url) => url.endsWith(".woff2")).reduce((sum, url) => sum + sizeOf(url), 0),
  };
}

export function overLimits(metrics: BundleMetrics, limits: Partial<BundleLimits>) {
  return (Object.keys(limits) as (keyof BundleMetrics)[])
    .filter((key) => metrics[key] > limits[key]!)
    .map((key) => `${METRIC_LABELS[key]} ${metrics[key]} байт больше предела ${limits[key]}`);
}
