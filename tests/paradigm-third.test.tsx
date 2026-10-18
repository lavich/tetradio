// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { parsePackage } from "../src/content/schema";
import { ParadigmTable } from "../src/shared/VerbForms";
import { realContent } from "./helpers/real-content";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const content = realContent();
const word = (greek: string) => content.words.find((w) => w.greek === greek)!;
const table = (present: string, past: string) => ({ present: present.split(" "), past: past.split(" ") });

describe("таблицы глаголов курса", () => {
  it("у неполных глаголов таблица только из 3-го лица, у безличных таблицы нет", () => {
    for (const greek of ["αρέσω", "υπάρχω", "κοστίζω", "ταιριάζω"]) {
      const paradigm = word(greek).paradigm!;
      expect(paradigm.third, greek).toBe(true);
      expect(paradigm.present, greek).toHaveLength(6);
    }
    for (const greek of ["πρέπει", "βρέχει", "χιονίζει", "φυσάει"]) expect(word(greek).paradigm, greek).toBeUndefined();
    expect(word("ζαλίζομαι").paradigm!.third).toBeUndefined();
  });

  it("сверенные формы новых глаголов", () => {
    const expected: Record<string, ReturnType<typeof table>> = {
      ζω: table("ζω ζεις ζει ζούμε ζείτε ζουν", "έζησα έζησες έζησε ζήσαμε ζήσατε έζησαν"),
      βοηθάω: table(
        "βοηθάω βοηθάς βοηθάει βοηθάμε βοηθάτε βοηθάνε",
        "βοήθησα βοήθησες βοήθησε βοηθήσαμε βοηθήσατε βοήθησαν",
      ),
      βρίσκομαι: table(
        "βρίσκομαι βρίσκεσαι βρίσκεται βρισκόμαστε βρίσκεστε βρίσκονται",
        "βρέθηκα βρέθηκες βρέθηκε βρεθήκαμε βρεθήκατε βρέθηκαν",
      ),
      πλένω: table("πλένω πλένεις πλένει πλένουμε πλένετε πλένουν", "έπλυνα έπλυνες έπλυνε πλύναμε πλύνατε έπλυναν"),
      νομίζω: table(
        "νομίζω νομίζεις νομίζει νομίζουμε νομίζετε νομίζουν",
        "νόμιζα νόμιζες νόμιζε νομίζαμε νομίζατε νόμιζαν",
      ),
      σκέφτομαι: table(
        "σκέφτομαι σκέφτεσαι σκέφτεται σκεφτόμαστε σκέφτεστε σκέφτονται",
        "σκέφτηκα σκέφτηκες σκέφτηκε σκεφτήκαμε σκεφτήκατε σκέφτηκαν",
      ),
      ζητάω: table("ζητάω ζητάς ζητάει ζητάμε ζητάτε ζητάνε", "ζήτησα ζήτησες ζήτησε ζητήσαμε ζητήσατε ζήτησαν"),
    };
    for (const [greek, paradigm] of Object.entries(expected)) expect(word(greek).paradigm, greek).toEqual(paradigm);
  });

  it("клиент принимает third: true и хранит его", () => {
    const pack = content.packages.find((p) => p.words.some((w) => w.greek === "αρέσω"))!;
    const parsed = parsePackage(JSON.parse(JSON.stringify(pack)));
    expect(parsed.words.find((w) => w.greek === "αρέσω")!.paradigm!.third).toBe(true);
  });

  it("клиент не принимает third, кроме true", () => {
    const pack = content.packages.find((p) => p.words.some((w) => w.greek === "αρέσω"))!;
    const broken = JSON.parse(JSON.stringify(pack));
    broken.words.find((w: { greek: string }) => w.greek === "αρέσω").paradigm.third = false;
    expect(() => parsePackage(broken)).toThrow(/third/);
  });
});

describe("таблица «Все формы»", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  const rows = (paradigm: Parameters<typeof ParadigmTable>[0]["paradigm"]) => {
    act(() => root.render(<ParadigmTable paradigm={paradigm} onSay={() => {}} />));
    return [...host.querySelectorAll("tbody tr")].map((row) => row.querySelector("th")!.textContent);
  };

  it("при third показаны только «он, она» и «они»", () => {
    const paradigm = word("αρέσω").paradigm!;
    expect(rows(paradigm)).toEqual(["он, она", "они"]);
    expect(host.textContent).toContain("αρέσει");
    expect(host.textContent).toContain("άρεσαν");
    expect(host.textContent).not.toContain("αρέσουμε");
    expect(host.querySelector("caption")?.textContent).toBe("Только третье лицо: он, она и они");
  });
  it("без third — все шесть лиц", () => {
    expect(rows(word("ζω").paradigm!)).toEqual(["я", "ты", "он, она", "мы", "вы", "они"]);
    expect(host.querySelector("caption")).toBeNull();
  });
});
