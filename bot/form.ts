import type { Person } from "./texts";

export const MAX_TEXT = 3000;
export const MAX_BODY = 16 * 1024;
const MAX_AGE = 7 * 24 * 60 * 60;
const FIELD = /^[\w.+() -]{1,32}$/;
const REPORT_ID = /^[0-9a-f]{32}$/;
const HASH = /^[0-9a-f]{64}$/;

export interface FormBody {
  initData: string;
  text: string;
  version: string;
  platform: string;
  reportId: string | null;
  canReply: boolean;
}

export function readForm(raw: string): FormBody | null {
  if (raw.length > MAX_BODY) return null;
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!body || typeof body !== "object") return null;
  const { initData, version, platform, reportId, canReply } = body;
  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (typeof initData !== "string" || !initData) return null;
  if (!text || text.length > MAX_TEXT) return null;
  if (typeof version !== "string" || !FIELD.test(version)) return null;
  if (typeof platform !== "string" || !FIELD.test(platform)) return null;
  if (reportId !== undefined && reportId !== null && (typeof reportId !== "string" || !REPORT_ID.test(reportId)))
    return null;
  return {
    initData,
    text,
    version,
    platform,
    reportId: typeof reportId === "string" ? reportId : null,
    canReply: canReply !== false,
  };
}

export function readInitData(raw: string): string | null {
  if (raw.length > MAX_BODY) return null;
  try {
    const body = JSON.parse(raw) as { initData?: unknown } | null;
    return typeof body?.initData === "string" && body.initData ? body.initData : null;
  } catch {
    return null;
  }
}

const encoder = new TextEncoder();
const hmacKey = (secret: BufferSource, usage: KeyUsage) =>
  crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, [usage]);

export async function verifyInitData(initData: string, token: string, nowSeconds: number): Promise<Person | null> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash || !HASH.test(hash)) return null;
  params.delete("hash");
  const check = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(encoder.encode("WebAppData"), "sign"),
    encoder.encode(token),
  );
  const signature = Uint8Array.from(hash.match(/../g)!, (pair) => parseInt(pair, 16));
  const valid = await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), signature, encoder.encode(check));
  if (!valid) return null;

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || nowSeconds - authDate > MAX_AGE || authDate - nowSeconds > 60) return null;
  try {
    const user = JSON.parse(params.get("user") ?? "") as Person;
    return typeof user?.id === "number" ? user : null;
  } catch {
    return null;
  }
}

export type WaitlistBody =
  { initData: string; action: "forget" } | { initData: string; action: "status" | "join" | "leave"; course: string };

export function readWaitlist(raw: string, courses: string[]): WaitlistBody | null {
  const initData = readInitData(raw);
  if (!initData) return null;
  const { action, course } = JSON.parse(raw) as { action?: unknown; course?: unknown };
  if (action === "forget") return { initData, action };
  if (action !== "status" && action !== "join" && action !== "leave") return null;
  return typeof course === "string" && courses.includes(course) ? { initData, action, course } : null;
}
