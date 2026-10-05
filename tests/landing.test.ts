import { describe, expect, it } from "vitest";
import { buildContent } from "../content/build";
import { checkItem } from "../src/domain/course";
import { loadLanding, pickSample, SAMPLE_LESSON } from "../src/features/landing/sample";
import type { ContentFetcher } from "../src/content/fetcher";

const content = buildContent("content");
const files = new Map(content.files.map((file) => [file.path, file.body]));
const source: ContentFetcher = {
  json: async (url) => JSON.parse(files.get(url) as string),
  blob: async () => new Blob(),
};

describe("пробный урок лендинга", () => {
  it("берёт из настоящего урока 1.1 четыре задания: два выбора и два письма", async () => {
    const { catalog, tasks } = await loadLanding(source);
    expect(catalog.lessons.some((lesson) => lesson.id === SAMPLE_LESSON)).toBe(true);
    expect(tasks.map((task) => task.block.format)).toEqual(["choice", "text", "choice", "text"]);
    expect(tasks.map((task) => task.item.answer[0])).toEqual(["[пу]", "είμαι", "[ла́рнака]", "ευχαριστώ"]);
  });
  it("письмо без тоноса — «почти», с тоносом — верно", async () => {
    const [, write] = (await loadLanding(source)).tasks;
    expect(checkItem(write.block, write.item, "ειμαι").status).toBe("almost");
    expect(checkItem(write.block, write.item, "είμαι").status).toBe("correct");
  });
  it("пропадающее из урока задание пропускается, а не ломает лендинг", () => {
    expect(pickSample([{ type: "explanation", id: "read-vowels" }])).toEqual([]);
  });
});
