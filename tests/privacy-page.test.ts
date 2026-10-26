import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REPORT_TAGS } from "../src/reporting/reporting";
import { ALLOWED_EXTRA } from "../src/reporting/scrub";

const pages = { ru: readFileSync("privacy/index.html", "utf8"), en: readFileSync("privacy/en/index.html", "utf8") };
const sections = (html: string) => [...html.matchAll(/<h2 id="([\w-]+)"/g)].map((match) => match[1]);
const codes = (html: string) => new Set([...html.matchAll(/<code>([^<]+)<\/code>/g)].map((match) => match[1]));

describe("политика конфиденциальности", () => {
  it.each(Object.entries(pages))("%s: каждое поле и метка отчёта названы", (_, html) => {
    const named = codes(html);
    for (const field of [...ALLOWED_EXTRA, ...REPORT_TAGS]) expect(named, field).toContain(field);
  });

  it("у русской и английской версий одни и те же разделы", () => {
    expect(sections(pages.ru).length).toBeGreaterThan(10);
    expect(sections(pages.en)).toEqual(sections(pages.ru));
  });

  it.each(Object.entries(pages))("%s: без скриптов и внешних ресурсов", (_, html) => {
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<(img|iframe|audio|video|source|object|embed|form)\b/i);
    const loaded = [...html.matchAll(/<link\b[^>]*>/g)]
      .map(([tag]) => ({ rel: /\brel="([^"]+)"/.exec(tag)?.[1] ?? "", href: /\bhref="([^"]+)"/.exec(tag)?.[1] ?? "" }))
      .filter(({ rel }) => !/^(canonical|alternate)$/.test(rel))
      .map(({ href }) => ["", href] as const);
    for (const [, href] of loaded) expect(href).not.toMatch(/^(https?:)?\/\//);
  });

  it("версии ссылаются друг на друга с hreflang", () => {
    expect(pages.ru).toMatch(/<html lang="ru"/);
    expect(pages.en).toMatch(/<html lang="en"/);
    expect(pages.ru).toMatch(/<a[^>]+hreflang="en"[^>]+href="en\/"|<a[^>]+href="en\/"[^>]+hreflang="en"/);
    expect(pages.en).toMatch(/<a[^>]+hreflang="ru"[^>]+href="\.\.\/"|<a[^>]+href="\.\.\/"[^>]+hreflang="ru"/);
  });

  it("код ставит только метки из REPORT_TAGS", () => {
    const source = ["src/reporting/reporting.ts", "src/reporting/sentry.ts"].map((file) => readFileSync(file, "utf8"));
    const used = new Set(
      source.flatMap((text) => [...text.matchAll(/"((?:app|tg|report)\.[a-z]+)"/g)].map((m) => m[1])),
    );
    for (const tag of used) expect(REPORT_TAGS as readonly string[], tag).toContain(tag);
  });
});
