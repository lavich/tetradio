import type { Page } from "@playwright/test";
import { addDays } from "../../src/domain/learning";
import { isoWeekday } from "../../src/domain/schedule";

/** Отказ хранилища как у WebKit после сна: чтение IndexedDB бросает `UnknownError` до следующего `indexedDB.open` (или навсегда). */
export async function breakStorage(page: Page, permanent = false) {
  await page.evaluate((permanent) => {
    const restore: (() => void)[] = [];
    const fail = () => {
      throw new DOMException(
        "Attempt to get a record from database without an in-progress transaction",
        "UnknownError",
      );
    };
    const patch = (proto: object, names: string[]) =>
      names.forEach((name) => {
        const original = (proto as Record<string, unknown>)[name];
        if (typeof original !== "function") return;
        (proto as Record<string, unknown>)[name] = fail;
        restore.push(() => {
          (proto as Record<string, unknown>)[name] = original;
        });
      });
    const READS = ["get", "getKey", "getAll", "getAllKeys", "count", "openCursor", "openKeyCursor"];
    patch(IDBObjectStore.prototype, READS);
    patch(IDBIndex.prototype, READS);
    // eslint-disable-next-line typescript/unbound-method -- сохранённый метод вызывается через .call при монкипатче
    const open = IDBFactory.prototype.open;
    const marker = window as unknown as { __reopened?: number };
    IDBFactory.prototype.open = function (this: IDBFactory, ...args: [string, number?]) {
      marker.__reopened = (marker.__reopened ?? 0) + 1;
      if (!permanent) {
        restore.forEach((undo) => undo());
        IDBFactory.prototype.open = open;
      }
      return open.apply(this, args);
    };
  }, permanent);
}

export interface DuePlan {
  wordId: string;
  tested: ("recall" | "recognition" | "assembly" | "spelling")[];
  audio?: boolean;
}
/** Готовим очередь прямо в IndexedDB: сроки, история навыков и аудиофайл для аудирования. */
export async function seedQueue(page: Page, plan: DuePlan[], databaseName = "lexi") {
  await page.evaluate(
    async ([plan, databaseName]) => {
      const open = () =>
        new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open(databaseName);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      const database = await open();
      const due = new Date(Date.now() - 2 * 86400000);
      const tx = database.transaction(["cardStates", "events", "assets", "words"], "readwrite");
      const states = tx.objectStore("cardStates"),
        events = tx.objectStore("events"),
        assets = tx.objectStore("assets"),
        words = tx.objectStore("words");
      const key = (wordId: string) => JSON.stringify(["word", wordId]);
      for (const entry of plan) {
        states.put({
          unitKey: key(entry.wordId),
          ref: { kind: "word", id: entry.wordId },
          version: 1,
          introducedAt: new Date(Date.now() - 10 * 86400000).toISOString(),
          card: {
            due,
            stability: 2.5,
            difficulty: 5,
            elapsed_days: 2,
            scheduled_days: 2,
            reps: 3,
            lapses: 0,
            state: 2,
            learning_steps: 0,
            last_review: new Date(Date.now() - 4 * 86400000),
          },
        });
        entry.tested.forEach((type, index) => {
          const at = new Date(Date.now() - (9 - index) * 86400000).toISOString();
          events.put({
            id: `seed-${entry.wordId}-${index}-${type}`,
            sessionId: "seed",
            itemId: `seed-${entry.wordId}-${index}-${type}`,
            ref: { kind: "word", id: entry.wordId },
            unitKey: key(entry.wordId),
            snapshot: { greek: "", russian: "" },
            type,
            mode: "scheduled",
            rating: 3,
            correct: true,
            answer: "",
            createdAt: at,
            localDate: at.slice(0, 10),
            responseTimeMs: 1000,
          });
        });
        if (entry.audio) {
          const wave = new Uint8Array(44);
          const view = new DataView(wave.buffer);
          for (const [offset, text] of [
            [0, "RIFF"],
            [8, "WAVE"],
            [12, "fmt "],
            [36, "data"],
          ] as [number, string][])
            [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
          view.setUint32(4, 36, true);
          view.setUint32(16, 16, true);
          view.setUint16(20, 1, true);
          view.setUint16(22, 1, true);
          view.setUint32(24, 8000, true);
          view.setUint32(28, 8000, true);
          view.setUint16(32, 1, true);
          view.setUint16(34, 8, true);
          const id = `snd-${entry.wordId}`;
          assets.put({
            id,
            kind: "audio",
            blob: new Blob([wave], { type: "audio/wav" }),
            mimeType: "audio/wav",
            source: "тест",
            alt: "",
          });
          const request = words.get(entry.wordId);
          request.onsuccess = () => words.put({ ...request.result, audioAssetId: id });
        }
      }
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      database.close();
    },
    [plan, databaseName] as const,
  );
  await page.reload();
  await ready(page);
}
export const ready = (page: Page) => page.waitForSelector("[data-testid=today-title]");
/**
 * Поставка не несёт дат занятий, поэтому сценарию, которому нужны проведённый и ближайший урок,
 * приходится задать расписание курса — ровно так, как это делает пользователь. Первое занятие
 * три дня назад: урок 1.1 закрепляется проведённым при перезагрузке, 1.2 становится ближайшим.
 * `startInDays` сдвигает первое занятие: скриншотам README нужно расписание без прошедших уроков.
 */
export async function useSchedule(page: Page, courseId = "leeke", databaseName = "lexi", startInDays = -3) {
  const today = new Date().toISOString().slice(0, 10);
  const startDate = addDays(today, startInDays);
  const weekdays = [isoWeekday(startDate), isoWeekday(addDays(today, 1))];
  await page.evaluate(
    async ([courseId, databaseName, startDate, weekdays]) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const tx = database.transaction("courses", "readwrite");
      const store = tx.objectStore("courses");
      const current = await new Promise<Record<string, unknown>>((resolve, reject) => {
        const request = store.get(courseId);
        request.onsuccess = () => resolve(request.result as Record<string, unknown>);
        request.onerror = () => reject(request.error);
      });
      store.put({ ...current, schedule: { startDate, weekdays }, updatedAt: new Date().toISOString() });
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      database.close();
    },
    [courseId, databaseName, startDate, weekdays] as const,
  );
  await page.reload();
  await ready(page);
  return { startDate, weekdays };
}
/** Уроки больше не устанавливаются при запуске: открытие урока из каталога загружает его пакет. */
export async function installLessons(page: Page, ids: string[]) {
  for (const id of ids) {
    await page.goto(`/lessons/${id}`);
    await page.getByRole("heading", { name: /^Слова · \d+$/ }).waitFor({ timeout: 20000 });
  }
  await page.goto("/");
  await ready(page);
}

/**
 * Смешанный урок для браузерных проверок: непубликуемая фикстура собирается на стороне Node и кладётся
 * прямо в IndexedDB как установленный пакет — так, как это сделала бы установка из каталога.
 * Слова урока берутся из уже установленных пакетов; выбором `only` можно ограничить состав.
 */
export async function seedMixedLesson(
  page: Page,
  options: {
    lessonId?: string;
    title?: string;
    only?: string[];
    targetDate?: string | null;
    databaseName?: string;
  } = {},
) {
  const { mixedPackage } = await import("../helpers/mixed-fixture");
  const pack = mixedPackage();
  const lessonId = options.lessonId ?? pack.id;
  const items = pack.items
    .filter((item) => !options.only || options.only.includes(item.id))
    .map((item, position) => ({ ...item, position }));
  const payload = {
    lessonId,
    title: options.title ?? pack.lesson.title,
    courseId: pack.courseId,
    version: pack.version,
    schemaVersion: pack.schemaVersion,
    items,
    phrases: pack.phrases.filter((p) => items.some((i) => i.kind === "phrase" && i.id === p.id)),
    targetDate: options.targetDate ?? null,
  };
  await page.evaluate(
    async ([payload, databaseName]) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const now = new Date().toISOString();
      const tx = database.transaction(["lessons", "lessonItems", "phrases", "packages"], "readwrite");
      tx.objectStore("lessons").put({
        id: payload.lessonId,
        courseId: payload.courseId,
        title: payload.title,
        targetDate: payload.targetDate,
        status: "upcoming",
        createdAt: now,
        updatedAt: now,
      });
      for (const item of payload.items)
        tx.objectStore("lessonItems").put({
          lessonId: payload.lessonId,
          unitKey: JSON.stringify([item.kind, item.id]),
          ref: { kind: item.kind, id: item.id },
          position: item.position,
        });
      for (const phrase of payload.phrases)
        tx.objectStore("phrases").put({ ...phrase, createdAt: now, updatedAt: now });
      tx.objectStore("packages").put({
        lessonId: payload.lessonId,
        courseId: payload.courseId,
        version: payload.version,
        schemaVersion: payload.schemaVersion,
        installedAt: now,
        words: [],
        phrases: payload.phrases,
        items: payload.items,
        media: [],
        removed: [],
      });
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      database.close();
    },
    [payload, options.databaseName ?? "lexi"] as const,
  );
  await page.reload();
  await ready(page);
  return payload;
}
/** Дневной предел курса: чтобы в занятие попали именно новые карточки смешанного урока. */
export async function setCourseLimit(page: Page, courseId: string, newItemsPerDay: number, databaseName = "lexi") {
  await page.evaluate(
    async ([courseId, newItemsPerDay, databaseName]) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(databaseName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const tx = database.transaction("courses", "readwrite");
      const store = tx.objectStore("courses");
      const current = await new Promise<Record<string, unknown>>((resolve) => {
        const request = store.get(courseId);
        request.onsuccess = () => resolve(request.result as Record<string, unknown>);
      });
      store.put({ ...current, newItemsPerDay, updatedAt: new Date().toISOString() });
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      database.close();
    },
    [courseId, newItemsPerDay, databaseName] as const,
  );
}
/** Чтение таблицы IndexedDB целиком: только для проверок в тестах. */
/**
 * Греческий системный голос для проверок озвучки: доступность не должна зависеть от набора голосов машины.
 * Реплика подтверждает начало речи событием `onstart` — приложение считает озвучку состоявшейся именно по нему.
 */
export const GREEK_VOICE = `
 const voice={lang:'el-GR',name:'Test Greek',default:true,localService:true,voiceURI:'test'};
 window.__spoken=[];
 window.SpeechSynthesisUtterance=class{constructor(text){this.text=text;this.lang='';this.rate=1;this.voice=null}};
 Object.defineProperty(window,'speechSynthesis',{configurable:true,value:{
  speaking:false,pending:false,
  getVoices:()=>[voice],
  speak(utterance){window.__spoken.push(utterance.text);this.speaking=true;setTimeout(()=>utterance.onstart&&utterance.onstart(),0)},
  cancel(){this.speaking=false},addEventListener(){},removeEventListener(){},
 }});`;
/** Настройки приложения из базы: проверки меняют их напрямую, а не через экран. */
export const setSettings = (page: Page, patch: Record<string, unknown>) =>
  page.evaluate(async (patch) => {
    const database = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open("lexi");
      request.onsuccess = () => resolve(request.result);
    });
    const store = database.transaction("settings", "readwrite").objectStore("settings");
    const current = await new Promise<Record<string, unknown> | undefined>((resolve) => {
      const request = store.get("settings");
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve, reject) => {
      const request = store.put({
        id: "settings",
        timezone: "Asia/Nicosia",
        sessionSize: 20,
        errorReports: true,
        autoSpeak: true,
        ...current,
        ...patch,
      });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    database.close();
  }, patch);

/**
 * Карточки установленных уроков из базы: ожидания интерфейса считаются от каталога,
 * а не вписываются числом — иначе каждое пополнение контента правит e2e.
 */
export async function lessonCards(page: Page): Promise<Record<string, string[]>> {
  const rows = (await readTable(page, "lessonItems")) as { lessonId: string; unitKey: string }[];
  const map: Record<string, string[]> = {};
  for (const row of rows) (map[row.lessonId] ??= []).push(row.unitKey);
  return map;
}
export const readTable = (page: Page, name: string, databaseName = "lexi") =>
  page.evaluate(
    async ([name, databaseName]) => {
      const database = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open(databaseName);
        request.onsuccess = () => resolve(request.result);
      });
      const rows = await new Promise<any[]>((resolve) => {
        const request = database.transaction(name).objectStore(name).getAll();
        request.onsuccess = () => resolve(request.result);
      });
      database.close();
      return rows;
    },
    [name, databaseName] as const,
  );
