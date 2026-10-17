import { suiteConfig } from "./playwright.base.ts";
/**
 * Экраны курса из модулей — на демонстрационном курсе (tests/fixtures/course-demo), отдельно от фикстуры механик:
 * у сборок разный контент, поэтому свой порт и свой каталог сборки.
 */
export default suiteConfig({
  name: "e2e-course",
  port: Number(process.env.PLAYWRIGHT_COURSE_PORT ?? 4174),
  build: ["course", "tests/fixtures/course-demo"],
  web: true,
});
