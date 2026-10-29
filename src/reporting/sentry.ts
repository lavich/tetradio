import * as Sentry from "@sentry/react";
import type { CaptureHint, LifecycleCrumb, ReportTags, Sdk, SdkOptions } from "./reporting";
import { OFFLINE_DB } from "./reporting";
import { filterBreadcrumb, scrubEvent } from "./scrub";

/**
 * Тяжёлый чанк: единственное место, где импортируется SDK. Только ошибки — без трассировки, записей сессий и release health;
 * крошки консоли и кликов выключены у источника и дополнительно отсекаются фильтром; PII не отправляется.
 * Недоставленные события ждут в отдельной базе IndexedDB и уходят при следующем запуске с сетью.
 */
const REPLACED = new Set(["BrowserSession", "Breadcrumbs", "Console"]);

function init({ dsn, release, tags }: SdkOptions) {
  Sentry.init({
    dsn,
    release,
    environment: tags.env,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      stackFrameVariables: false,
      frameContextLines: 0,
    },
    sampleRate: 1,
    attachStacktrace: false,
    maxBreadcrumbs: 30,
    initialScope: { tags },
    transport: Sentry.makeBrowserOfflineTransport(Sentry.makeFetchTransport),
    transportOptions: {
      dbName: OFFLINE_DB,
      storeName: "queue",
      maxQueueSize: 30,
      flushAtStartup: true,
    } as Sentry.BrowserOptions["transportOptions"],
    integrations: (defaults) => [
      ...defaults.filter((integration) => !REPLACED.has(integration.name)),
      Sentry.breadcrumbsIntegration({
        dom: false,
        fetch: true,
        xhr: true,
        history: true,
        sentry: false,
      }),
    ],
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (crumb) => filterBreadcrumb(crumb),
  });
}
function capture(error: unknown, { id, category, extra, mechanism }: CaptureHint) {
  Sentry.captureException(error, {
    event_id: id,
    mechanism: { type: mechanism, handled: mechanism === "explicit" },
    captureContext: {
      tags: category ? ({ "report.category": category } satisfies ReportTags) : {},
      extra: { ...(category ? { category } : {}), ...extra },
    },
  });
}
const breadcrumb = (crumb: LifecycleCrumb) => Sentry.addBreadcrumb(crumb);
const close = async () => {
  await Sentry.close(2000);
};

/** Пространство имён модуля само удовлетворяет контракту `Sdk`, который ждёт лёгкий модуль. */
export { init, capture, breadcrumb, close };
const _check: Sdk = { init, capture, breadcrumb, close };
void _check;
