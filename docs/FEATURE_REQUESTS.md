# Feature Requests (prioritised, from our actual integration experience)

| # | For | Request | Why (what we hit) |
|---|---|---|---|
| 1 | Alexa+ for Builders | Publish the **Local Inspector**, or a read-only add-on linter, on public npm with no partner gating | We couldn't check functional requirement #13, latency or MCP Apps rendering against Amazon's own checker (F-03) |
| 2 | Alexa+ for Builders | **Proactive add-on nudges**: a scheduled, user-approved "time to start your morning" from an add-on, or a documented way to pair one with a native Alexa Routine | Routine coaching needs a trigger. Today an add-on can only answer when asked |
| 3 | Alexa+ for Builders | A **"speak verbatim" hint** in tool results, e.g. `_meta.alexa.speech.verbatim: true`, that Alexa+ honours | Some audiences need identical wording. We rely on `instructions` and a `speech` field, but can't verify that Alexa+ won't paraphrase |
| 4 | Alexa+ docs | One **protocol-version table** for the Alexa+ client (what it sends, what it accepts) and **one latency requirement**, with where it is measured | F-01 and F-02 |
| 5 | Alexa+ for Builders | Per-person **account-linking test tokens in the simulator**, so a builder can see two household members (a learner and a coach) acting on the same add-on | Role-scoped tools are a natural fit for supported living, but can't be tested end to end |
| 6 | Alexa+ design guide | An **MCP Apps reference host**, an open-source Echo Show-faithful renderer for local development | We built our own 768×480 host. Every builder will build their own, with drift |
| 7 | MCP TypeScript SDK | Accept **Buffer bodies** (serverless adapters) and treat `allowedHosts: []` as unset, or warn | Both cost us debugging time on Lambda (see Product Feedback §4) |
| 8 | MCP conformance suite | A **"product server" profile**: transport, lifecycle, security and declared capabilities only | 24 of 30 scenarios fail against any non-fixture server, so the results don't mean anything |
| 9 | AWS SAM | A predictable or exportable **Function URL host before deploy**, or a documented pattern for Host-allowlisting it | Two-step deploys for DNS-rebinding protection |
| 10 | Fire TV | A slim or cloud-hosted **Vega Virtual Device** for hackathons | A 20 GB install ruled the track out on a small laptop (F-05) |
