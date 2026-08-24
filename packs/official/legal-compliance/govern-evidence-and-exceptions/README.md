# Govern Legal, Security, and Compliance Evidence

This official Loopgraph App gives Hermes six governed Legal & Compliance loops while keeping legal interpretation, policy exceptions, risk acceptance, breach decisions, privileged access, attestations, and external claims under qualified human control.

Hermes receives normalized evidence events, resolves the exact affected company object and version, and chooses one primary loop. Contract or incident work may invoke one supporting loop only when the signed topology condition is proven. Otherwise Hermes routes one loop or abstains.

## Included loops

- Contract Exception Triage
- Policy and Control Drift
- Privileged Access Review
- Incident Evidence
- Security Questionnaire
- Compliance Evidence Gap

## Supported stack recipes

- Ironclad + Vanta + Okta + Salesforce + Slack
- DocuSign CLM + Drata + Entra + HubSpot + Teams

The recipes declare capability and event normalization contracts. Credentials remain in the Connector Broker and never enter the pack or Hermes context. Reads are bounded to a declared contract, control, access grant, incident window, questionnaire, or audit request.

## Safety model

- Every assertion preserves source, version, scope, freshness, provenance, ownership, and reuse limits.
- Legal conclusions, policy exceptions, risk acceptance, breach and notification decisions, access changes, attestations, and external-claim approval are human-owned.
- Customer-facing contract comments and security answers require exact prepared-action approval and separate send authority.
- Access analysis, approval, and execution remain separated.
- Missing current evidence stays a visible gap; the app cannot fabricate evidence or infer assurance.
- Every loop starts in shadow mode and simulation produces zero provider writes.

Run `loopgraph app validate packs/official/legal-compliance/govern-evidence-and-exceptions` before publishing or installing a modified version.
