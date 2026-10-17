import type { TestProject } from "vitest/node";
import { buildContent, type BuiltContent } from "../../content/build";

declare module "vitest" {
  export interface ProvidedContext {
    realContent: BuiltContent;
  }
}

/** Медиа в воркеры не передаётся: тестам нужны только тексты. */
export default function setup(project: TestProject) {
  const built = buildContent("content");
  project.provide("realContent", { ...built, files: built.files.filter((file) => typeof file.body === "string") });
}
