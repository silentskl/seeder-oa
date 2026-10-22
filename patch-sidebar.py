from pathlib import Path
import sys

p = Path(sys.argv[1])
s = p.read_text()
original = s

# 1) Make the Admin mode toggle open the lightweight OA admin landing page.
# Only change the first /admin/dashboard link, which is the Workspace/Admin toggle.
if 'href="/admin/oa"' not in s.split('<nav className=', 1)[0]:
    s = s.replace('href="/admin/dashboard"', 'href="/admin/oa"', 1)
    s = s.replace('pendingHref === "/admin/dashboard"', 'pendingHref === "/admin/oa"', 1)

# 2) Replace the heavy upstream Admin dashboard row with explicit OA administration links.
old_admin = '''              <NavSection label="Featured" first />
              <NavItem
                href="/admin/dashboard"
                icon={ChartBar}
                label="Dashboard"
                active={pathname.startsWith("/admin/dashboard")}
              />
              <NavItem
                href="/admin/daily"
                icon={CalendarCheck}
                label="Daily Ops"
                active={pathname.startsWith("/admin/daily")}
              />'''
new_admin = '''              <NavSection label="Office" first />
              <NavItem
                href="/admin/oa"
                icon={CalendarCheck}
                label="Overview"
                active={pathname === "/admin/oa"}
              />
              <NavItem
                href="/admin/oa/approvals"
                icon={PaperPlaneTilt}
                label="Approvals"
                active={pathname.startsWith("/admin/oa/approvals")}
              />
              <NavItem
                href="/admin/oa/employees"
                icon={UsersThree}
                label="Employees"
                active={pathname.startsWith("/admin/oa/employees")}
              />
              <NavItem
                href="/admin/oa/payroll"
                icon={ChartBar}
                label="Payroll"
                active={pathname.startsWith("/admin/oa/payroll")}
              />
              <NavItem
                href="/admin/oa/settings"
                icon={GearSix}
                label="Settings"
                active={pathname.startsWith("/admin/oa/settings")}
              />
              <NavSection label="Seeder" />
              <NavItem
                href="/admin/daily"
                icon={CalendarCheck}
                label="Daily Ops"
                active={pathname.startsWith("/admin/daily")}
              />'''

if 'href="/admin/oa/employees"' not in s:
    if old_admin not in s:
        print('ERROR: Upstream Seeder admin sidebar structure changed. No admin OA links were inserted.', file=sys.stderr)
        raise SystemExit(2)
    s = s.replace(old_admin, new_admin, 1)

# 3) Keep a single Office entry in normal workspace mode for employee self-service.
if 'href="/oa"' not in s:
    needle = '''              <NavSection label="Workspace" />\n              <NavItem\n                href="/team"'''
    insert = '''              <NavSection label="Office" />\n              <NavItem\n                href="/oa"\n                icon={CalendarCheck}\n                label="Office"\n                active={pathname === "/oa" || pathname.startsWith("/oa/")}\n              />\n              <NavSection label="Workspace" />\n              <NavItem\n                href="/team"'''
    if needle not in s:
        print('ERROR: Upstream Seeder workspace sidebar structure changed. No employee Office link was inserted.', file=sys.stderr)
        raise SystemExit(2)
    s = s.replace(needle, insert, 1)

if s == original:
    print('Sidebar already contains Seeder OA v0.1.9 navigation.')
    raise SystemExit(0)

backup = p.with_suffix(p.suffix + '.pre-oa-v016.bak')
if not backup.exists():
    backup.write_text(original)
p.write_text(s)
print('Sidebar patched: employee Office + admin Overview/Approvals/Employees/Payroll/Settings; Admin toggle → /admin/oa')
