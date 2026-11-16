// What every page shares: the data (one request feeds all of them) and the grid of cards.

import { createContext, useContext, type ReactNode } from "react";
import type { Dashboard } from "../api";
import type { Kpi } from "../lib/series";

/** What every page reads: the dashboard data and the headline numbers worked out from it. */
export interface PageData {
  data: Dashboard;
  kpis: Kpi[];
}
export const DataContext = createContext<PageData | null>(null);
export function usePageData(): PageData {
  const value = useContext(DataContext);
  if (!value) throw new Error("usePageData outside the app");
  return value;
}

/** Cards two (or three) across on a desktop, one on a phone. A `.wide` child takes a whole row. */
export function Grid({ children, cols = 2 }: { children: ReactNode; cols?: 2 | 3 }) {
  return <div className={`grid cols-${cols}`}>{children}</div>;
}
