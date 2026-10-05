import { describe, expect, it } from "vitest";
import { buildContent } from "../content/build";
import { checkItem } from "../src/domain/course";
import { renderLanding } from "../src/landing/render";
import { loadLandingData, pickSample } from "../src/landing/sample";

const files = (root: string) => {
  const built = new Map(buildContent(root).files.map((file) => [file.path, file.body as string]));
  return (url: string) => built.get(url) ?? null;
};
const course = loadLandingData(files("content"));

describe("пробный урок лендинга", () => {
  it("берёт из настоящего урока 1.1 четыре задания: два выбора и два письма", () => {
    expect(course.modules).toHaveLength(24);
    expect(course.tasks.map((task) => task.block.format)).toEqual(["choice", "text", "choice", "text"]);
    expect(course.tasks.map((task) => task.item.answer[0])).toEqual(["[пу]", "είμαι", "[ла́рнака]", "ευχαριστώ"]);
  });
  it("письмо без тоноса — «почти», с тоносом — верно", () => {
    const [, write] = course.tasks;
    expect(checkItem(write.block, write.item, "ειμαι").status).toBe("almost");
    expect(checkItem(write.block, write.item, "είμαι").status).toBe("correct");
  });
  it("если выбранных заданий в уроке нет, берёт первые задания на выбор и на письмо", () => {
    const tasks = loadLandingData(files("tests/fixtures/course-demo")).tasks;
    expect(tasks.map((task) => task.block.format)).toEqual(["choice", "text", "choice", "text"]);
    expect(pickSample([{ type: "explanation", id: "read-vowels" }])).toEqual([]);
  });
});

describe("статичная страница лендинга", () => {
  const html = renderLanding(course, "TetradioBot");
  it("текст, полка и задания уже в HTML; видно только первое задание", () => {
    expect(html).toContain("Греческий <em>с нуля</em> до экзамена A2");
    expect(html).toContain("Курс из 24 модулей");
    expect(html.match(/class="lp-book[ "]/g)).toHaveLength(24);
    expect(html).toContain('lang="el">Γνωριμία</span>');
    expect(html.match(/data-task="/g)).toHaveLength(4);
    expect(html.match(/data-task="\d+" hidden/g)).toHaveLength(3);
    expect(html).toContain('href="https://t.me/TetradioBot?startapp"');
  });
  it("данные для проверки ответов — только формат, ключ и пояснение", () => {
    const data = JSON.parse(html.match(/<script type="application\/json" id="lp-data">(.*?)<\/script>/s)![1]!);
    expect(data[1]).toEqual({ format: "text", answer: ["είμαι"], explanation: expect.any(String) });
  });
  it("без бота — подсказка вместо ссылки; без каталога — страница без заданий", () => {
    const empty = renderLanding({ modules: [], exam: null, tasks: [] }, null);
    expect(empty).toContain("Найдите бота курса в Telegram");
    expect(empty).not.toContain("t.me/");
    expect(empty).toContain("Пробный урок не загрузился");
    expect(empty.match(/class="lp-book[ "]/g)).toHaveLength(24);
  });
  it("текст из контента экранируется", () => {
    const html = renderLanding({ ...course, modules: [{ ...course.modules[0]!, title: "<b>x</b>" }], tasks: [] }, null);
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});
