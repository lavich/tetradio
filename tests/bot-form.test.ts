import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MAX_BODY, readForm, verifyInitData } from "../bot/form";

const TOKEN = "123456:TEST-token";
const NOW = 1_800_000_000;
const DAY = 24 * 60 * 60;
const USER = String.raw`{"id":42,"first_name":"Мария","username":"maria","photo_url":"https:\/\/t.me\/i\/userpic\/a.svg"}`;

function sign(fields: Record<string, string>, token = TOKEN) {
  const check = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(check).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}
const valid = (fields: Record<string, string> = {}) =>
  sign({ user: USER, auth_date: String(NOW - 60), query_id: "AAE", signature: "c2ln", ...fields });

describe("подпись данных запуска", () => {
  it("верная подпись — пользователь из подписанных данных", async () => {
    expect(await verifyInitData(valid(), TOKEN, NOW)).toMatchObject({ id: 42, first_name: "Мария", username: "maria" });
  });

  it("подпись другим токеном — отказ", async () => {
    expect(await verifyInitData(valid(), "999:OTHER", NOW)).toBeNull();
  });

  it("изменённое поле — отказ", async () => {
    const tampered = new URLSearchParams(valid());
    tampered.set("user", JSON.stringify({ id: 43, first_name: "Мария" }));
    expect(await verifyInitData(tampered.toString(), TOKEN, NOW)).toBeNull();
  });

  it.each([
    ["без hash", () => new URLSearchParams({ user: USER, auth_date: String(NOW) }).toString()],
    ["hash не того формата", () => valid().replace(/hash=[0-9a-f]+/, "hash=zz")],
    ["без user", () => sign({ auth_date: String(NOW) })],
    ["старше 7 суток", () => valid({ auth_date: String(NOW - 7 * DAY - 1) })],
    ["из будущего", () => valid({ auth_date: String(NOW + 120) })],
    ["пустая строка", () => ""],
  ])("%s — отказ", async (_, data) => {
    expect(await verifyInitData(data(), TOKEN, NOW)).toBeNull();
  });

  it("7 суток — ещё годится", async () => {
    expect(await verifyInitData(valid({ auth_date: String(NOW - 7 * DAY) }), TOKEN, NOW)).not.toBeNull();
  });
});

describe("тело формы", () => {
  const body = (fields: Record<string, unknown> = {}) =>
    JSON.stringify({ initData: "x", text: "  Опечатка  ", version: "0.1.0 (abc123)", platform: "ios", ...fields });

  it("текст после trim, необязательные поля по умолчанию", () => {
    expect(readForm(body())).toEqual({
      initData: "x",
      text: "Опечатка",
      version: "0.1.0 (abc123)",
      platform: "ios",
      reportId: null,
      canReply: true,
    });
  });

  it("отчёт и запрет писать; лишние поля игнорируются", () => {
    const form = readForm(body({ reportId: "0123456789abcdef0123456789abcdef", canReply: false, extra: 1 }));
    expect(form).toMatchObject({ reportId: "0123456789abcdef0123456789abcdef", canReply: false });
    expect(form).not.toHaveProperty("extra");
  });

  it.each([
    ["не JSON", "{"],
    ["пустой текст", body({ text: "" })],
    ["текст из пробелов", body({ text: "   " })],
    ["текст длиннее 3000", body({ text: "я".repeat(3001) })],
    ["версия с переводом строки", body({ version: "1\nответить нельзя" })],
    ["платформа длиннее 32", body({ platform: "x".repeat(33) })],
    ["отчёт не того формата", body({ reportId: "abc" })],
    ["без initData", body({ initData: undefined })],
    ["тело больше предела", body({ text: "a".repeat(MAX_BODY) })],
  ])("%s — отказ", (_, raw) => {
    expect(readForm(raw)).toBeNull();
  });

  it("ровно 3000 символов — годится", () => {
    expect(readForm(body({ text: "я".repeat(3000) }))?.text).toHaveLength(3000);
  });
});
