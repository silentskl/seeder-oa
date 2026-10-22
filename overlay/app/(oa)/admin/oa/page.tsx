import { OaConsole } from "@/components/oa/oa-console";

// Authorization for admin data/actions is enforced by /api/oa. The parent OA
// layout performs the single session lookup used for the shell.
export const dynamic = "force-dynamic";
export default function AdminOfficePage(){ return <OaConsole initialTab="overview"/>; }
