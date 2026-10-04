import type { AppDatabase } from "../storage/db";
import type { SyncAdapter } from "./adapter";
import { dominates, mergeClocks, sameClock } from "./clock";
import { syncEvents, type SyncEvent } from "./events";
import {
  applySnapshot,
  buildAndCommitMarked,
  clearDirty,
  describeSnapshot,
  hasLocalProgress,
  META,
  parseClock,
  readMeta,
  readSnapshot,
  writeMeta,
  type SnapshotDescription,
} from "./snapshot";
import { SyncError, type SyncErrorKind } from "./transport";
import {
  SNAPSHOT_FORMAT,
  SUPPORTED_SNAPSHOT_FORMATS,
  type Clock,
  type CompactSnapshot,
  type SyncVersionRow,
  type VersionMeta,
} from "./types";
/** Читаемые форматы: текущий и предыдущий; более новый или неизвестный — отказ без записи. */
const readable = (format: number) => (SUPPORTED_SNAPSHOT_FORMATS as readonly number[]).includes(format);

export type SyncPhase = "disabled" | "paused" | "idle" | "syncing" | "synced" | "error" | "conflict";
export interface ConflictBranch {
  id: string;
  device: string;
  label: string;
  createdAt: string;
  local: boolean;
  description: SnapshotDescription;
  snapshot: CompactSnapshot;
  meta: VersionMeta | null;
}
/** `diverged` — независимые изменения здесь и там; `initial` — первое подключение непустой базы; `restored` — после копии; `remote` — конфликт двух других устройств. */
export interface SyncConflict {
  kind: "diverged" | "initial" | "restored" | "remote";
  branches: ConflictBranch[];
}
export interface SyncStatus {
  phase: SyncPhase;
  /** Время последнего подтверждённого обмена, а не гарантия отсутствия новых изменений на другом устройстве. */
  lastConfirmedAt: string | null;
  dirty: boolean;
  error: { kind: SyncErrorKind | "unknown"; message: string } | null;
  conflict: SyncConflict | null;
  keys: { used: number; max: number } | null;
  reason: string | null;
}
export type LockResult = "acquired" | "busy" | "unsupported";
export interface CoordinatorOptions {
  database: AppDatabase;
  adapter: SyncAdapter;
  now?: () => Date;
  /** Подпись устройства для конфликта (платформа Telegram). */
  label?: string;
  /** Один писатель на устройство: другие вкладки пропускают обмен; без API запись приостанавливается. */
  lock?: (run: () => Promise<void>) => Promise<LockResult>;
  online?: () => boolean;
  /** Планировщик повторов; тесты подменяют. */
  schedule?: (run: () => void, delayMs: number) => () => void;
  /** Лечение отказа хранилища: `true` — база переоткрыта, обмен можно повторить; `false` — отказ невылечен. */
  recover?: (error: unknown) => Promise<boolean>;
  retryBaseMs?: number;
}
const FOREIGN_KEEP_MS = 30 * 24 * 60 * 60 * 1000;
export const EXCHANGE_INTERVAL_MS = 2 * 60 * 1000;
const CHANGE_DELAY_MS = 2000;
/** Страховка от бесконечного повтора: сам предел попыток лечения задаёт тот, кто его подключает. */
const MAX_RECOVERIES = 3;
const INITIAL: SyncStatus = {
  phase: "idle",
  lastConfirmedAt: null,
  dirty: false,
  error: null,
  conflict: null,
  keys: null,
  reason: null,
};
const randomDevice = () =>
  Array.from({ length: 8 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");

/**
 * Координатор синхронизации: версии, проверка снимков, конфликты и статусы. Адаптер только читает и публикует
 * версии. Каждое устройство пишет собственные ключи; общий изменяемый указатель не используется.
 */
export class SyncCoordinator {
  private status: SyncStatus = INITIAL;
  private listeners = new Set<() => void>();
  private running: Promise<SyncStatus> | null = null;
  private retryMs: number;
  private cancelRetry: (() => void) | null = null;
  private stopHandlers: (() => void)[] = [];
  private options: Required<Pick<CoordinatorOptions, "now" | "label" | "lock" | "online" | "schedule" | "recover">> &
    CoordinatorOptions;
  constructor(options: CoordinatorOptions) {
    this.options = {
      now: () => new Date(),
      label: "",
      online: () => typeof navigator === "undefined" || navigator.onLine !== false,
      lock: async (run) => {
        await run();
        return "acquired";
      },
      schedule: (run, delay) => {
        const id = setTimeout(run, delay);
        return () => clearTimeout(id);
      },
      recover: async () => false,
      ...options,
    };
    this.retryMs = options.retryBaseMs ?? 30000;
  }
  get adapter() {
    return this.options.adapter;
  }
  setAdapter(adapter: SyncAdapter) {
    this.options.adapter = adapter;
    this.update({ error: null, phase: adapter.capabilities().available ? "idle" : "disabled" });
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getStatus = () => this.status;
  private update(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  async deviceId(): Promise<string> {
    const stored = await readMeta(this.options.database, META.device);
    if (stored) return stored;
    const fresh = randomDevice();
    await writeMeta(this.options.database, META.device, fresh);
    return fresh;
  }
  private async flags() {
    const database = this.options.database;
    return {
      appliedId: await readMeta(database, META.applied),
      clock: parseClock(await readMeta(database, META.clock)),
      dirty: !!(await readMeta(database, META.dirty)),
      restored: await readMeta(database, META.restored),
      lastOk: await readMeta(database, META.lastOk),
    };
  }

  /** Параллельные вызовы объединяются; поводы обмена перечислены в `start`. */
  exchange(): Promise<SyncStatus> {
    if (this.running) {
      // Изменение во время обмена: ещё один заход сразу после текущего.
      this.again = true;
      return this.running;
    }
    this.again = false;
    this.lastStart = this.options.now().getTime();
    this.running = this.run().finally(() => {
      this.running = null;
      if (this.again && this.status.phase !== "error" && this.status.phase !== "conflict") void this.exchange();
    });
    return this.running;
  }
  private again = false;
  private lastStart = -Infinity;
  /**
   * Обмен идёт вне дерева React, поэтому граница восстановления его не прикрывает: отказ хранилища после сна
   * WebView лечится здесь переоткрытием базы и повтором захода. Отчёт о сбое уходит, когда лечение не помогло.
   */
  private async run(): Promise<SyncStatus> {
    this.cancelRetry?.();
    this.cancelRetry = null;
    for (let round = 0; ; round++) {
      try {
        await this.cycle();
        break;
      } catch (error) {
        if (round >= MAX_RECOVERIES || !(await this.options.recover(error))) {
          this.fail(error);
          break;
        }
      }
    }
    return this.status;
  }
  /** Один заход обмена: отказ пробрасывается наверх, где решается — лечить хранилище или сообщать о сбое. */
  private async cycle(): Promise<void> {
    const { adapter } = this.options;
    const flags = await this.flags();
    this.update({ dirty: flags.dirty || !!flags.restored, lastConfirmedAt: flags.lastOk });
    if (!adapter.capabilities().available) {
      this.update({ phase: "disabled", reason: null });
      return;
    }
    if (!this.options.online()) {
      this.update({ phase: "paused", reason: "Нет сети: изменения ждут на устройстве." });
      return;
    }
    let writes = true;
    const lock = await this.options.lock(async () => {
      this.update({ phase: "syncing", error: null, reason: null });
      await this.decide(writes, 0);
    });
    if (lock === "busy") {
      this.update({ phase: "paused", reason: "Синхронизацией занята другая вкладка." });
      return;
    }
    if (lock === "unsupported") {
      // Без блокировки нельзя гарантировать одного писателя: читаем и применяем, но не публикуем.
      writes = false;
      this.update({ phase: "syncing", error: null });
      await this.decide(writes, 0);
    }
  }
  private fail(error: unknown) {
    const kind: SyncErrorKind | "unknown" = error instanceof SyncError ? error.kind : "unknown";
    const message = error instanceof Error ? error.message : "Синхронизация не удалась";
    this.update({ phase: "error", error: { kind, message } });
    this.onFailure?.(error, kind);
    if (kind !== "disabled" && kind !== "format") {
      this.cancelRetry = this.options.schedule(() => {
        void this.exchange();
      }, this.retryMs);
      this.retryMs = Math.min(this.retryMs * 2, 10 * 60 * 1000);
    }
  }

  private async decide(writes: boolean, depth: number): Promise<void> {
    const { adapter, database } = this.options;
    const device = await this.deviceId();
    const flags = await this.flags();
    const listing = await adapter.listPointers();
    this.update({ keys: { used: listing.keys, max: adapter.capabilities().maxKeys } });
    const others = listing.pointers.filter((pointer) => pointer.device !== device);
    const mine = listing.pointers.find((pointer) => pointer.device === device) ?? null;
    let candidates = others.filter((pointer) => !dominates(flags.clock, pointer.clock));
    candidates = candidates.filter(
      (candidate) =>
        !candidates.some(
          (other) =>
            other !== candidate &&
            (other.resolves.includes(candidate.id) ||
              (dominates(other.clock, candidate.clock) && !sameClock(other.clock, candidate.clock))),
        ),
    );
    const never = flags.appliedId === null;
    const local = await hasLocalProgress(database);
    if (!candidates.length) {
      // Восстановленная копия при непустом облаке: выбор между восстановленным и последним облачным состоянием.
      if (flags.restored && listing.pointers.length) {
        const latest = listing.pointers.filter(
          (pointer) =>
            !listing.pointers.some(
              (other) =>
                other !== pointer && dominates(other.clock, pointer.clock) && !sameClock(other.clock, pointer.clock),
            ),
        );
        if (latest.some((pointer) => !readable(pointer.format)))
          throw new SyncError(
            "format",
            "В облаке версия другого формата. Обновите приложение; локальные данные не изменены.",
          );
        const remote: ConflictBranch[] = [];
        for (const pointer of latest) {
          const snapshot = await adapter.readVersion(pointer);
          remote.push({
            id: pointer.id,
            device: pointer.device,
            label: pointer.device === device ? "Это устройство до восстановления" : (pointer.label ?? pointer.device),
            createdAt: pointer.createdAt,
            local: false,
            description: describeSnapshot(snapshot),
            snapshot,
            meta: pointer,
          });
        }
        const snapshot = await this.localSnapshot();
        this.conflict("restored", [
          {
            id: `local-${device}`,
            device,
            label: "Восстановленная копия",
            createdAt: snapshot.createdAt,
            local: true,
            description: describeSnapshot(snapshot),
            snapshot,
            meta: null,
          },
          ...remote,
        ]);
        return;
      }
      if (flags.dirty || flags.restored || (never && local && !mine)) {
        if (!writes) {
          this.update({
            phase: "paused",
            reason:
              "Браузер не поддерживает блокировки вкладок: облачная запись приостановлена, данные сохранены на устройстве.",
          });
          return;
        }
        await this.publish(device, flags.clock, [], [], null);
        if (depth < 1) await this.decide(writes, depth + 1); // поздняя конкурентная запись обнаруживается повторным чтением
        return;
      }
      await this.confirm();
      return;
    }
    if (candidates.some((candidate) => !readable(candidate.format)))
      throw new SyncError(
        "format",
        "В облаке версия другого формата. Обновите приложение или повторите чтение позже; локальные данные не изменены.",
      );
    const remote: ConflictBranch[] = [];
    for (const candidate of candidates) {
      try {
        const snapshot = await adapter.readVersion(candidate);
        remote.push({
          id: candidate.id,
          device: candidate.device,
          label: candidate.label ?? candidate.device,
          createdAt: candidate.createdAt,
          local: false,
          description: describeSnapshot(snapshot),
          snapshot,
          meta: candidate,
        });
      } catch (error) {
        // Поколение убрали во время чтения: перечитываем указатели, а не применяем частичные данные.
        if (error instanceof SyncError && error.kind === "integrity" && depth < 1)
          return this.decide(writes, depth + 1);
        throw error;
      }
    }
    const localBranch = async (): Promise<ConflictBranch> => {
      const snapshot = await this.localSnapshot();
      return {
        id: `local-${device}`,
        device,
        label: "Это устройство",
        createdAt: snapshot.createdAt,
        local: true,
        description: describeSnapshot(snapshot),
        snapshot,
        meta: null,
      };
    };
    if (flags.restored) {
      this.conflict("restored", [await localBranch(), ...remote]);
      return;
    }
    if (never && local) {
      this.conflict("initial", [await localBranch(), ...remote]);
      return;
    }
    // Версия облака без уже опубликованного здесь — расхождение, а не обновление: молча её применять нельзя.
    const ahead = remote.filter((branch) => dominates(branch.meta!.clock, flags.clock));
    if (!flags.dirty && ahead.length === remote.length) {
      if (remote.length === 1) {
        const [branch] = remote;
        const applied = await applySnapshot(
          database,
          branch.snapshot,
          branch.id,
          branch.meta!.clock,
          this.options.now(),
          { ifClean: true },
        );
        // Локальное изменение появилось во время чтения облака: это уже расхождение, решаем заново.
        if (!applied) {
          if (depth < 1) return this.decide(writes, depth + 1);
          this.update({ phase: "idle", dirty: true });
          return;
        }
        await this.confirm();
        await this.installMissing(branch.snapshot.packages);
        return;
      }
      this.conflict("remote", remote);
      return;
    }
    this.conflict("diverged", [await localBranch(), ...remote]);
  }
  private conflict(kind: SyncConflict["kind"], branches: ConflictBranch[]) {
    this.update({ phase: "conflict", conflict: { kind, branches }, error: null });
  }
  private async confirm() {
    const at = this.options.now().toISOString();
    await writeMeta(this.options.database, META.lastOk, at);
    const dirty = !!(await readMeta(this.options.database, META.dirty));
    this.retryMs = this.options.retryBaseMs ?? 30000;
    this.update({ phase: "synced", lastConfirmedAt: at, dirty, conflict: null, error: null, reason: null });
  }

  /** Публикация нового поколения: части, затем указатель; после подтверждения — очистка своих устаревших поколений. */
  private async publish(
    device: string,
    base: Clock,
    mergeWith: Clock[],
    resolves: string[],
    override: CompactSnapshot | null,
  ) {
    const { adapter, database } = this.options;
    const clock = mergeClocks(base, ...mergeWith);
    clock[device] = (clock[device] ?? 0) + 1;
    const id = `${device}-${clock[device]}`;
    const now = this.options.now();
    const { snapshot, mark } = override
      ? { snapshot: override, mark: await readMeta(database, META.dirty) }
      : await buildAndCommitMarked(database, now, id);
    const meta = {
      id,
      device,
      clock,
      createdAt: now.toISOString(),
      format: SNAPSHOT_FORMAT,
      resolves,
      label: this.options.label || undefined,
    };
    try {
      await adapter.publishVersion(meta, snapshot);
    } catch (error) {
      if (!(error instanceof SyncError && error.kind === "limit")) throw error;
      await this.cleanup(device, clock, true);
      await adapter.publishVersion(meta, snapshot);
    }
    await database.transaction("rw", database.meta, async () => {
      await writeMeta(database, META.applied, id);
      await writeMeta(database, META.clock, JSON.stringify(clock));
      await clearDirty(database, mark);
      await writeMeta(database, META.restored, null);
    });
    await this.confirm();
    try {
      await this.cleanup(device, clock, false);
    } catch (error) {
      console.warn("Очистка старых поколений отложена", error);
    }
  }
  /**
   * Уборка облака: свои поколения, кроме опубликованного и сохранённых альтернатив, и указатели других устройств,
   * полностью вошедшие в `applied`, — старше 30 дней или любые при `force`. Их прогресс уже есть на этом устройстве.
   */
  private async cleanup(device: string, applied: Clock, force: boolean) {
    const { adapter, database } = this.options;
    const { pointers } = await adapter.listPointers();
    const protectedIds = new Set((await database.syncVersions.toArray()).map((row) => row.meta.id));
    for (const pointer of pointers) if (pointer.device === device) protectedIds.add(pointer.id);
    const own = (await adapter.listGenerations()).filter((id) => id.startsWith(`${device}-`) && !protectedIds.has(id));
    if (own.length) await adapter.removeGenerations(own);
    const cutoff = this.options.now().getTime() - FOREIGN_KEEP_MS;
    for (const pointer of pointers)
      if (
        pointer.device !== device &&
        dominates(applied, pointer.clock) &&
        (force || Date.parse(pointer.createdAt) < cutoff)
      )
        await adapter.removeDevice(pointer);
    this.update({ keys: { used: (await adapter.room(0, device)).keys, max: adapter.capabilities().maxKeys } });
  }
  private async installMissing(packages: string[]) {
    try {
      const { database } = this.options;
      const installed = new Set((await database.packages.toCollection().primaryKeys()) as string[]);
      const missing = packages.filter((id) => !installed.has(id));
      if (missing.length) this.onMissingPackages?.(missing);
    } catch {
      /* установка пакетов — забота экрана уроков */
    }
  }
  /** Экран подписывается, чтобы догрузить стандартные пакеты, нужные полученному прогрессу. */
  onMissingPackages: ((lessonIds: string[]) => void) | null = null;
  /** Приложение подписывается, чтобы отправить отчёт о сбое синхронизации; координатор сам о сервисе отчётов не знает. */
  onFailure: ((error: unknown, kind: SyncErrorKind | "unknown") => void) | null = null;

  /**
   * Разрешение конфликта целой версией. Отвергнутые ветви сохраняются локально до явного удаления,
   * новая версия отмечает все известные ветви рассмотренными; ответы другой версии не объединяются.
   */
  async resolve(branchId: string): Promise<SyncStatus> {
    // Выбор версии — тоже обмен: не параллельно с фоновым обменом и не в двух вкладках сразу.
    while (this.running) await this.running;
    this.running = (async () => {
      const lock = await this.options.lock(() => this.resolveNow(branchId));
      if (lock === "unsupported") await this.resolveNow(branchId);
      else if (lock === "busy")
        this.update({ reason: "Синхронизацией занята другая вкладка: выберите версию ещё раз чуть позже." });
      return this.status;
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }
  private async resolveNow(branchId: string): Promise<void> {
    const conflict = this.status.conflict;
    if (!conflict) return;
    const chosen = conflict.branches.find((branch) => branch.id === branchId);
    if (!chosen) throw new Error("Версия не найдена");
    const { database } = this.options;
    const device = await this.deviceId();
    const now = this.options.now().toISOString();
    // Локальная ветвь снята при обнаружении конфликта; ответы, данные после него, тоже должны попасть в копию.
    const fresh = chosen.local ? null : await this.localSnapshot();
    const rejected = conflict.branches
      .filter((branch) => branch !== chosen)
      .map((branch) => (branch.local && fresh ? { ...branch, snapshot: fresh } : branch));
    await database.syncVersions.bulkPut(
      rejected.map((branch): SyncVersionRow => ({
        id: branch.id,
        role: "rejected",
        createdAt: now,
        meta: branch.meta ?? {
          id: branch.id,
          device,
          clock: {},
          createdAt: branch.createdAt,
          format: SNAPSHOT_FORMAT,
          parts: 0,
          checksum: "",
          resolves: [],
        },
        snapshot: branch.snapshot,
        note: `Отвергнута при выборе версии ${chosen.label}`,
      })),
    );
    const remote = conflict.branches.filter((branch) => !branch.local);
    const resolves = remote.map((branch) => branch.id);
    const clocks = remote.map((branch) => branch.meta!.clock);
    this.update({ phase: "syncing", conflict: null });
    try {
      const flags = await this.flags();
      if (chosen.local) {
        await this.publish(device, flags.clock, clocks, resolves, null);
      } else {
        await applySnapshot(database, chosen.snapshot, chosen.id, chosen.meta!.clock, this.options.now());
        await this.publish(device, chosen.meta!.clock, clocks, resolves, chosen.snapshot);
        await this.installMissing(chosen.snapshot.packages);
      }
    } catch (error) {
      this.fail(error);
    }
  }
  private localSnapshot() {
    return readSnapshot(this.options.database, this.options.now());
  }
  listStored = () => this.options.database.syncVersions.orderBy("createdAt").reverse().toArray();
  async discardStored(id: string) {
    await this.options.database.syncVersions.delete(id);
  }
  /** Копия альтернативной версии для экспорта перед удалением. */
  async exportStored(id: string): Promise<Blob | null> {
    const row = await this.options.database.syncVersions.get(id);
    return row
      ? new Blob([JSON.stringify({ kind: "tetradio-sync-version", meta: row.meta, snapshot: row.snapshot })], {
          type: "application/json",
        })
      : null;
  }

  /**
   * Автоматические поводы обмена: открытие и возврат, сеть, окончание занятия, сворачивание и, без занятия,
   * прочие изменения — не чаще раза в `EXCHANGE_INTERVAL_MS`. Ответы занятия копятся на устройстве до его конца.
   * Ручной повтор — `exchange()`.
   */
  start() {
    this.stop();
    let pending: (() => void) | null = null;
    const cancel = () => {
      pending?.();
      pending = null;
    };
    const now = () => this.options.now().getTime();
    const soon = () => {
      if (pending) return;
      const wait = Math.max(CHANGE_DELAY_MS, this.lastStart + EXCHANGE_INTERVAL_MS - now());
      pending = this.options.schedule(() => {
        pending = null;
        void this.exchange();
      }, wait);
    };
    const flush = () => {
      cancel();
      void this.exchange();
    };
    const hidden = async () => {
      if (pending || (await readMeta(this.options.database, META.dirty))) flush();
    };
    const visibility = () => {
      if (document.visibilityState === "visible") void this.exchange();
      else void hidden();
    };
    const pagehide = () => void hidden();
    const changed = (event: SyncEvent) => {
      if (!this.status.dirty) this.update({ dirty: true });
      if (event === "changed") soon();
      else if (event !== "answered") flush();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("online", flush);
    const off = syncEvents.on(changed);
    this.stopHandlers = [
      () => document.removeEventListener("visibilitychange", visibility),
      () => window.removeEventListener("pagehide", pagehide),
      () => window.removeEventListener("online", flush),
      off,
      cancel,
    ];
    void this.exchange();
  }
  stop() {
    this.stopHandlers.forEach((handler) => handler());
    this.stopHandlers = [];
    this.cancelRetry?.();
    this.cancelRetry = null;
  }
}

/** Web Locks: одна вкладка пишет, остальные пропускают; без API — запись приостанавливается. */
export const webLock =
  (name: string) =>
  async (run: () => Promise<void>): Promise<LockResult> => {
    if (typeof navigator === "undefined" || !navigator.locks) return "unsupported";
    let result: LockResult = "busy";
    await navigator.locks.request(name, { ifAvailable: true }, async (lock) => {
      if (lock) {
        result = "acquired";
        await run();
      }
    });
    return result;
  };
