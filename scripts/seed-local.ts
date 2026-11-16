// Fills the LOCAL database with a month of made-up numbers and workouts, through the chatbot Worker's own
// save tool, so the page can be looked at during development. Never real data, never the real
// database: it refuses any address that is not localhost.
//   (start both Workers locally as in CLAUDE.md, "Running locally", then)
//   npx tsx scripts/seed-local.ts

const URL_ = process.env.MCP_URL ?? "http://localhost:8788/mcp";
const TOKEN = process.env.MCP_TOKEN ?? "testtoken";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(URL_)) throw new Error("seed-local only writes to a local Worker.");

// A small repeatable random-number maker, so every run draws the same month.
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const around = (mid: number, spread: number) => mid + (rand() - 0.5) * 2 * spread;

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const dayBefore = (n: number) => {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

// Rows shaped the way Apple Health returns them (The owner's spec): one bucket per local day, whose
// period_start is local midnight written in UTC.
const offset = (day: string) => (new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", timeZoneName: "short" }).format(new Date(`${day}T04:30:00Z`)).includes("EDT") ? 4 : 5); // which offset is in force at that day's midnight
const bucket = (day: string, stats: Record<string, number>, unit: string) => ({ period_start: `${day}T0${offset(day)}:00:00Z`, ...stats, unit });
const rows: Record<string, unknown[]> = {
  dietaryEnergyConsumed: [], dietaryProtein: [], dietaryCarbohydrates: [], dietaryFatTotal: [],
  activeEnergyBurned: [], stepCount: [], bodyMass: [], restingHeartRate: [], vo2Max: [],
};
const fiber: { date: string; fiber_g: number }[] = [];
const DAYS = 130; // enough to fill the 90-day view and its "before"
const workouts = [];
let lastKcal = 0;
for (let n = DAYS - 1; n >= 0; n--) {
  const day = dayBefore(n);
  if (n !== 9 && n !== 10) {
    // two days with no food logged at all; one day under 1,500; one day the app carried forward
    const kcal = n === 0 ? 640.3 : n === 17 ? 1180.2 : n === 5 ? lastKcal : around(2150, 300);
    lastKcal = kcal;
    rows.dietaryEnergyConsumed!.push(bucket(day, { sum: kcal }, "kcal"));
    rows.dietaryProtein!.push(bucket(day, { sum: around(n === 0 ? 45 : 160, 25) }, "g"));
    rows.dietaryCarbohydrates!.push(bucket(day, { sum: around(n === 0 ? 70 : 210, 50) }, "g"));
    rows.dietaryFatTotal!.push(bucket(day, { sum: around(n === 0 ? 20 : 74, 15) }, "g"));
    if (n < 40) fiber.push({ date: day, fiber_g: Math.round(around(n === 0 ? 9 : 33, 9) * 10) / 10 }); // as if from food-app screenshots
  }
  rows.activeEnergyBurned!.push(bucket(day, { sum: n === 0 ? around(180, 60) : around(560, 190) }, "kcal"));
  rows.stepCount!.push(bucket(day, { sum: Math.round(n === 0 ? around(2400, 600) : around(8600, 3200)) }, "count"));
  if (n % 3 !== 1) rows.bodyMass!.push(bucket(day, { average: (190 - (DAYS - 1 - n) * 0.05 + around(0, 0.7)) / 2.20462 }, "kg"));
  rows.restingHeartRate!.push(bucket(day, { average: around(55, 3) }, "count/min"));
  if (n % 7 === 2) rows.vo2Max!.push(bucket(day, { average: around(41, 0.8) }, "mL/min·kg"));
  const kind = [null, "cycling", null, "functionalStrengthTraining", "walking", null, "hiking", "cycling", null, "functionalStrengthTraining"][n % 10];
  if (kind && n > 0) {
    const outdoors = kind !== "functionalStrengthTraining";
    const seconds = around(kind === "hiking" ? 6200 : 3300, 700);
    workouts.push({
      start: `${day}T1${n % 3}:1${n % 6}:34Z`,
      end: new Date(Date.parse(`${day}T1${n % 3}:1${n % 6}:34Z`) + seconds * 1000).toISOString(),
      value: { workout: {
        activity_type: kind, duration: seconds, total_energy_burned: around(480, 120), indoor: !outdoors,
        ...(outdoors ? { total_distance: around(kind === "cycling" ? 24000 : 6500, 2500), weather: { temperature_celsius: around(11, 6) } } : {}),
        statistics: [{ sample_type: "heartRate", unit: "count/min", average: around(128, 10), min: 92, max: around(165, 8) }],
      } },
    });
  }
}
const statistics = Object.entries(rows).map(([type, r]) => ({ type, rows: r }));

let id = 1;
async function tool(name: string, args: unknown): Promise<any> {
  const res = await fetch(URL_, {
    method: "POST",
    headers: {
      "Content-Type": "application/json", Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${TOKEN}`, "MCP-Protocol-Version": "2025-06-18", "X-Client-Name": "seed",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: id++, method: "tools/call", params: { name, arguments: args } }),
  });
  const text = await res.text();
  const line = text.includes("data:") ? text.split("\n").find((l) => l.startsWith("data:"))!.slice(5) : text;
  const content = JSON.parse(line).result.content[0].text;
  return content.startsWith("{") ? JSON.parse(content) : { error: content };
}

const saved = await tool("save_health_data", { statistics, workouts, entered_days: fiber.slice(-60) });
console.log(saved.receipt ?? saved.error);

// Two made-up food app check-ins: one three Mondays ago, one this Monday (or today, if today is Monday).
const monday = (() => {
  const d = new Date(`${today}T12:00:00Z`);
  return dayBefore((d.getUTCDay() + 6) % 7);
})();
const earlier = new Date(`${monday}T12:00:00Z`);
earlier.setUTCDate(earlier.getUTCDate() - 21);
for (const t of [
  { effective_date: earlier.toISOString().slice(0, 10), kcal: 2250, protein_g: 165, carbs_g: 225, fat_g: 78, trend_weight_lb: 187.2, goal_rate_lb_per_week: -1, note: "Made-up check-in." },
  { effective_date: monday, kcal: 2150, protein_g: 165, carbs_g: 205, fat_g: 74, trend_weight_lb: 185.1, goal_rate_lb_per_week: -1, note: "Made-up: calories down 100 after a stall." },
]) {
  const r = await tool("set_macro_targets", t);
  console.log(r.receipt ?? r.error);
}

// If a lifting program is loaded locally (scripts/import-program.ts --local), lift through its
// first sessions on past days with made-up weights that creep up, so the lifts have lines.
let brief = await tool("coach_brief", {});
if (brief.next) {
  let sessions = 0;
  for (let n = 26; n >= 2 && brief.next; n -= 3) {
    const sets = brief.next.exercises.flatMap((e: any, i: number) =>
      Array.from({ length: e.working_sets ?? 3 }, (_, k) => ({
        exercise: e.prescribed, set: k + 1,
        weight_lb: (e.suggestion.weight_lb ?? 40 + ((e.prescribed.length * 7 + i * 13) % 12) * 15) + 0,
        reps: 8 + ((n + i + k) % 4),
      })),
    );
    const done = await tool("log_lift", { date: dayBefore(n), sets, finished: true });
    if (done.error) throw new Error(done.error);
    sessions++;
    brief = await tool("coach_brief", {});
  }
  console.log(`Lifted through ${sessions} sessions of the program.`);
  await tool("add_journal", { date: dayBefore(1), text: "Legs felt heavy but the session went fine." });
  await tool("add_journal", { text: "Slept about six hours. Knee a little sore after basketball." });
  await tool("set_week_plan", { bike_dates: [dayBefore(-1), dayBefore(-3)].filter((d) => new Date(`${d}T12:00:00Z`).getUTCDay() !== 1) });
  await tool("save_review", {
    from: dayBefore(7), to: today,
    text: "A made-up review, to show how one looks.\n\nLifting was steady: three sessions, and most lifts moved up a rep or a step.\n\n- Calories ran a little under the week before.\n- Weight kept drifting down at about the same pace.\n- Sleep came up twice in your notes; both were the night before a heavy leg day.",
  });
} else {
  console.log("No lifting program loaded locally, so no lifts were added.");
}

export {};
