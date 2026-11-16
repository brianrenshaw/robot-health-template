"""Turn a book's PDF (one file, or several parts in order) into the JSON that
scripts/import-library.ts loads into the coach's reference library, one entry per page.

    python3 -I scripts/parse-pdf.py <out.json> "<Document title>" "<sections>" <part1.pdf> [<part2.pdf> ...]

<sections> is the table of contents as "printed page:chapter" pairs separated by ";", e.g.
    "3:Principles;16:Understanding The Program;39:FAQ"
Pass "" for none.

A part can be written "<file.pdf>@<number>" to say what its first page is numbered, for a book
whose pages print no number, or a book supplied without its opening pages:
    ... "My training book" "" part-a.pdf@237 part-b.pdf@322
Pages of such a part are numbered by their place in the PDF.

Needs the `pdftotext` program (poppler-utils). Page numbers are the ones printed at the foot
of each page when the book prints them ("my training book / 6"). A page without one
takes the number its position implies. The cover and contents, before numbering starts, are left out.

The PDF and the JSON are copyrighted material the owner bought. Keep both OUT of the repository;
write the JSON to a scratch folder.
"""
import json, re, subprocess, sys


def pages_of(pdf):
    out = subprocess.run(["pdftotext", pdf, "-"], capture_output=True, text=True).stdout
    return out.split("\f")


def main(out, title, sections, pdfs):
    toc = sorted((int(a), b.strip()) for a, b in (s.split(":", 1) for s in sections.split(";") if s.strip()))
    raw = []  # (text, the page number given by "@", or None)
    for pdf in pdfs:
        path, _, start = pdf.partition("@")
        for i, text in enumerate(pages_of(path)):
            raw.append((text, int(start) + i if start else None))
    pages, offset, last_printed = {}, None, 0
    for index, (text, given) in enumerate(raw, 1):
        text = re.sub(r"\n{2,}", "\n", re.sub(r"[ \t]+", " ", text)).strip()
        if not text:
            continue
        if given is not None:
            pages[given] = dict(page=given, section=next((name for start, name in reversed(toc) if given >= start), None), body=text)
            continue
        # A page number printed alone on the last line, under the book's running title. It is
        # believed when it moves forward and is not ahead of the PDF's own page count.
        m = re.search(r"\n(\d{1,4})$", text)
        if m and last_printed < int(m.group(1)) <= index:
            number = last_printed = int(m.group(1))
            offset = index - number
            text = text[: m.start()].strip()
        elif offset is None:
            continue  # the cover and contents, before the numbered pages begin
        else:
            number = index - offset
        text = re.sub(r"\n?" + re.escape(title) + r"$", "", text, flags=re.I).strip()
        if not text or number < 1:
            continue
        if number in pages:  # an unnumbered page that follows a numbered one: keep it with that page
            pages[number]["body"] += "\n" + text
            continue
        section = next((name for start, name in reversed(toc) if number >= start), None)
        pages[number] = dict(page=number, section=section, body=text)
    pages = [pages[n] for n in sorted(pages)]
    json.dump(dict(document=title, pages=pages), open(out, "w"), ensure_ascii=False, indent=1)
    print(f"{title}: {len(pages)} pages with text, numbered {pages[0]['page']} to {pages[-1]['page']}, {sum(len(p['body']) for p in pages)} characters")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:])
