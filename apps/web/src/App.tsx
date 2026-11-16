// The frame of the site: a sidebar of sections on a desktop (a row of tabs on a phone), the page
// header with the range, and the page itself.
//
// He asked for "a comprehensive look at me. KPIs, graphs, trends, analysis" (2026-11-15), and
// then for it to look like a real analytics product, not "a basic amateur" (2026-11-16, with two
// screenshots of the Searchable dashboard as the bar). So: sections in a sidebar, and on each
// page a few large cards, each one idea with its own headline number, chart and footer.
//
// One request feeds every page (/api/dashboard); the range (30 days, 90 days, a year) scopes
// everything on every page and is remembered in the browser. Everything is read-only except
// "Back up now": he changes things by telling his chatbot. The site has no AI in it.

import { useState } from "react";
import { BrowserRouter, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, ChevronDown, DatabaseBackup, Dumbbell, LayoutDashboard, NotebookPen, Scale, Utensils, type LucideIcon } from "lucide-react";
import { backUpNow, getDashboard, getStatus, type Status } from "./api";
import { backupLine } from "./lib/backupLine";
import { kpis } from "./lib/series";
import { DataContext, type PageData } from "./components/page";
import { ActivityPage, BodyPage, FoodPage, JournalPage, Overview, TrainingPage } from "./pages";

export const SECTIONS: { path: string; label: string; icon: LucideIcon; title: string }[] = [
  { path: "/", label: "Overview", icon: LayoutDashboard, title: "Overview" },
  { path: "/training", label: "Training", icon: Dumbbell, title: "Training" },
  { path: "/body", label: "Body", icon: Scale, title: "Body" },
  { path: "/food", label: "Food", icon: Utensils, title: "Food" },
  { path: "/activity", label: "Activity", icon: Activity, title: "Activity" },
  { path: "/journal", label: "Journal", icon: NotebookPen, title: "Journal and review" },
];

const RANGES = [
  { days: 30, label: "Last 30 days" },
  { days: 90, label: "Last 90 days" },
  { days: 365, label: "Last year" },
];

function savedRange(): number {
  try {
    const n = Number(localStorage.getItem("range"));
    return RANGES.some((r) => r.days === n) ? n : 30;
  } catch {
    return 30;
  }
}

export function App() {
  return (
    <BrowserRouter>
      <Frame />
    </BrowserRouter>
  );
}

function Frame() {
  const [range, setRange] = useState(savedRange);
  const status = useQuery({ queryKey: ["status"], queryFn: getStatus });
  // While a new range loads, the page keeps showing the old one, dimmed: no flash, no jump.
  const dash = useQuery({ queryKey: ["dashboard", range], queryFn: () => getDashboard(range), placeholderData: keepPreviousData });
  const location = useLocation();
  const section = SECTIONS.find((s) => s.path === location.pathname) ?? SECTIONS[0]!;
  const choose = (days: number) => {
    setRange(days);
    try {
      localStorage.setItem("range", String(days));
    } catch {
      /* private browsing: the choice just does not stick */
    }
  };
  const data = dash.data;
  const value: PageData | null = data
    ? { data, kpis: kpis({ today: data.today, range: data.range, fields: data.fields, days: data.days, workouts: data.workouts, liftDays: data.lift_days, goalWeight: data.macros.current?.goal_weight_lb }) }
    : null;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            <Activity size={16} strokeWidth={2.25} />
          </span>
          Health
        </div>
        <nav aria-label="Sections">
          <div className="nav-label">Dashboard</div>
          {SECTIONS.map((s) => (
            <NavLink key={s.path} to={s.path} end className="nav-item">
              <s.icon size={17} strokeWidth={1.75} aria-hidden />
              {s.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          {status.data ? <Backup status={status.data} /> : null}
          {status.data ? (
            <div className="me">
              <span className="avatar" aria-hidden>
                {status.data.email.charAt(0).toUpperCase()}
              </span>
              <span className="me-text">
                <b>Alex Morgan</b>
                <span>{status.data.email}</span>
              </span>
            </div>
          ) : null}
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="phone-brand">
            <span className="brand-mark" aria-hidden>
              <Activity size={14} strokeWidth={2.25} />
            </span>
            Health
          </div>
          <nav className="tabs" aria-label="Sections">
            {SECTIONS.map((s) => (
              <NavLink key={s.path} to={s.path} end className="tab">
                {s.label}
              </NavLink>
            ))}
          </nav>
        </header>

        <div className="page-head">
          <div>
            <h1>{section.title}</h1>
            {data ? <p className="page-date">{longToday(data.today)}</p> : null}
          </div>
          <label className="select">
            <span className="visually-hidden">How far back to look</span>
            <select value={range} onChange={(e) => choose(Number(e.target.value))}>
              {RANGES.map((r) => (
                <option key={r.days} value={r.days}>
                  {r.label}
                </option>
              ))}
            </select>
            <ChevronDown size={15} strokeWidth={1.75} aria-hidden />
          </label>
        </div>

        <main className={dash.isPlaceholderData ? "content loading" : "content"}>
          {dash.isError ? <p className="problem">{dash.error.message}</p> : null}
          {status.isError && !dash.isError ? <p className="problem">{status.error.message}</p> : null}
          {value ? (
            <DataContext.Provider value={value}>
              <Routes>
                <Route path="/" element={<Overview />} />
                <Route path="/training" element={<TrainingPage />} />
                <Route path="/body" element={<BodyPage />} />
                <Route path="/food" element={<FoodPage />} />
                <Route path="/activity" element={<ActivityPage />} />
                <Route path="/journal" element={<JournalPage />} />
                <Route path="*" element={<Overview />} />
              </Routes>
            </DataContext.Provider>
          ) : null}
          {status.data ? (
            <div className="phone-only">
              <Backup status={status.data} />
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}

const longToday = (day: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" }).format(new Date(`${day}T12:00:00Z`));

/** "Backed up today at 3:15 AM", and a way to make a copy right now. */
function Backup({ status }: { status: Status }) {
  const client = useQueryClient();
  const backup = useMutation({
    mutationFn: backUpNow,
    onSuccess: (result) => client.setQueryData<Status>(["status"], { ...status, backup: result.backup }),
  });
  const line = backupLine(status.backup);
  return (
    <div className="backup">
      <DatabaseBackup size={15} strokeWidth={1.75} aria-hidden />
      <div>
        {/* The key makes the sentence fade in again when it changes, so the eye catches the update. */}
        <p key={line.text} className={line.tone === "problem" ? "problem settle" : "settle"}>
          {backup.isError ? backup.error.message : line.text}
        </p>
        <button type="button" className="text-button" disabled={backup.isPending} onClick={() => backup.mutate()}>
          {backup.isPending ? "Backing up…" : "Back up now"}
        </button>
      </div>
    </div>
  );
}
