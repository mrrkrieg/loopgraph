const baseUrl = required("LOOPGRAPH_STAGING_URL").replace(/\/$/, "");
const token = required("LOOPGRAPH_STAGING_OBSERVABILITY_TOKEN");
const checks = [
  { name: "readiness", path: "/api/health/ready", auth: false },
  { name: "operational metrics", path: "/api/operations/metrics", auth: true },
  { name: "audit integrity", path: "/api/operations/audit-export?limit=1", auth: true }
];
const results = [];
for (const check of checks) {
  const response = await fetch(`${baseUrl}${check.path}`, {
    headers: check.auth ? { authorization: `Bearer ${token}` } : {},
    signal: AbortSignal.timeout(15_000)
  });
  const body = await response.text();
  if (check.name === "audit integrity" && response.ok) {
    const parsed = JSON.parse(body);
    if (parsed?.integrity?.valid !== true) throw new Error("Staging audit chain did not return integrity.valid=true");
  }
  results.push({ name: check.name, status: response.status, ok: response.ok, body: body.slice(0, 500) });
}
console.log(JSON.stringify({ schemaVersion: "staging-validation/v1", target: new URL(baseUrl).host, checkedAt: new Date().toISOString(), results }, null, 2));
if (results.some((result) => !result.ok)) process.exit(1);
function required(name) { const value = process.env[name]?.trim(); if (!value) throw new Error(`${name} is required; staging validation cannot be marked successful without it`); return value; }
