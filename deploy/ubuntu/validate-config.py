#!/usr/bin/env python3
"""Fail closed on placeholder Docker secrets or accidental fresh empty deployment."""
import pathlib
import sys
import urllib.parse

root=pathlib.Path(__file__).resolve().parent
env_file=root/".env"
if not env_file.is_file():
    raise SystemExit("Missing deploy/ubuntu/.env (copy .env.example and enter existing production secrets)")
settings={}
for line in env_file.read_text().splitlines():
    if not line.strip() or line.lstrip().startswith("#") or "=" not in line:
        continue
    name,value=line.split("=",1)
    settings[name.strip()]=value.strip().strip('"').strip("'")
required={
    "BETTER_AUTH_SECRET":32,
    "VCS_ENCRYPTION_KEY":32,
    "OA_SETTINGS_MASTER_KEY":32,
    "OA_FINANCE_SYNC_TOKEN":32,
}
for name,min_length in required.items():
    value=settings.get(name,"")
    if len(value)<min_length or "REPLACE_WITH_" in value or value.upper() in {"CHANGEME","CHANGE-ME"}:
        raise SystemExit("Missing, placeholder or insufficiently long "+name)
url=settings.get("BETTER_AUTH_URL","")
parsed=urllib.parse.urlparse(url)
if parsed.scheme!="https" and url not in ("http://localhost:3000","http://127.0.0.1:3000"):
    raise SystemExit("BETTER_AUTH_URL must be the canonical HTTPS URL")
if not parsed.netloc:
    raise SystemExit("BETTER_AUTH_URL must include hostname")
if not settings.get("OWNER_EMAIL") or "@" not in settings["OWNER_EMAIL"]:
    raise SystemExit("Missing OWNER_EMAIL")
data=root/"data"
if not (data/"seeder.db").is_file() or not (data/"uploads").is_dir():
    raise SystemExit("No migrated database/uploads found; import the final Cloudflare snapshot first")
print("PASS: Ubuntu Docker config has no placeholder secrets and migrated data exists")
