"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { SignOutButton } from "@/components/auth/sign-out-button";

type Props = {
  children: ReactNode;
  userName: string;
  userEmail: string;
  isAdmin: boolean;
  isManager: boolean;
};

const employeeNav = [
  ["/oa", "Overview"],
  ["/oa/leave", "Leave"],
  ["/oa/expenses", "Expenses"],
  ["/oa/payslips", "Payslips"],
] as const;

const adminNav = [
  ["/admin/oa", "Overview"],
  ["/admin/oa/approvals", "Approvals"],
  ["/admin/oa/employees", "Employees"],
  ["/admin/oa/payroll", "Payroll"],
  ["/admin/oa/settings", "Settings"],
] as const;

function NavLink({href,label}:{href:string;label:string}) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/oa" && href !== "/admin/oa" && pathname.startsWith(`${href}/`));
  return <Link href={href} className={`block rounded-lg px-3 py-2 text-sm transition ${active?"bg-neutral-900 font-medium text-white dark:bg-white dark:text-neutral-900":"text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-300 dark:hover:bg-neutral-900 dark:hover:text-white"}`}>{label}</Link>;
}

export function OaShell({children,userName,userEmail,isAdmin,isManager}:Props) {
  const pathname = usePathname();
  const adminMode = pathname.startsWith("/admin/oa");
  return <div className="min-h-dvh bg-neutral-50 text-neutral-950 dark:bg-neutral-950 dark:text-neutral-100 md:flex">
    <aside className="border-b border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950 md:sticky md:top-0 md:h-dvh md:w-64 md:shrink-0 md:border-b-0 md:border-r">
      <div className="mb-5">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600">Smarten OA</div>
        <div className="mt-1 text-lg font-semibold">Office</div>
        <div className="mt-1 truncate text-xs text-neutral-500">{userName || userEmail}</div>
      </div>
      {isAdmin && <div className="mb-4 grid grid-cols-2 rounded-lg border border-neutral-200 bg-neutral-50 p-1 text-xs dark:border-neutral-800 dark:bg-neutral-900">
        <Link href="/oa" className={`rounded-md px-2 py-1.5 text-center ${!adminMode?"bg-white font-medium shadow-sm dark:bg-neutral-800":"text-neutral-500"}`}>Employee</Link>
        <Link href="/admin/oa" className={`rounded-md px-2 py-1.5 text-center ${adminMode?"bg-white font-medium shadow-sm dark:bg-neutral-800":"text-neutral-500"}`}>Admin</Link>
      </div>}
      <nav className="space-y-1">
        {(adminMode && isAdmin ? adminNav : employeeNav).map(([href,label])=><NavLink key={href} href={href} label={label}/>)}
        {!adminMode && isManager ? <NavLink href="/oa/approvals" label="Approvals"/> : null}
      </nav>
      <div className="mt-5 border-t border-neutral-200 px-3 pt-4 dark:border-neutral-800">
        <SignOutButton />
      </div>
    </aside>
    <main className="min-w-0 flex-1 overflow-x-hidden">{children}</main>
  </div>;
}
