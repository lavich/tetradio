import { expect, test } from "../playwright-test";
import { ready } from "./helpers";

const DEFERRED = /\/assets\/(sync|workbox-window[^/]*|TelegramNotices)-[^/]+\.js/;

test("облако, service worker и диалог конфликта грузятся после первого экрана, а не вместе с ним", async ({ page }) => {
  const requested: string[] = [];
  page.on("request", (request) => {
    if (DEFERRED.test(request.url())) requested.push(request.url().split("/").pop()!);
  });
  await page.goto("/app/");
  await ready(page);
  expect(requested).toEqual([]);
  await expect.poll(() => requested.some((name) => name.startsWith("sync-")), { timeout: 15000 }).toBe(true);
  await expect.poll(() => requested.some((name) => name.startsWith("workbox-window")), { timeout: 15000 }).toBe(true);
});
