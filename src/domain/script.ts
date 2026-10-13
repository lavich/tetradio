import { PROFILES, type LanguageProfile } from "./language.ts";

const CYRILLIC = /[а-яё]/iu;

/** Язык строки без пояснений в скобках и цитат в «»: «Η φίλη της Ιρίνας. (της Ιρίνας — Ирины)» — на языке курса. */
export function scriptOf(text: string, profile: LanguageProfile = PROFILES.el): string | undefined {
  const bare = text.replace(/\([^)]*\)|«[^»]*»/gu, "");
  const target = profile.script.test(bare);
  const russian = CYRILLIC.test(bare);
  return target && russian ? "both" : target ? profile.code : russian ? "ru" : undefined;
}
