import type { AppDatabase } from "../storage/db";
import type { Clock } from "./types";

/** Текст звена: как в облаке (формат 6 — упакованный) или JSON формата 5, если звено собрано здесь. */
export interface VersionText {
  text: string;
  format: number;
}
export const SNAPSHOT_FORMAT_TEXT = 5;
/** Что координатор даёт слиянию: базу, часы, подтверждение обмена, публикацию, установку пакетов и отчёт о сбое. */
export interface ReconcileHost {
  database: AppDatabase;
  now: () => Date;
  confirm: () => Promise<void>;
  publish: (device: string, clock: Clock, resolves: string[]) => Promise<void>;
  installMissing: (packages: string[]) => Promise<void>;
  report: (error: unknown) => void;
}
