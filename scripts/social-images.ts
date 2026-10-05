import { readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const root = path.resolve(import.meta.dirname, "..");
const font = (file: string) =>
  readFileSync(path.join(root, "node_modules/@fontsource-variable", file)).toString("base64");
const faces = `
@font-face { font-family: "Literata Variable"; font-weight: 200 900; src: url(data:font/woff2;base64,${font("literata/files/literata-cyrillic-wght-normal.woff2")}) format("woff2"); unicode-range: U+0400-045F; }
@font-face { font-family: "Literata Variable"; font-weight: 200 900; src: url(data:font/woff2;base64,${font("literata/files/literata-latin-wght-normal.woff2")}) format("woff2"); unicode-range: U+0000-00FF; }
@font-face { font-family: "Literata Variable"; font-weight: 200 900; src: url(data:font/woff2;base64,${font("literata/files/literata-greek-wght-normal.woff2")}) format("woff2"); unicode-range: U+0370-03FF, U+1F00-1FFF; }
@font-face { font-family: "Literata Variable"; font-style: italic; font-weight: 200 900; src: url(data:font/woff2;base64,${font("literata/files/literata-cyrillic-wght-italic.woff2")}) format("woff2"); unicode-range: U+0400-045F; }
@font-face { font-family: "Manrope Variable"; font-weight: 200 800; src: url(data:font/woff2;base64,${font("manrope/files/manrope-cyrillic-wght-normal.woff2")}) format("woff2"); unicode-range: U+0400-045F; }
@font-face { font-family: "Manrope Variable"; font-weight: 200 800; src: url(data:font/woff2;base64,${font("manrope/files/manrope-latin-wght-normal.woff2")}) format("woff2"); unicode-range: U+0000-00FF; }
`;

const COVERS = ["#2f6d4f", "#b8452b", "#2c4f9e", "#936c15", "#7b3f74", "#1f6f7a"];
const MODULES = [
  ["Γνωριμία", "Знакомство"],
  ["Χώρες και γλώσσες", "Страны и языки"],
  ["Η οικογένεια", "Семья"],
  ["Αριθμοί, ώρα", "Числа, время"],
  ["Η μέρα μου", "Распорядок дня"],
  ["Το σπίτι", "Дом и квартира"],
];

const og = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>${faces}
* { box-sizing: border-box; margin: 0; }
body { width: 1200px; height: 630px; background: #eef1f7; color: #23262c; font-family: "Manrope Variable"; padding: 64px 72px 0; overflow: hidden; }
h1 { font: 700 76px/1.02 "Literata Variable"; letter-spacing: -0.03em; }
h1 em { font-style: italic; font-weight: 500; color: #1f47b8; }
p { font: 400 26px/1.4 "Literata Variable"; margin-top: 22px; color: #3a3f47; }
.url { position: absolute; top: 70px; right: 72px; font: 700 22px "Manrope Variable"; color: #1f47b8; }
.shelf { position: absolute; left: 60px; right: 60px; bottom: 0; display: flex; gap: 16px; align-items: end; padding: 0 12px 14px; }
.shelf::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 14px; background: #c9b79a; }
.book { flex: 0 0 166px; height: 214px; border-radius: 3px 9px 9px 3px; color: #fff; padding: 16px 16px 14px 20px; display: flex; flex-direction: column; justify-content: space-between; box-shadow: 0 8px 12px -8px rgb(0 0 0 / .35), inset 6px 0 0 rgb(0 0 0 / .18); }
.book.out { transform: translateY(-26px); outline: 4px solid #1f47b8; outline-offset: 4px; }
.book b { font: 700 42px/1 "Literata Variable"; }
.book span { display: grid; align-content: start; gap: 3px; padding-top: 10px; border-top: 1px solid rgb(255 255 255 / .3); min-height: 66px; }
.book span span { font: 600 17px/20px "Literata Variable"; border: 0; padding: 0; min-height: 0; }
.book small { font: 13px/16px "Manrope Variable"; color: rgb(255 255 255 / .85); }
</style></head><body>
<div class="url">tetradio.app</div>
<h1>Греческий <em>с нуля</em><br>до экзамена A2</h1>
<p>Курс из 24 модулей в Telegram: уроки, задания<br>с проверкой и разбором ошибок</p>
<div class="shelf">${MODULES.map(
  ([greek, russian], i) =>
    `<div class="book${i === 0 ? " out" : ""}" style="background:${COVERS[i]}"><b>${String(i + 1).padStart(2, "0")}</b><span><span lang="el">${greek}</span><small>${russian}</small></span></div>`,
).join("")}</div>
</body></html>`;

const icon = readFileSync(path.join(root, "public/icon.svg"), "utf8");
const square = (size: number) =>
  `<!doctype html><style>*{margin:0}body{width:${size}px;height:${size}px;background:#f9fafc}svg{display:block;width:${size}px;height:${size}px}</style>${icon.replace(/ rx="44"/, "")}`;

const browser = await chromium.launch();
const shoot = async (html: string, width: number, height: number, file: string) => {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(root, "public", file) });
  await page.close();
  console.log(`public/${file}`);
};
await shoot(og, 1200, 630, "og.png");
await shoot(square(180), 180, 180, "apple-touch-icon.png");
await shoot(square(192), 192, 192, "icon-192.png");
await shoot(square(512), 512, 512, "icon-512.png");
await browser.close();
