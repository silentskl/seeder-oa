"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {useFinanceLanguage,financeTr} from "@/lib/oa/finance-i18n";
import { SignOutButton } from "@/components/auth/sign-out-button";

type Props = {
  children: ReactNode;
  userName: string;
  userEmail: string;
  isAdmin: boolean;
  isManager: boolean;
  isFinanceAdmin: boolean;
};

const employeeNav = [
  ["/oa", "Overview"],
  ["/oa/leave", "Leave"],
  ["/oa/travel", "Travel"],
  ["/oa/expenses", "Expenses"],
  ["/oa/payslips", "Payslips"],
] as const;

const adminNav = [
  ["/admin/oa", "Overview"],
  ["/admin/oa/approvals", "Approvals"],
  ["/admin/oa/employees", "Employees"],
  ["/admin/oa/payroll", "Payroll"],
  ["/admin/oa/parties", "Suppliers & Customers"],
  ["/admin/oa/finance", "Finance · AR/AP"],
  ["/admin/oa/settings", "Settings"],
] as const;

function NavLink({href,label}:{href:string;label:string}) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/oa" && href !== "/admin/oa" && pathname.startsWith(`${href}/`));
  return <Link href={href} className={`block rounded-lg px-3 py-2 text-sm transition ${active?"bg-neutral-900 font-medium text-white dark:bg-white dark:text-neutral-900":"text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950 dark:text-neutral-300 dark:hover:bg-neutral-900 dark:hover:text-white"}`}>{label}</Link>;
}

export function OaShell({children,userName,userEmail,isAdmin,isManager,isFinanceAdmin}:Props) {
  const pathname = usePathname();
  const adminMode = pathname.startsWith("/admin/oa");
  const [lang,setLang]=useFinanceLanguage();
  const t=(en:string,zh:string)=>financeTr(lang,en,zh);
  const navLabels:Record<string,string>={"/oa":"概览","/oa/leave":"请假","/oa/travel":"差旅","/oa/expenses":"报销","/oa/payslips":"工资单","/admin/oa":"管理概览","/admin/oa/approvals":"审批","/admin/oa/employees":"员工","/admin/oa/payroll":"薪资管理","/admin/oa/parties":"供应商与客户","/admin/oa/finance":"应收应付账款","/admin/oa/settings":"设置"};
  return <div className="min-h-dvh bg-neutral-50 text-neutral-950 dark:bg-neutral-950 dark:text-neutral-100 md:flex">
    <aside className="border-b border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-950 md:sticky md:top-0 md:h-dvh md:w-64 md:shrink-0 md:border-b-0 md:border-r">
      <div className="mb-5">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600">Smarten OA</div>
        <div className="mt-1 text-lg font-semibold">{t("Office","办公系统")}</div>
        <div className="mt-1 truncate text-xs text-neutral-500">{userName || userEmail}</div>
      </div>
      {isAdmin && <div className="mb-4 grid grid-cols-2 rounded-lg border border-neutral-200 bg-neutral-50 p-1 text-xs dark:border-neutral-800 dark:bg-neutral-900">
        <Link href="/oa" className={`rounded-md px-2 py-1.5 text-center ${!adminMode?"bg-white font-medium shadow-sm dark:bg-neutral-800":"text-neutral-500"}`}>{t("Employee","员工")}</Link>
        <Link href="/admin/oa" className={`rounded-md px-2 py-1.5 text-center ${adminMode?"bg-white font-medium shadow-sm dark:bg-neutral-800":"text-neutral-500"}`}>{t("Admin","管理员")}</Link>
      </div>}
      <nav className="space-y-1">
        {(adminMode && isAdmin ? adminNav : employeeNav).map(([href,label])=><NavLink key={href} href={href} label={t(label,navLabels[href]||label)}/>)}
        {!isAdmin&&isFinanceAdmin&&<><NavLink href="/admin/oa/parties" label={t("Suppliers & Customers","供应商与客户")}/><NavLink href="/admin/oa/finance" label={t("Finance · AR/AP","应收应付账款")}/></>}
        {!adminMode && isManager ? <NavLink href="/oa/approvals" label={t("Approvals","审批")}/> : null}
      </nav>
      <div className="mt-5 border-t border-neutral-200 px-3 pt-4 dark:border-neutral-800">
        <div className="mb-3 flex items-center justify-between gap-2 text-xs"><label htmlFor="oa-language" className="text-neutral-500">{t("Language","语言")}</label><select id="oa-language" aria-label={t("Interface language","界面语言")} className="rounded-md border border-neutral-300 bg-white p-1 dark:border-neutral-700 dark:bg-neutral-950" value={lang} onChange={e=>setLang(e.target.value as "en"|"zh")}><option value="en">English</option><option value="zh">简体中文</option></select></div>
       <SignOutButton />
      </div>
    </aside>
    <main className="min-w-0 flex-1 overflow-x-hidden">{children}</main>
  </div>;
}
