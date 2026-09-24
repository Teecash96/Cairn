# Privacy-safe usage evidence

Cairn publishes real product use at
[cairn.cairn-planner.workers.dev/usage](https://cairn.cairn-planner.workers.dev/usage).
The dashboard lets competition judges verify adoption without publishing a user
list or adding surveillance analytics.

## What counts

| Metric | Definition |
| --- | --- |
| Verified wallets | Distinct Nimiq wallets that completed a signed Cairn login |
| Activated wallets | Distinct verified wallets that completed at least one meaningful product action |
| Repeat wallets | Distinct wallets active on two or more UTC days |
| Active today | Distinct verified wallets with an event on the current UTC day |
| Active in 7 days | Distinct verified wallets with an event in the current seven-day UTC window |
| Plans generated | Successful AI plan responses |
| Plan refinements | Successful targeted AI follow-ups |
| Shares created | Successful creation of a revocable public snapshot |
| Team workspaces | Successful protected team workspace creation |
| Team participants | Distinct wallets that created or opened a protected team workspace |
| Team actions | Successful tracker saves, assignments, submissions, approvals, and returns |
| Rewards confirmed | Direct teammate reward transactions verified on the public Nimiq network and recorded once |
| NIM rewarded | The sum of verified direct teammate reward amounts |

Product events are written only after the action succeeds. A failed generation,
invalid assignment, rejected proof, or unconfirmed payment does not inflate the
corresponding total. Counts begin when `UsageLedger` is deployed; the system does
not invent historical use from old logs.

## How distinct users stay private

1. The existing wallet challenge proves control of a Nimiq address.
2. The Worker sends the normalized address through an internal Durable Object
   call. The endpoint is not public.
3. `UsageLedger` creates a random 256-bit HMAC key inside its private storage.
4. It stores `HMAC(key, wallet address)` as the user key and discards the raw
   address from the usage record.
5. The public API calculates aggregates and returns no user rows or digests.

A plain hash would be unsafe because public Nimiq addresses could be guessed and
matched. A keyed HMAC prevents that comparison. The key never enters the source
repository, browser, public API, or Cloudflare environment variables.

## Data that is not collected

The usage ledger does not store:

- raw wallet addresses or wallet balances;
- IP addresses, user agents, device fingerprints, or analytics cookies;
- idea text, prompts, generated plans, reports, task text, or private notes;
- public transaction hashes; or
- page-view and click streams.

Operational logs remain separate and sampled. They contain only API category,
HTTP method, status, and duration.

## Campaign links

Community posts can use a small first-party label:

```text
https://cairn.cairn-planner.workers.dev/?ref=x-launch
https://cairn.cairn-planner.workers.dev/?ref=nimiq-community
https://cairn.cairn-planner.workers.dev/?ref=discord-demo
```

The label is kept in `sessionStorage` for the current tab and attached to the
next successful wallet verification. It is not a tracking cookie. The public
dashboard suppresses a label until at least three distinct wallets share it, so
a small cohort does not identify a person.

## Judge and maintainer checks

- Open `/usage` without a wallet. It must return aggregate evidence.
- Inspect `GET /api/usage`. It must contain counts, not addresses or user rows.
- Follow the implementation in `worker/usage.ts` and its tests in
  `tests/worker/usage.test.ts`.
- Confirm `USAGE_LEDGER` and migration `v3-usage-ledger` in `wrangler.toml`.
- Run `npm run check` before deployment.

The dashboard is public evidence, not an admin console. There is deliberately no
endpoint that lists wallets or reverses anonymous identifiers.
