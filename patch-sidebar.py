from pathlib import Path
import sys
p=Path(sys.argv[1])
s=p.read_text()
if 'href="/oa"' in s:
    print('Sidebar already contains Office link.')
    raise SystemExit(0)
needle='''              <NavSection label="Workspace" />\n              <NavItem\n                href="/team"'''
insert='''              <NavSection label="Office" />\n              <NavItem\n                href="/oa"\n                icon={CalendarCheck}\n                label="Office"\n                active={pathname === "/oa" || pathname.startsWith("/oa/")}\n              />\n              <NavSection label="Workspace" />\n              <NavItem\n                href="/team"'''
if needle not in s:
    print('ERROR: Upstream Seeder sidebar structure changed. No sidebar change was made.', file=sys.stderr)
    raise SystemExit(2)
p.with_suffix(p.suffix+'.pre-oa.bak').write_text(s)
p.write_text(s.replace(needle, insert, 1))
print('Sidebar patched: Office → /oa')
