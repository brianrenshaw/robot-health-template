// library.ts
// The coach's reference library: the text of the sources the owner trusts, one row per page.
//   - Books he supplied (a program's handbook, a training or nutrition book): a row is a page
//     of the book.
//   - Articles from a website he trusts (a diet coach's blog, say): a row is one
//     article. Its title is the `section`, its link is the `url`, and its "page" is only its
//     place in the list, oldest first.
//
// Why it exists: the coach should say what the source actually wrote, with the page or the
// link, and say so when the library does not cover something, rather than produce a plausible
// answer from memory.
//
// The text is copyrighted. It is loaded into the database by scripts/import-library.ts and is
// never committed to the repository. It is reference material, not a health record, so loading
// a document again replaces its pages.

import { z } from "zod";
import { InputError, recordAudit, type Ctx } from "./audit";
import type { Db } from "./db";

export interface LibraryPage {
  id: string;
  document: string;
  page: number;
  section: string | null;
  /** Where an article is on the web. Null for a page of a book. */
  url: string | null;
  body: string;
}

export const documentImportSchema = z.object({
  document: z.string().trim().min(1).max(200),
  pages: z.array(z.object({ page: z.number().int().min(0).max(5000), section: z.string().trim().max(200).nullish(), url: z.string().url().max(500).nullish(), body: z.string().max(60000) })).min(1),
});

/** Load a document, replacing any pages of the same document already there. Empty pages are skipped. */
export async function importDocument(ctx: Ctx, input: unknown): Promise<{ document: string; pages: number }> {
  const data = documentImportSchema.parse(input);
  const pages = data.pages.filter((p) => p.body.trim().length > 0);
  if (new Set(pages.map((p) => p.page)).size !== pages.length) throw new InputError("Two pages have the same number. Nothing was loaded.");
  const before = await ctx.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM library_pages WHERE document = ?", [data.document]);
  await ctx.db.run("DELETE FROM library_pages WHERE document = ?", [data.document]);
  for (const p of pages) {
    await ctx.db.run("INSERT INTO library_pages (id, document, page, section, url, body) VALUES (?, ?, ?, ?, ?, ?)", [
      crypto.randomUUID(), data.document, p.page, p.section ?? null, p.url ?? null, p.body.trim(),
    ]);
  }
  await recordAudit(ctx, { table: "library_pages", rowId: data.document, before: before?.n ? { pages: before.n } : null, after: { pages: pages.length } });
  return { document: data.document, pages: pages.length };
}

/** What is in the library: each document, its chapters and the pages they cover. */
export async function libraryContents(db: Db): Promise<{ document: string; pages: number; sections: { section: string; from_page: number; to_page: number }[] }[]> {
  const rows = await db.all<{ document: string; section: string | null; from_page: number; to_page: number; n: number }>(
    "SELECT document, section, MIN(page) AS from_page, MAX(page) AS to_page, COUNT(*) AS n FROM library_pages GROUP BY document, section ORDER BY document, from_page",
  );
  const out = new Map<string, { document: string; pages: number; sections: { section: string; from_page: number; to_page: number }[] }>();
  for (const r of rows) {
    const doc = out.get(r.document) ?? { document: r.document, pages: 0, sections: [] };
    doc.pages += r.n;
    if (r.section) doc.sections.push({ section: r.section, from_page: r.from_page, to_page: r.to_page });
    out.set(r.document, doc);
  }
  return [...out.values()];
}

/** One page, by document and printed page number. */
export async function libraryPage(db: Db, document: string, page: number): Promise<LibraryPage | null> {
  return db.first<LibraryPage>("SELECT * FROM library_pages WHERE lower(document) = lower(?) AND page = ?", [document, page]);
}

export interface LibraryHit {
  document: string;
  page: number;
  section: string | null;
  /** The article's link, when the page is an article from the web. Left out for a book. */
  url?: string;
  /** The whole page for the best matches; the lines around the words for the rest. */
  text: string;
}

/** About how much text the whole pages of one search may add up to. Three book pages fit easily; articles are longer. */
const WHOLE_PAGES_BUDGET = 25000;

/**
 * Find the pages that mention every word asked for, best first (the page that says the words
 * most often). The top three come back whole, as long as together they stay within
 * WHOLE_PAGES_BUDGET characters (the first always does: a long article can use it up by itself);
 * the rest, up to ten in all, come back as the lines around the words. Any of them can be read
 * whole with libraryPage. Every word must appear on the page; there is no guessing at meaning.
 */
export async function searchLibrary(db: Db, query: string, document?: string): Promise<LibraryHit[]> {
  const words = [...new Set(query.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) ?? [])].filter((w) => w.length > 1).slice(0, 8);
  if (!words.length) throw new InputError("Give one or more words to look for.");
  const where = words.map(() => "lower(body) LIKE ? ESCAPE '\\'").join(" AND ");
  const like = words.map((w) => `%${w.replace(/[\\%_]/g, "\\$&")}%`);
  const rows = await db.all<LibraryPage>(
    `SELECT * FROM library_pages WHERE ${where}${document ? " AND lower(document) = lower(?)" : ""} LIMIT 200`,
    document ? [...like, document] : like,
  );
  const count = (body: string) => {
    const low = body.toLowerCase();
    return words.reduce((n, w) => n + (low.split(w).length - 1), 0);
  };
  const ranked = rows.map((r) => ({ r, n: count(r.body) })).sort((a, b) => b.n - a.n || a.r.page - b.r.page).slice(0, 10);
  let sent = 0;
  return ranked.map(({ r }, i) => {
    const whole = i === 0 || (i < 3 && sent + r.body.length <= WHOLE_PAGES_BUDGET);
    if (whole) sent += r.body.length;
    return {
      document: r.document,
      page: r.page,
      section: r.section,
      ...(r.url ? { url: r.url } : {}),
      text: whole
        ? r.body
        : r.body
            .split("\n")
            .filter((line, j, all) => words.some((w) => [all[j - 1], line, all[j + 1]].some((l) => l?.toLowerCase().includes(w))))
            .join("\n")
            .slice(0, 1200),
    };
  });
}
