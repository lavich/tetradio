import { suiteConfig } from "./playwright.base.ts";
/**
 * Два курса на одном устройстве — греческий демонстрационный и маленький английский (tests/fixtures/two-courses):
 * свой контент, поэтому свой порт и свой каталог сборки.
 */
export default suiteConfig({
  name: "e2e-courses",
  port: Number(process.env.PLAYWRIGHT_COURSES_PORT ?? 4175),
  build: ["courses", "tests/fixtures/two-courses"],
});
