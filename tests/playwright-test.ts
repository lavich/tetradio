import { test as base } from "@playwright/test";

export { expect } from "@playwright/test";

/** Системный голос на громкости 0: события речи, по которым судят тесты, остаются, а звука нет. */
const MUTE_SPEECH = `(() => {
  const synth = window.speechSynthesis;
  if (!synth) return;
  const speak = synth.speak.bind(synth);
  synth.speak = (utterance) => { utterance.volume = 0; speak(utterance); };
})();`;

/** Произношения в автотестах не звучат: голос глушится здесь, файлы — флагом `--mute-audio` в конфигах Playwright. */
export const test = base.extend({
  context: async ({ context }, use) => {
    await context.addInitScript(MUTE_SPEECH);
    await use(context);
  },
});
