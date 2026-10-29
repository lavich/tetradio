import { startGraph } from "./bundle-metrics.ts";

export interface Run {
  lcp: number;
  tbt: number;
  weight: number;
}

export interface Budget {
  lcpWarn: number;
  lcpFail: number;
  tbtFail: number;
  weightFail: number;
  lazyWeightFail: number;
}

/**
 * Пороги issue #160: LCP — предупреждение 3 с, падение 4 с; TBT ≤ 200 мс; вес ≤ 450 КиБ ("КБ" в issue читается как КиБ; Lighthouse отдаёт байты).
 * Замер 17.10.2026: LCP 3 455 мс, TBT 0, вес 410 159 байт; ленивые чанки первого экрана — 5 чанков, 32 750 байт передачи.
 * 29.10.2026 предел ленивых чанков 36 000 → 38 000: чанк sync вырос на ≈1,2 КБ от защиты ответов (sync-reliability), грузится после первого кадра.
 */
export const BUDGET: Budget = {
  lcpWarn: 3000,
  lcpFail: 4000,
  tbtFail: 200,
  weightFail: 450 * 1024,
  lazyWeightFail: 38_000,
};

export const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
};

export interface Request {
  url: string;
  resourceType?: string;
  transferSize?: number;
}

/** JS, который первый экран грузит сверх стартового графа из HTML: ленивые чанки, которые нужны сразу. */
export function lazyScripts(requests: Request[], html: string, inDist: (href: string) => string, origin: string) {
  const graph = new Set(startGraph(html, inDist)?.scripts);
  return requests
    .filter((request) => request.resourceType === "Script" && request.url.startsWith(origin))
    .map((request) => ({ path: inDist(new URL(request.url).pathname), bytes: request.transferSize ?? 0 }))
    .filter(({ path }) => !graph.has(path) && path.endsWith(".js"));
}

export function verdict(runs: Run[], lazyBytes: number, budget: Budget = BUDGET) {
  const lcp = median(runs.map((run) => run.lcp));
  const tbt = median(runs.map((run) => run.tbt));
  const weight = median(runs.map((run) => run.weight));
  const warnings: string[] = [];
  const errors: string[] = [];
  if (lcp > budget.lcpFail) errors.push(`LCP ${Math.round(lcp)} мс больше ${budget.lcpFail} мс`);
  else if (lcp > budget.lcpWarn) warnings.push(`LCP ${Math.round(lcp)} мс больше ${budget.lcpWarn} мс`);
  if (tbt > budget.tbtFail) errors.push(`TBT ${Math.round(tbt)} мс больше ${budget.tbtFail} мс`);
  if (weight > budget.weightFail) errors.push(`вес ${Math.round(weight)} байт больше ${budget.weightFail}`);
  if (lazyBytes > budget.lazyWeightFail)
    errors.push(`ленивые чанки первого экрана ${lazyBytes} байт больше ${budget.lazyWeightFail}`);
  return { lcp, tbt, weight, warnings, errors };
}
