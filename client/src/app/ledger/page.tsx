import { renderDashboard, type DashboardPageProps } from "../dashboard/render";

// Phone page (design handoff v3, Mobile); on wide screens it becomes /dashboard#section.
export default function LedgerPage(props: DashboardPageProps) {
  return renderDashboard(props, "ledger");
}
