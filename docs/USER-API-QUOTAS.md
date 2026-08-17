# Hosted user API quotas

Loopgraph separates browser sessions from independently authenticated machine traffic. Machine
workers keep their capability, replay, and rate guards. Every authenticated browser API request
is assigned to one of four stable quota buckets and consumed atomically in Supabase:

| Bucket | Default | Examples |
|---|---:|---|
| `read` | 300/minute | Workspace, loop, outcome, and trace reads |
| `write` | 120/minute | Answers, reviews, and observed outcomes |
| `compute` | 30/minute | Hermes design, opportunity scans, discovery synthesis, and loop runs |
| `admin` | 60/minute | Integrations, marketplace administration, CLI sessions, and audit export |

The counter key is the authenticated user, exact organization, and stable bucket. Resource IDs are
not part of the key, so changing a loop or session ID cannot create a fresh quota. One current
window is retained per key; the table does not grow by one row per request or minute.

## Trust boundary

The browser sends only the requested organization and bucket. The database:

1. derives the user from `auth.uid()`;
2. verifies an active membership in that exact organization;
3. loads a service-role-owned tenant override or a built-in default;
4. increments the current window with one atomic upsert; and
5. returns only the decision, remaining budget, reset time, and optional retry delay.

Authenticated callers cannot read the quota tables, change their limits, choose a project key to
create extra windows, or pass a larger limit to the RPC. Missing migrations and malformed database
responses fail closed with `503`. Saturated quotas return `429`, `Retry-After`, and standard
`X-RateLimit-*` response headers.

## Tenant overrides

An infrastructure administrator may set a bounded override with the service role. Do not expose
this operation as a general browser API.

```sql
insert into public.user_api_quota_policy_overrides (
  organization_id,
  bucket,
  rate_limit,
  window_seconds
) values (
  '00000000-0000-0000-0000-000000000000',
  'compute',
  60,
  60
)
on conflict (organization_id, bucket) do update
set rate_limit = excluded.rate_limit,
    window_seconds = excluded.window_seconds,
    updated_at = now();
```

Allowed buckets are `read`, `write`, `compute`, and `admin`; limits are bounded to `1..10000` and
windows to `1..3600` seconds. Apply
`supabase/migrations/202608170005_user_api_quotas.sql` before enabling hosted authentication.

## Machine routes

Middleware explicitly recognizes Hermes agent registration/heartbeats/execution events, Hermes
design callbacks and workers, connector broker endpoints, marketplace clients/workers, routing
workers/jobs, controller, measurement, cron, webhook, graph transaction, metrics, and audit
retention routes. It does not apply browser cookies or browser quotas to those endpoints. Their
route handlers must still verify the exact signed capability, tenant/project scope, replay ID, and
durable machine rate window; middleware classification never authorizes a machine call by itself.
