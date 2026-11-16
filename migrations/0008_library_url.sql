-- 0008: a web address for a library page.
--
-- Until now the library held books, and a page was cited by its number. On 2026-11-16 the owner
-- asked for trusted reading on diet and exercise from the web (a diet coach's blog he trusts), so a
-- "page" can now also be one article. An article has no page number worth saying; what he can
-- use is its title (kept in `section`) and its link (kept here). NULL for a book's pages.

ALTER TABLE library_pages ADD COLUMN url TEXT;
