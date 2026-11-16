-- 0007: the coach's written reviews.
-- When the owner asks his chatbot to review a week ("analyze the past week... am I improving? How
-- does this relate to eating?"), it saves what it wrote here so the dashboard can show it. The
-- site has no AI in it: this is how the written analysis gets onto the page.
CREATE TABLE reviews (
  id         TEXT PRIMARY KEY,
  from_date  TEXT NOT NULL,               -- the stretch the review covers, his local dates
  to_date    TEXT NOT NULL,
  body       TEXT NOT NULL,               -- plain paragraphs; a line starting "- " is a list item
  created_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX reviews_by_date ON reviews (to_date);
