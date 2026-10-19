import { vi } from "vitest";

type Types = typeof import("../../src/sync/types");
export interface BuildConstants {
  SNAPSHOT_FORMAT: number;
  SUPPORTED_SNAPSHOT_FORMATS: readonly number[];
  WRITE_FORMAT: number;
  DECLARED_READS: readonly number[] | undefined;
}
/** Прежняя сборка с `main`: пишет и читает не выше 5 и поля `reads` не знает. */
export const FORMAT5_BUILD: BuildConstants = {
  SNAPSHOT_FORMAT: 5,
  SUPPORTED_SNAPSHOT_FORMATS: [3, 4, 5],
  WRITE_FORMAT: 5,
  DECLARED_READS: undefined,
};
/** Цель отката: читает 6, но пишет не выше 5 и объявляет чтение без 6. */
export const ROLLBACK_BUILD: BuildConstants = {
  SNAPSHOT_FORMAT: 6,
  SUPPORTED_SNAPSHOT_FORMATS: [3, 4, 5, 6],
  WRITE_FORMAT: 5,
  DECLARED_READS: [3, 4, 5],
};

/**
 * Вторая копия модулей синхронизации с другими константами формата. Синглтоны (`syncEvents`, `lifecycle`)
 * у копий свои: база и транспорт передаются через options.
 */
export async function loadBuild(constants: BuildConstants) {
  vi.resetModules();
  vi.doMock("../../src/sync/types", async (original) => ({ ...(await original<Types>()), ...constants }));
  try {
    const [coordinator, adapter] = await Promise.all([
      import("../../src/sync/coordinator"),
      import("../../src/sync/adapter"),
    ]);
    return { SyncCoordinator: coordinator.SyncCoordinator, kvAdapter: adapter.kvAdapter };
  } finally {
    vi.doUnmock("../../src/sync/types");
  }
}
