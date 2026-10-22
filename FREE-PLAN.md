# Cloudflare Workers Free plan notes

Seeder is a dynamic Next.js application. Cloudflare Workers Free allows 10 ms CPU per HTTP request. Authentication and server-side rendering can approach or exceed that limit.

## v0.1.5 mitigation

The upstream Seeder `/admin/dashboard` computes workspace-wide analytics and is substantially heavier than the OA pages. In v0.1.5:

- the Admin mode toggle opens `/admin/oa`;
- the Admin sidebar no longer sends users to the analytics dashboard;
- `/admin/dashboard` redirects to `/admin/oa`.

This specifically mitigates the common Error 1102 seen when refreshing `/admin/dashboard` on Workers Free.

It does not change Cloudflare's 10 ms Free CPU quota. If Error 1102 also occurs on lightweight pages such as `/oa` or `/admin/oa`, use Workers Logs to check CPU time and consider Workers Paid for production.
