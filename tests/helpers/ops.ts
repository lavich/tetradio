import type { AppDatabase } from "../../src/storage/db";
import { recordAnswer, type AnswerInput } from "../../src/storage/ops";
import { buildAndCommitMarked } from "../../src/sync/snapshot";

export const submitAnswer = async (input: AnswerInput) => (await recordAnswer(input)).event;
export const buildAndCommit = async (database: AppDatabase, now: Date, versionId: string) =>
  (await buildAndCommitMarked(database, now, versionId)).snapshot;
