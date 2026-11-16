import { describe, expect, it } from "vitest";
import { importDocument, libraryContents, libraryPage, searchLibrary, type Ctx } from "../src";
import { memoryDb } from "./helpers";

const ctx = (): Ctx => ({ db: memoryDb().db, actor: "import" });
const book = {
  document: "A Made-up Handbook",
  pages: [
    { page: 1, section: "Principles", body: "Progressive overload means doing more over time.\nAdd reps first, then weight." },
    { page: 2, section: "Principles", body: "Rest two to three minutes between heavy sets." },
    { page: 3, section: "Principles", body: "   " },
    { page: 40, section: "FAQ", body: "Q: Should I add cardio?\nA: Keep cardio modest.\nCardio will not kill your gains.\nWatch your recovery." },
  ],
};

describe("the coach's library", () => {
  it("lists what is in it, by chapter", async () => {
    const c = ctx();
    expect(await importDocument(c, book)).toEqual({ document: "A Made-up Handbook", pages: 3 });
    expect(await libraryContents(c.db)).toEqual([
      { document: "A Made-up Handbook", pages: 3, sections: [{ section: "Principles", from_page: 1, to_page: 2 }, { section: "FAQ", from_page: 40, to_page: 40 }] },
    ]);
  });
  it("finds the pages that say every word, best first, and gives the page number", async () => {
    const c = ctx();
    await importDocument(c, book);
    const hits = await searchLibrary(c.db, "Cardio gains");
    expect(hits.map((h) => [h.document, h.page, h.section])).toEqual([["A Made-up Handbook", 40, "FAQ"]]);
    expect(hits[0]!.text).toContain("Cardio will not kill your gains.");
    expect((await searchLibrary(c.db, "weight")).map((h) => h.page)).toEqual([1]);
    expect(await searchLibrary(c.db, "creatine")).toEqual([]); // not covered: it says so by finding nothing
    await expect(searchLibrary(c.db, "?!")).rejects.toThrow(/words to look for/);
  });
  it("reads one page, and loading a document again replaces it", async () => {
    const c = ctx();
    await importDocument(c, book);
    expect((await libraryPage(c.db, "a made-up handbook", 2))!.body).toBe("Rest two to three minutes between heavy sets.");
    await importDocument(c, { document: "A Made-up Handbook", pages: [{ page: 1, body: "Second edition." }] });
    expect((await libraryContents(c.db))[0]!.pages).toBe(1);
    expect(await libraryPage(c.db, "A Made-up Handbook", 40)).toBeNull();
  });
  it("keeps an article's link and hands it back with the article; a book's page has none", async () => {
    const c = ctx();
    await importDocument(c, book);
    await importDocument(c, {
      document: "A Made-up Blog",
      pages: [{ page: 1, section: "How much fiber is enough", url: "https://example.com/blog/fiber", body: "How much fiber is enough\nAim for fiber at every meal." }],
    });
    const hits = await searchLibrary(c.db, "fiber meal", "a made-up blog");
    expect(hits).toEqual([{ document: "A Made-up Blog", page: 1, section: "How much fiber is enough", url: "https://example.com/blog/fiber", text: "How much fiber is enough\nAim for fiber at every meal." }]);
    expect((await libraryPage(c.db, "A Made-up Blog", 1))!.url).toBe("https://example.com/blog/fiber");
    expect((await searchLibrary(c.db, "cardio"))[0]).not.toHaveProperty("url");
    expect((await libraryPage(c.db, "A Made-up Handbook", 1))!.url).toBeNull();
    await expect(importDocument(c, { document: "A Made-up Blog", pages: [{ page: 1, url: "not a link", body: "x" }] })).rejects.toThrow();
    expect((await libraryContents(c.db)).find((d) => d.document === "A Made-up Blog")!.pages).toBe(1); // the refused load changed nothing
  });
  it("sends long articles back whole only while they fit; the rest come as the lines around the words", async () => {
    const c = ctx();
    const long = (n: number) => `Protein at breakfast.\n${"Filler line about nothing.\n".repeat(n)}`;
    await importDocument(c, {
      document: "A Made-up Blog",
      pages: [
        { page: 1, body: `protein protein protein\n${long(800)}` }, // the best match, about 21,000 characters
        { page: 2, body: `protein protein\n${long(300)}` }, // about 8,000: would go past the budget
        { page: 3, body: "protein, in short." },
      ],
    });
    const hits = await searchLibrary(c.db, "protein");
    expect(hits.map((h) => h.page)).toEqual([1, 2, 3]);
    expect(hits[0]!.text.length).toBeGreaterThan(20000); // whole, however long
    expect(hits[1]!.text).toBe("protein protein\nProtein at breakfast.\nFiller line about nothing."); // only the lines around the word
    expect(hits[2]!.text).toBe("protein, in short."); // short enough to fit whole
  });
});
