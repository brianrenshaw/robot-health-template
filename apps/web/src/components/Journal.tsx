// His notes and journal for the last 30 days, newest first, in his own words. The day is said
// once per day, not on every entry. There is no writing box: he tells his chatbot.

import { NotebookPen } from "lucide-react";
import type { JournalEntry } from "@health/core";
import { Card, Empty } from "./ui";
import { dayLabel } from "../lib/measures";
import { CARD_COLOR } from "../lib/colors";

export function Journal({ entries, today, className }: { entries: JournalEntry[]; today: string; className?: string }) {
  const newest = [...entries].reverse();
  return (
    <Card icon={NotebookPen} color={CARD_COLOR.journal} title="Journal" subtitle="your notes, last 30 days" className={className} flush={!!entries.length}>
      {entries.length ? (
        <ul className="journal">
          {newest.map((e, i) => (
            <li key={e.id}>
              <span className="journal-day">{i === 0 || newest[i - 1]!.date !== e.date ? dayLabel(e.date, today) : ""}</span>
              <span className="journal-body">{e.body}</span>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>Tell your coach how you're feeling and it will be kept here.</Empty>
      )}
    </Card>
  );
}
