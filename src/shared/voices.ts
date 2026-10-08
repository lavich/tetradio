import type { LanguageProfile } from "../domain/language";

const tagOf = (lang: string | undefined) => (lang ?? "").toLowerCase().replace("_", "-");
/** Голоса языка профиля; голос его региона (en-GB для британского курса) — первым. */
export function voicesOf<V extends { lang?: string }>(voices: V[], profile: LanguageProfile): V[] {
  const exact = tagOf(profile.voice);
  const base = exact.split("-")[0];
  const same = voices.filter((voice) => tagOf(voice.lang).split("-")[0] === base);
  return [
    ...same.filter((voice) => tagOf(voice.lang) === exact),
    ...same.filter((voice) => tagOf(voice.lang) !== exact),
  ];
}
