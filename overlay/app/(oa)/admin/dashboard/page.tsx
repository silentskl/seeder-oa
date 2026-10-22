import { OaConsole } from "@/components/oa/oa-console";

// Compatibility route for existing bookmarks. This route deliberately lives in
// the lightweight `(oa)` route group instead of Seeder's analytics-heavy `(app)`
// layout, which can exceed the Workers Free 10 ms CPU budget on a hard refresh.
export const dynamic = "force-dynamic";

export default function AdminDashboardPage() {
  return <OaConsole initialTab="overview" />;
}
