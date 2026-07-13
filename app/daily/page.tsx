import { DailySummaryPage } from "@/components/daily/daily-summary-page";
import { getDailySummaryForView } from "../discovery/view-data";

export default async function DailyPage() {
  const { summary } = await getDailySummaryForView();

  return <DailySummaryPage summary={summary} />;
}
