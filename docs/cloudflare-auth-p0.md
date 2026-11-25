# P0 — Cloudflare request lifetime

Reported: Cloudflare drops a Promise whose creating request ended. Actual runtime: Seeder 2.1.1, Better Auth/core/drizzle 1.6.9, Next 16.2.4, OpenNext 1.19.4, Wrangler 4.86.0.

Changes: create auth per Worker invocation/call (SSR getSession already uses React request cache); retain lazy Node singleton; disable optional telemetry; patch reviewed installed core 1.6.9 before build to remove cached dynamic import and fix three ALS initialization races with a synchronous second check (??=). Do not disable handle_cross_request_promise_resolution. Remove the optional OpenTelemetry dynamic-import Promise using the package's own no-op tracing API. No schema, cookie name, secret, signup/invite or permission changes. Dependency patch is re-applied after reinstall; fail closed on version drift. This is a targeted hotfix, not an endorsement of keeping 1.6.9 indefinitely.

References: https://github.com/better-auth/better-auth/issues/10315 and https://github.com/better-auth/better-auth/issues/10300.

Before production: use a separate Worker with local/test D1, run build/typecheck and auth regression, including rejected signup, allowed invite, disabled user, two Entity isolation, sign-out, two separate users, and aborted first requests followed by concurrent requests. Inspect tail for cross-request Promise errors. Node-mode build/login must also pass. Do not use production cookies or write tests against production D1. The Node test in the build gate verifies the installed ALS implementation but is not a substitute for workerd runtime tests. Exact production root cause still needs post-deploy verification. Rollback using previous Worker deployment if needed; no migration added.

## HTTP regression (isolated Worker)

Start a preview using a test-only D1/R2 and test secrets; do not use remote production bindings. Run:

```bash
python3 tests/check-auth-runtime.py http://127.0.0.1:8787 --requests 1000 --concurrency 20
# For session isolation use two distinct test users; private files contain only Cookie header values.
python3 tests/check-auth-runtime.py http://127.0.0.1:8787 --cookie-a /private/test-a.cookie --cookie-b /private/test-b.cookie
```

This verifies home/session pairs, anonymous state, optional authenticated identities and recovery after disconnected clients. Inspect Worker logs, and perform signup/invite/disabled-user/Entity authorization and cold-start tests separately. No writes are performed by the test client (normal session refresh may occur). The script refuses the production hostname without explicit opt-in. Rate limits may require a controlled test environment; do not disable auth rate limits in production.
