import type { Page } from "@playwright/test";

/**
 * Эмуляция официального bridge Telegram для браузерных проверок: события, BackButton, MainButton, HapticFeedback
 * и CloudStorage в памяти страницы. Вызовы записываются в `window.__tg.calls`, облако лежит в `window.__tg.cloud`.
 */
export interface TelegramEmulation {
  platform?: "ios" | "android";
  version?: string;
  scheme?: "light" | "dark";
  theme?: Record<string, string>;
  stableHeight?: number;
  userId?: number;
  cloud?: Record<string, string>;
  bot?: string;
  failAudio?: boolean;
  noCloud?: boolean;
  fullscreen?: boolean;
  safeTop?: number;
  contentTop?: number;
  /** Параметр `startapp` ссылки на бота. */
  startParam?: string;
  /** Идентификатор сессии запуска: Telegram передаёт его не при каждом способе открытия. */
  queryId?: string;
}
/** Клиент без Bot API 8.0 отвергает подписку на события активности. */
const LIFECYCLE_EVENTS = ["activated", "deactivated"];
export const LIGHT = {
  bg_color: "#ffffff",
  text_color: "#000000",
  hint_color: "#999999",
  link_color: "#2481cc",
  button_color: "#2481cc",
  button_text_color: "#ffffff",
  secondary_bg_color: "#f1f1f1",
  section_bg_color: "#ffffff",
};
export const DARK = {
  bg_color: "#17212b",
  text_color: "#f5f5f5",
  hint_color: "#708499",
  link_color: "#6ab3f3",
  button_color: "#5288c1",
  button_text_color: "#ffffff",
  secondary_bg_color: "#232e3c",
  section_bg_color: "#17212b",
};

export const bridgeScript = (options: TelegramEmulation) => {
  const legacyField = parseFloat(options.version ?? "8.0") < 8 ? "" : "isActive:true,";
  return `(()=>{
 const calls=[];
 const cloud=new Map(Object.entries(${JSON.stringify(options.cloud ?? {})}));
 const handlers=new Map();
 const legacy=${parseFloat(options.version ?? "8.0") < 8};
 const on=(name,handler)=>{if(legacy&&${JSON.stringify(LIFECYCLE_EVENTS)}.includes(name))throw new Error('WebAppMethodUnsupported');if(!handlers.has(name))handlers.set(name,new Set());handlers.get(name).add(handler)};
 const off=(name,handler)=>handlers.get(name)?.delete(handler);
 const fire=(name,...args)=>handlers.get(name)?.forEach(handler=>handler(...args));
 const button=name=>({isVisible:false,show(){this.isVisible=true;calls.push(name+'.show')},hide(){this.isVisible=false;calls.push(name+'.hide')},onClick(h){on(name,h)},offClick(h){off(name,h)}});
 const later=(callback,error,value)=>setTimeout(()=>callback&&callback(error,value),0);
 const app={
  initData:'',initDataUnsafe:{user:{id:${options.userId ?? 1001},first_name:'Тест'}},
  version:'${options.version ?? "8.0"}',platform:'${options.platform ?? "ios"}',colorScheme:'${options.scheme ?? "light"}',
  themeParams:${JSON.stringify(options.theme ?? (options.scheme === "dark" ? DARK : LIGHT))},
  isExpanded:${options.fullscreen ? "true" : "false"},isFullscreen:${options.fullscreen ? "true" : "false"},${legacyField}viewportHeight:${options.stableHeight ?? 844},viewportStableHeight:${options.stableHeight ?? 844},
  safeAreaInset:{top:${options.safeTop ?? 0},bottom:0,left:0,right:0},contentSafeAreaInset:{top:${options.contentTop ?? 0},bottom:0,left:0,right:0},
  isVersionAtLeast(v){return parseFloat(this.version)>=parseFloat(v)},
  ready(){calls.push('ready')},expand(){this.isExpanded=true;calls.push('expand')},close(){calls.push('close')},
  openTelegramLink(url){calls.push('link:'+url)},
  onEvent:on,offEvent:off,
  BackButton:button('back'),
  MainButton:Object.assign(button('main'),{text:'',isActive:true,isProgressVisible:false,setText(t){this.text=t},enable(){},disable(){},showProgress(){},hideProgress(){},setParams(p){calls.push('main.setParams:'+JSON.stringify(p))}}),
  HapticFeedback:{impactOccurred(s){calls.push('impact:'+s)},notificationOccurred(t){calls.push('haptic:'+t)},selectionChanged(){calls.push('selection')}},
  ${
    options.noCloud
      ? ""
      : `CloudStorage:{
   setItem(key,value,cb){calls.push('cloud.set:'+key);if(cloud.size>=1024&&!cloud.has(key))return later(cb,'QUOTA');cloud.set(key,value);later(cb,null,true)},
   getItem(key,cb){later(cb,null,cloud.get(key)??'')},
   getItems(keys,cb){const out={};keys.forEach(k=>{if(cloud.has(k))out[k]=cloud.get(k)});later(cb,null,out)},
   removeItem(key,cb){cloud.delete(key);later(cb,null,true)},
   removeItems(keys,cb){keys.forEach(k=>cloud.delete(k));later(cb,null,true)},
   getKeys(cb){later(cb,null,[...cloud.keys()])},
  },`
  }
 };
 window.Telegram={WebApp:app};
 window.__tg={calls,cloud,fire,app,
  setTheme(scheme,params){app.colorScheme=scheme;app.themeParams=params;fire('themeChanged')},
  setViewport(height,stable){app.viewportHeight=height;app.viewportStableHeight=height;fire('viewportChanged',{isStateStable:stable!==false})},
  back(){fire('back')},main(){fire('main')},
  // Сворачивание отдаёт нулевой viewport; возврат присылает только activated.
  deactivate(){app.isActive=false;app.viewportHeight=0;app.viewportStableHeight=0;fire('viewportChanged',{isStateStable:true});fire('deactivated')},
  activate(height){app.isActive=true;app.viewportHeight=height;app.viewportStableHeight=height;fire('activated')},
  setHidden(hidden){Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>hidden?'hidden':'visible'});Object.defineProperty(document,'hidden',{configurable:true,get:()=>hidden});document.dispatchEvent(new Event('visibilitychange'))},
  setFullscreen(on,safeTop,contentTop){app.isFullscreen=on;app.isExpanded=true;app.safeAreaInset={top:safeTop,bottom:0,left:0,right:0};app.contentSafeAreaInset={top:contentTop,bottom:0,left:0,right:0};fire('safeAreaChanged');fire('contentSafeAreaChanged');fire('fullscreenChanged')},
 };
 ${options.failAudio ? `window.HTMLMediaElement.prototype.play=function(){return Promise.reject(new DOMException('NotAllowedError','NotAllowedError'))};` : ""}
})()`;
};

/** Параметры запуска в hash, как их добавляет Telegram; пользователь берётся из tgWebAppData. */
export const launchHash = (options: TelegramEmulation = {}) => {
  const data = new URLSearchParams({
    user: JSON.stringify({ id: options.userId ?? 1001, first_name: "Тест" }),
    auth_date: "1",
    hash: "e2e",
    ...(options.startParam ? { start_param: options.startParam } : {}),
    ...(options.queryId ? { query_id: options.queryId } : {}),
  }).toString();
  return `#tgWebAppData=${encodeURIComponent(data)}&tgWebAppVersion=${options.version ?? "8.0"}&tgWebAppPlatform=${options.platform ?? "ios"}`;
};
export async function openTelegram(page: Page, options: TelegramEmulation = {}, path = "/") {
  await page.addInitScript(bridgeScript(options));
  await page.goto(`${path}${options.bot ? `?bot=${options.bot}` : ""}${launchHash(options)}`);
  await page.waitForSelector("[data-testid=today-title]");
  // Сообщение первого запуска появляется после чтения базы: ждём его и закрываем, если профиль ещё не видел.
  const welcome = page.getByRole("button", { name: /Понятно|Начать с чистого профиля/ });
  if (
    await welcome.waitFor({ state: "visible", timeout: 5000 }).then(
      () => true,
      () => false,
    )
  ) {
    await welcome.click();
    await page.getByRole("alertdialog").waitFor({ state: "hidden" });
  }
}
export const tg = (page: Page) => ({
  calls: () => page.evaluate(() => (window as unknown as { __tg: { calls: string[] } }).__tg.calls),
  cloud: () =>
    page.evaluate(() => Object.fromEntries((window as unknown as { __tg: { cloud: Map<string, string> } }).__tg.cloud)),
  back: () => page.evaluate(() => (window as unknown as { __tg: { back: () => void } }).__tg.back()),
  backVisible: () =>
    page.evaluate(
      () =>
        (window as unknown as { __tg: { app: { BackButton: { isVisible: boolean } } } }).__tg.app.BackButton.isVisible,
    ),
  setTheme: (scheme: "light" | "dark", params: Record<string, string>) =>
    page.evaluate(
      ([scheme, params]) =>
        (window as unknown as { __tg: { setTheme: (s: string, p: unknown) => void } }).__tg.setTheme(scheme, params),
      [scheme, params] as const,
    ),
  setFullscreen: (on: boolean, safeTop: number, contentTop: number) =>
    page.evaluate(
      ([on, safeTop, contentTop]) =>
        (
          window as unknown as { __tg: { setFullscreen: (o: boolean, s: number, c: number) => void } }
        ).__tg.setFullscreen(on, safeTop, contentTop),
      [on, safeTop, contentTop] as const,
    ),
  setViewport: (height: number, stable = true) =>
    page.evaluate(
      ([height, stable]) =>
        (window as unknown as { __tg: { setViewport: (h: number, s: boolean) => void } }).__tg.setViewport(
          height,
          stable,
        ),
      [height, stable] as const,
    ),
  deactivate: () => page.evaluate(() => (window as unknown as { __tg: { deactivate: () => void } }).__tg.deactivate()),
  activate: (height: number) =>
    page.evaluate((h) => (window as unknown as { __tg: { activate: (h: number) => void } }).__tg.activate(h), height),
  setHidden: (hidden: boolean) =>
    page.evaluate(
      (h) => (window as unknown as { __tg: { setHidden: (h: boolean) => void } }).__tg.setHidden(h),
      hidden,
    ),
  /** Тема сменилась, пока Mini App спал: без события themeChanged. */
  silentTheme: (scheme: "light" | "dark", params: Record<string, string>) =>
    page.evaluate(
      ([scheme, params]) => {
        const app = (window as unknown as { __tg: { app: { colorScheme: string; themeParams: unknown } } }).__tg.app;
        app.colorScheme = scheme;
        app.themeParams = params;
      },
      [scheme, params] as const,
    ),
});

/** Дневной лимит новых слов = 0: занятие состоит только из повторений, без экрана знакомства. */
/** Только повторения: предел новых слов принадлежит курсу, поэтому обнуляется у каждого курса профиля. */
export async function onlyReviews(page: Page) {
  await page.evaluate(async () => {
    for (const info of await indexedDB.databases()) {
      if (!info.name?.startsWith("lexi")) continue;
      const database = await new Promise<IDBDatabase>((resolve) => {
        const request = indexedDB.open(info.name!);
        request.onsuccess = () => resolve(request.result);
      });
      if (database.objectStoreNames.contains("courses")) {
        const tx = database.transaction("courses", "readwrite");
        const store = tx.objectStore("courses");
        const all = store.getAll();
        all.onsuccess = () => {
          for (const course of all.result as { newItemsPerDay: number }[]) store.put({ ...course, newItemsPerDay: 0 });
        };
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      }
      database.close();
    }
  });
  await page.goto("/");
  await page.waitForSelector("[data-testid=today-title]");
}
