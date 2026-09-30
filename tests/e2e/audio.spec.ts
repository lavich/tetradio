import { expect, test } from "@playwright/test";
import { installLessons } from "./helpers";

/** Голоса в headless-браузере нет, поэтому подставляем свой и проверяем, что именно уходит в синтез. */
const stubVoice = `
 const voice={lang:'el-GR',name:'Test Greek',default:true,localService:true,voiceURI:'test'};
 window.__spoken=[];
 window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;this.lang='';this.rate=1;this.voice=null}};
 Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{
  getVoices:()=>[voice],
  speak:utterance=>window.__spoken.push({text:utterance.text,lang:utterance.lang,rate:utterance.rate}),
  cancel(){},addEventListener(){},removeEventListener(){},
 }});
`;

test("слово и пример употребления озвучиваются системным греческим голосом", async ({ page }) => {
  await page.addInitScript(stubVoice);
  await page.goto("/");
  await page.waitForSelector("[data-testid=today-title]");
  await installLessons(page, ["lesson-1-2"]);
  await page.getByRole("navigation").getByRole("link", { name: "Слова" }).click();
  await page.getByRole("searchbox").fill("σπίτι");
  await page.getByRole("link", { name: /το σπίτι/ }).click();

  await page.getByRole("button", { name: "Послушать слово" }).click();
  await page.getByRole("button", { name: "Послушать предложение" }).click();
  const spoken = await page.evaluate(
    () => (window as unknown as { __spoken: { text: string; lang: string; rate: number }[] }).__spoken,
  );
  expect(spoken.map((item) => item.text)).toEqual(["το σπίτι", "Το σπίτι μας είναι μεγάλο."]);
  expect(spoken.every((item) => item.lang === "el-GR")).toBe(true);
  expect(spoken[1].rate).toBeLessThan(spoken[0].rate); // предложение читается медленнее слова
});

test("без греческого голоса озвучка предложения выключена и объясняет причину", async ({ page }) => {
  await page.addInitScript(`Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{
  getVoices:()=>[],speak(){},cancel(){},addEventListener(){},removeEventListener(){},
 }});`);
  await page.goto("/");
  await page.waitForSelector("[data-testid=today-title]");
  await installLessons(page, ["lesson-1-2"]);
  await page.goto("/words");
  await page.getByRole("searchbox").fill("σπίτι");
  await page.getByRole("link", { name: /το σπίτι/ }).click();
  await expect(page.getByRole("button", { name: /Озвучка предложения недоступна/ })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Озвучка недоступна" })).toBeDisabled();
});
