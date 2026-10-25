import type { TestProject } from "vitest/node";
import { buildContent, type BuiltContent } from "../../content/build";

declare module "vitest" {
  export interface ProvidedContext {
    realContent: BuiltContent;
  }
}

/** Тесты проверяют контент целиком, в том числе скрытые курсы. Медиа в воркеры не передаётся: нужны только тексты. */
export default function setup(project: TestProject) {
  const built = buildContent("content", { shipHidden: true });
  project.provide("realContent", { ...built, files: built.files.filter((file) => typeof file.body === "string") });
}
