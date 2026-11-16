// The six pages. Each is a few large cards in a grid; `wide` cards take the whole row.
//
//   Overview   the coach (program ring and latest review); up next and the week ahead; today's food
//              against the targets beside calories (once this week has food logged); your numbers
//              beside weight; steps beside training; resting heart rate; trends.
//   Training   up next beside this week; every lift as a table; training days beside workouts.
//   Body       weight, large; resting heart rate beside VO2 max.
//   Food       today against the food app's targets beside calories; this week, day by day, across;
//              protein, carbs, fat and fiber; the target check-ins.
//   Activity   steps beside active calories; training days beside workouts.
//   Journal    the coach's review; trends beside the journal.
//
// On a phone the grid is one column, and on the Overview "Up next" and "Week ahead" come first,
// because that is what he opens at the gym.

import type { ReactNode } from "react";
import { Grid, usePageData } from "./components/page";
import { Coach, Trends } from "./components/Analysis";
import { chartCards } from "./components/Charts";
import { Journal } from "./components/Journal";
import { Lifts } from "./components/Lifts";
import { MacrosToday, MacrosWeek, TargetHistory } from "./components/Macros";
import { NextLift } from "./components/NextLift";
import { Numbers } from "./components/Numbers";
import { WeekAhead } from "./components/WeekAhead";
import { Workouts } from "./components/Workouts";
import { Empty } from "./components/ui";

const Wide = ({ children }: { children: ReactNode }) => (children ? <div className="wide">{children}</div> : null);

export function Overview() {
  const { data, kpis } = usePageData();
  const charts = chartCards(data, kpis);
  const nothingYet = !data.days.length && !data.workouts.length && !data.lifts.length && !data.brief.next && !data.journal.length;
  // Today's and this week's food against the targets earn a place here only once there is food to show.
  const foodThisWeek = !!data.macros.current && data.macros.this_week.some((d) => "actual" in d && Object.values(d.actual).some((v) => v !== null));
  if (nothingYet) return <Empty>Nothing here yet. Ask your chatbot to update your health page.</Empty>;
  return (
    <Grid>
      <Wide>
        <Coach program={data.program} brief={data.brief} review={data.review} today={data.today} />
      </Wide>
      <NextLift brief={data.brief} className="phone-first" />
      <WeekAhead brief={data.brief} place={data.forecast_for} className="phone-first" />
      {foodThisWeek ? (
        <>
          <MacrosToday macros={data.macros} />
          {charts.kcal_eaten}
          <Numbers kpis={kpis} range={data.range} />
          {charts.weight ?? charts.resting_hr}
          {charts.steps}
          {charts.training}
          {charts.weight ? charts.resting_hr : charts.active_kcal}
        </>
      ) : (
        <>
          <Numbers kpis={kpis} range={data.range} />
          {charts.weight ?? charts.resting_hr}
          {charts.kcal_eaten}
          {charts.steps}
          {charts.training}
          {charts.weight ? charts.resting_hr : charts.active_kcal}
        </>
      )}
      <Wide>
        <Trends trends={data.trends} />
      </Wide>
    </Grid>
  );
}

export function TrainingPage() {
  const { data, kpis } = usePageData();
  const charts = chartCards(data, kpis);
  return (
    <Grid>
      <NextLift brief={data.brief} />
      <WeekAhead brief={data.brief} place={data.forecast_for} />
      <Wide>
        <Lifts lifts={data.lifts} today={data.today} />
      </Wide>
      {charts.training}
      <Workouts workouts={data.workouts.filter((w) => w.local_date >= data.days_from)} today={data.today} />
    </Grid>
  );
}

export function BodyPage() {
  const { data, kpis } = usePageData();
  const charts = chartCards(data, kpis, { weight: 320 });
  if (!charts.weight && !charts.resting_hr && !charts.vo2max) return <Empty>No weight, heart rate or VO2 max in this range yet.</Empty>;
  return (
    <Grid>
      <Wide>{charts.weight}</Wide>
      {charts.resting_hr}
      {charts.vo2max}
    </Grid>
  );
}

export function FoodPage() {
  const { data, kpis } = usePageData();
  const charts = chartCards(data, kpis, { kcal_eaten: 300 });
  const targets = !!data.macros.current;
  const anyChart = charts.kcal_eaten || charts.protein_g || charts.fiber_g;
  if (!anyChart && !targets) return <Empty>No food logged in this range yet. Food comes from your food app through Apple Health.</Empty>;
  return (
    <>
      {targets ? (
        <Grid>
          <MacrosToday macros={data.macros} />
          {charts.kcal_eaten}
          <Wide>
            <MacrosWeek macros={data.macros} />
          </Wide>
        </Grid>
      ) : null}
      {anyChart ? (
        <>
          {targets ? null : (
            <Grid>
              <Wide>{charts.kcal_eaten}</Wide>
            </Grid>
          )}
          <Grid>
            {charts.protein_g}
            {charts.carbs_g}
            {charts.fat_g}
            {charts.fiber_g}
          </Grid>
        </>
      ) : (
        <Empty>No food logged in this range yet. Food comes from your food app through Apple Health.</Empty>
      )}
      <Grid>
        <Wide>
          <TargetHistory history={data.macros.history} />
        </Wide>
      </Grid>
    </>
  );
}

export function ActivityPage() {
  const { data, kpis } = usePageData();
  const charts = chartCards(data, kpis);
  return (
    <Grid>
      {charts.steps}
      {charts.active_kcal}
      {charts.training}
      <Workouts workouts={data.workouts.filter((w) => w.local_date >= data.days_from)} today={data.today} />
    </Grid>
  );
}

export function JournalPage() {
  const { data } = usePageData();
  return (
    <Grid>
      <Wide>
        <Coach program={data.program} brief={data.brief} review={data.review} today={data.today} />
      </Wide>
      <Journal entries={data.journal} today={data.today} />
      <Trends trends={data.trends} />
    </Grid>
  );
}
