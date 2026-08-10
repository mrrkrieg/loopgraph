# Learn Which Campaigns Create Qualified Pipeline

This Marketing App teaches Hermes to evaluate campaigns using downstream business evidence rather than clicks, impressions, or raw lead counts alone.

It includes five cooperating loops:

1. Campaign Learning creates one durable campaign-cohort problem from spend and conversion evidence.
2. Lead Qualification applies the company ICP and qualification contract to attributed leads.
3. Pipeline Outcome joins opportunities, activation, wins, losses, and observation windows back to the campaign.
4. Channel Allocation prepares reviewable budget or status changes without applying them.
5. ICP Messaging learns which message and segment combinations create qualified and activated pipeline.

Supported stack recipes:

- Google Ads + HubSpot + PostHog
- Meta or LinkedIn Ads + Salesforce + Amplitude

The app starts in shadow mode. Hermes does not rewrite attribution, change budgets, pause campaigns, publish creative, or send internal updates without exact approval. Ambiguous campaign, lead, account, or attribution identity causes Hermes to abstain.

Primary value measures are qualified pipeline per dollar, activated customers, cohort opportunity rate, CAC quality, routing corrections, allocation lift, and review burden.
