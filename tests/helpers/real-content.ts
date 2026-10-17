import { inject } from "vitest";
import type { BuiltContent } from "../../content/build";

/** Курс из `content/`, собранный один раз на прогон; медиафайлов в `files` нет. */
export const realContent = (): BuiltContent => inject("realContent");
