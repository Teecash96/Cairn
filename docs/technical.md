# Cairn technical reference

This is the implementation reference for the current Worker and client. Public
product language is kept in the README. Internal provider names and deployment
bindings are listed here only where an operator needs them.

## Runtime model

The repository builds two parts:

* Vite compiles the Vue 3 client into `dist`.
* Wrangler deploys `worker/index.ts` and serves `dist` through the `ASSETS`
  binding.

The Worker handles `/api/*` and then falls back to the static asset binding. The
same origin means production client requests use `/api` without a separate CORS
host. Local Vite development can use the offline stub or a Worker started with
`VITE_API_BASE`.

## API routes

All private routes require `Authorization: Bearer <short lived session token>`.
JSON errors use a stable `error` code and a user safe `message`.

| Method | Route | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/auth/challenge` | No | Create a one time wallet signing challenge. An optional `address` binds it to a selected wallet. |
| POST | `/api/auth/verify` | No | Verify the Ed25519 signature, consume the challenge, and issue a short lived session. |
| GET | `/api/credits` | Yes | Read legacy paid credit state and the configured legacy receipt quote. Planning does not depend on this balance. |
| POST | `/api/generate` | Yes | Validate the idea, enforce fair use, call the planning service, and return a structured draft. |
| POST | `/api/refine` | Yes | Generate a targeted change proposal for a bounded plan and requirement. |
| POST | `/api/redeem` | Yes | Verify a legacy NIM receipt and atomically redeem it in the Durable Object ledger. |
| POST | `/api/anchor/verify` | Yes | Verify a confirmed self transfer carrying the exact PRD hash. |
| POST | `/api/share` | Yes | Store an allowlisted public Track projection and return a share URL. |
| GET | `/api/share/:id` | No | Read a public snapshot. Expired or unknown IDs return `not_found`. |
| POST | `/api/team` | Yes | Create or retry creation of one protected Track workspace for a plan. |
| GET | `/api/team/:id` | Yes | Read the team view for the authenticated owner or member. |
| POST | `/api/team/:id/members` | Yes | Owner adds a wallet, role title, and viewer or editor role. |
| PATCH | `/api/team/:id/members/:address` | Yes | Owner changes a member permission. |
| DELETE | `/api/team/:id/members/:address` | Yes | Owner removes a member. |
| PUT | `/api/team/:id/tracker` | Yes | Owner or editor updates the Track projection with an expected revision. |

Unknown API routes return the normal branded 404 response through the asset
fallback. HTTP requests from non local hosts redirect to HTTPS.

## Client data model

The client stores a `Plan` in `localStorage` under `cairn.library.v3`. Older v1
and v2 records are migrated on read. A plan contains:

| Field | Owner | Notes |
| --- | --- | --- |
| `input` | Client | Original idea and optional audience, problem, and goal. |
| `prd` | Planning service draft, then client edits | Product requirements and explicit assumptions. |
| `flow` | Planning service draft, then client edits | Five to eight steps with one decision point. |
| `build` | Mixed | Service supplies scope, milestones, risks, and acceptance tests. Client adds IDs, status, dates, notes, priorities, dependencies, and blockers. |
| `realityCheck` | Planning service draft, then client edits | Three prioritized concerns and practical tests or fixes. |
| `builderLog` | Client | Private daily progress entries. |
| `anchor` | Client after wallet approval | Local hash, receipt, address, and pending or verified state. |
| `shareId` and `teamId` | Client after server action | Locators for explicit sharing. |

Task and milestone IDs are client authored. The planning service never controls
progress or invents calendar dates. Refinement maps unchanged task text back to
its stable ID and keeps local progress. Replaced or completed tasks require an
owner review in the UI.

## Server storage

| Store | Keys | Data | Write rule |
| --- | --- | --- | --- |
| CAIRN KV | `challenge:*`, `session:*` | One time challenges and short lived wallet sessions | Worker only, with expiration |
| CAIRN KV | `share:*` | Public allowlisted plan snapshots | Explicit share action |
| CAIRN KV | `team:*`, `team:owner:*` | Protected Track projection and owner lookup | Authenticated owner or permitted editor |
| CAIRN KV | `rl:*`, `budget:*` | Fair use counters and the UTC daily service budget | Worker limiter |
| CAIRN KV | `credit:*`, `spent:*` | Legacy balances and receipt replay markers | Read only migration source and replay guard after cutover |
| CreditLedger Durable Object | `credit:<address>` | Current paid balance | Atomic transaction only |
| CreditLedger Durable Object | `spent:<hash>` | Newly redeemed receipt marker with payer and amount | Same atomic transaction as the grant |

The Durable Object is named with `idFromName('cairn-credits-v1')`. The Wrangler
migration tag is `v1-credit-ledger`. It imports a legacy balance on first access
inside a transaction, persists even a zero balance, and never falls back to KV
writes when unavailable.

## Authentication

1. The client requests a challenge.
2. The Worker stores the challenge, expiry, optional address, client IP, and
   unused state in KV.
3. Nimiq Pay or Hub signs the challenge message.
4. The Worker verifies the Ed25519 signature and derives the Nimiq address from
   the public key.
5. The Worker consumes the challenge and stores a random bearer session with a
   twelve hour expiry.
6. Each private request is bound to the session address. A body address is
   accepted only when it normalizes to that address.

The client keeps the bearer token in memory. It does not put wallet authority in
local storage or cookies.

## Generation and refinement

`worker/shape.ts` bounds request size, text length, array length, flow shape,
milestone count, task count, and response fields. The planning adapter uses a
timeout and a response size ceiling. A structured response is semantically
validated before it is returned. The Worker logs a short internal failure detail
but sends a generic user safe error.

The fair use path checks a short address limiter, the global UTC daily budget,
and the encrypted provider key. The budget is charged before the provider call
because an upstream service can charge for a failed or incomplete response.
Planning failures do not mutate paid credit state.

## Ledger and payment verification

The legacy redemption path does not trust the receipt returned by the wallet SDK.
`worker/payments.ts` reads transaction history or a canonical transaction hash
from the configured Nimiq RPC and checks:

* recipient equals configured `PAY_TO`
* sender equals the authenticated wallet
* value is at least configured `PRICE_LUNA`
* the transaction has a confirmation or positive block number
* a canonical supplied hash matches the inspected transaction

A wrong wallet is returned as `payment_wrong_wallet`. A missing, delayed, or
malformed transaction is returned as `payment_not_found`. Only a verified hash is
sent to the ledger. The object records the receipt marker and the credit grant
in one SQLite transaction. A repeated receipt returns `granted: 0`; a receipt
already present in legacy `spent:*` is rejected because its historical grant
cannot be inferred safely.

The current product does not require redemption for planning. Keep this path for
existing balances and recovery. Follow the cutover guide before changing any
binding, migration, or readiness setting.

## Local development

```bash
npm ci
npm run dev
```

For the Worker path:

```bash
cp .dev.vars.example .dev.vars
# Add local secret values. Never commit this file.
npm run build
npm run worker:dev
```

To point Vite at a local Worker, set `VITE_API_BASE` in the shell before
starting Vite. Without it, local Vite uses the clearly labelled offline stub
generator. The synthetic wallet exists only for that local preview.

## Verification commands

```bash
npm test
npm run typecheck
npm run build
npm run security:deps
npm run security:secrets
git diff --check
```

The tests cover client migrations, tracker calculations, targeted merges, auth,
limits, shaping, sharing, teams, payment inspection, and concurrent Durable
Object ledger operations. They use local test runtime fixtures. They do not send
a production payment.

## Deployment configuration

`wrangler.toml` keeps the existing Worker and storage identity:

| Setting | Role |
| --- | --- |
| `name = "cairn"` | Production Worker name |
| `CAIRN` | Existing Cloudflare KV namespace |
| `CREDIT_LEDGER` | Existing Durable Object binding |
| `v1-credit-ledger` | SQLite migration history |
| `ASSETS` | Built static application |
| `GEMINI_API_KEY` | Encrypted provider secret binding |
| `PAY_TO`, `PRICE_LUNA`, `PLANS_PER_PAYMENT` | Legacy receipt quote and verification settings |
| `NIMIQ_RPC_URL` | Transaction inspection endpoint |
| `DAILY_BUDGET` | Global free planning ceiling |
| `CREDIT_LEDGER_READY` | Explicit cutover gate, enabled only after reconciliation |
| `DEV_TRUST_PAYMENTS` | Local test bypass, must be absent or off in production |

Deploy with `npm run worker:deploy` only after the checks pass. Do not create a
new Worker, KV namespace, Durable Object binding, migration, or secret to solve a
deployment problem. See [credit ledger cutover](credit-ledger-cutover.md) for
maintenance and reconciliation steps.
