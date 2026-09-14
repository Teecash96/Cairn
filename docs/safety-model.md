# Cairn safety model

This document states what Cairn protects, where it trusts another system, and
what it does when a dependency fails. It is a practical control model for the
current release. It is not a claim that Cairn is risk free.

## Scope

Cairn handles product ideas, structured planning output, local task progress,
public Track shares, protected Track teams, wallet signatures, optional NIM
transfers, and legacy credit receipt recovery.

Cairn does not custody funds, manage private keys, store seed phrases, provide
encrypted cloud backup for private plans, or guarantee that an AI generated plan
is correct or complete.

## Security objectives

1. A wallet session must belong to the wallet that signed the challenge.
2. A client must not be able to choose another wallet's private records.
3. User input and provider output must stay within bounded shapes and sizes.
4. Public and team sharing must disclose only the documented projection.
5. A legacy receipt can grant a balance at most once.
6. A ledger outage must not send writes to a second balance store.
7. A failed generation must not consume a paid credit.
8. An optional NIM transfer must require explicit wallet approval.
9. Production must never use the local payment bypass.

## Trust boundaries

| Boundary | Assumption | Control |
| --- | --- | --- |
| Browser to Worker | The browser can be modified by the user or an attacker | Authenticate every private route and validate every request again on the Worker |
| Browser to wallet | The wallet controls the private key and may return a different selected account | Bind challenges and payment receipts to the actual signed address; reject a changed wallet |
| Worker to planning service | The provider can be slow, unavailable, malformed, or wrong | Timeout, response size limit, schema validation, semantic checks, and safe error messages |
| Worker to Nimiq RPC | RPC data can be delayed or unavailable | Fail closed unless sender, recipient, amount, and confirmation checks pass |
| Worker to KV | KV has eventual consistency and no compare and swap | Use short expiries for ephemeral records and do not use KV for current balance mutations after cutover |
| Worker to Durable Object | The object is the single balance authority | Use one named object and one SQLite transaction for balance and receipt changes |
| Public share URL | A bearer link can be copied | Share only an allowlisted read only projection and tell the owner that the link is public |
| Team invite URL | The URL can be forwarded | Treat it as a locator. Require a wallet session and a matching member record on every request |

## Assets and impact

| Asset | Impact if exposed or changed |
| --- | --- |
| Provider API key | Unauthorised provider cost and service disruption |
| Wallet session token | Temporary access as that wallet until expiry |
| Private local plan | Loss of product confidentiality or work |
| Public share snapshot | Intended public disclosure, but may still contain sensitive product text |
| Team Track projection | Unauthorised view or change of shared execution data |
| Legacy credit balance | Unauthorised AI use or financial loss |
| Receipt replay marker | Double grant or cross wallet redemption |
| Payment recipient and price configuration | Incorrect verification or funds sent to the wrong destination |

## Threats and controls

### Wallet and session abuse

The Worker creates a single use challenge with a five minute expiry. The wallet
signs the challenge. The Worker verifies the Ed25519 signature, derives the
address from the public key, and checks any address supplied by the client. The
session expires after twelve hours. The token stays in memory in the client and
is not stored in a cookie or local storage.

An attacker can still ask the genuine wallet owner to sign a challenge. Cairn
cannot protect a user who approves a malicious wallet prompt. The UI must never
ask for a seed phrase, private key, password, or wallet export.

### Request tampering and prompt abuse

All JSON bodies are size limited. Ideas, questions, plan fields, lists, flow
steps, milestones, tasks, RPC responses, and provider responses are bounded.
The Worker clamps inbound plans and validates the structured output before it
reaches the client. Private task metadata is not sent to the planning service.

Per wallet and per IP rate limits slow loops. A UTC daily service budget bounds
provider spend. The budget counts an attempt before the provider call because an
upstream provider may charge for a failed response. A limit response does not
change a user's local plan or paid balance.

### Cross wallet access

Every private route reads the address from the verified session. If a request
body includes an address, it must normalize to that session address. Credit
reads, receipt redemption, sharing, team creation, and team updates use this
same rule. Team membership is checked again for each read and write.

### Plan disclosure

Private plans stay in browser storage. A public share stores a restricted
projection. A team workspace stores only Track fields needed by members. Neither
projection includes the PRD, user flow, private notes, priorities, dependency
details, or builder log entries unless the product explicitly documents a field
as shared.

Public links are bearer links. Anyone who receives one can read it until its KV
record expires. Do not put confidential material in a public share.

### Payment and ledger abuse

The legacy redemption route verifies transaction data through the configured
Nimiq RPC. It requires the configured recipient, an amount at least the required
price, the authenticated sender, and a confirmation or positive block number.
Canonical transaction hashes are matched directly. Delayed or malformed RPC
data is not treated as payment.

Only a verified transaction hash reaches the ledger. The named
`CreditLedger` Durable Object writes the balance and `spent:<hash>` marker inside
one SQLite transaction. A retry for the same new receipt returns no second grant.
An old `spent:*` marker blocks redemption because its historical grant cannot be
reconstructed safely. A failed ledger call returns a maintenance error and never
falls back to KV writes.

The ledger cutover is a separate operational safety boundary. Operators must
freeze and reconcile the old KV records before setting `CREDIT_LEDGER_READY=1`.
They must not restore the old KV writing Worker after the Durable Object accepts
writes. See [credit ledger cutover](credit-ledger-cutover.md).

### Provider failure and bad output

Provider calls have a timeout and response ceiling. The Worker rejects malformed
or semantically incomplete output and returns a generic message. Internal logs
contain only a short failure detail. Provider keys never reach the browser.

A planning failure does not mutate paid credit state. The daily budget can still
count the attempt. A user can retry after the service or network recovers.

### Browser and transport threats

The Worker applies HTTPS redirect, CSP, HSTS on HTTPS, frame denial, no sniffing,
referrer, permissions, opener, and resource policy headers. Vue renders user
content as text. The repository has no `v-html` path and no file upload route.
There are no authentication cookies.

Local HTTP is allowed only for handset testing. It is not a production security
boundary.

## Failure handling

| Failure | Expected result |
| --- | --- |
| User rejects wallet connection or signature | No session and no plan request |
| Wallet changes between sign in and payment | Payment stops and the user must sign in again |
| Challenge expires or is reused | Authentication fails; create a new challenge |
| Provider timeout or malformed output | Safe generation error; local plan remains unchanged |
| Rate limit or daily budget reached | Clear retry or next day message; no credit mutation |
| RPC cannot see a transfer yet | `payment_not_found`; user must wait and check, not pay again |
| Transfer came from another wallet | `payment_wrong_wallet`; connect the sending wallet before checking |
| Ledger unavailable | Maintenance response; never retry against KV or ask the user to pay again |
| Stale team revision | Conflict response; reload before editing |
| Expired share or missing team | Not found response; no fallback to private data |

## Privacy commitments

Cairn receives a wallet address for a short lived identity session. It does not
receive private keys or seed phrases. It has no password database, payment card
store, uploaded file route, analytics system, third party script, or external
font dependency.

The original idea and optional context go to the planning service when the user
generates a plan. A refinement sends only the fields needed for that targeted
change. A public share or team workspace is an explicit disclosure by the
owner. Clearing browser storage removes private local plans. There is no private
server backup to restore them.

## Non guarantees

* A generated plan can contain wrong, incomplete, or unsuitable advice.
* A reality check is not a security, legal, financial, or market review.
* A public share can be copied by anyone who receives its URL.
* Local plans can be lost when browser storage is cleared or unavailable.
* Nimiq confirmation time and RPC availability are outside Cairn's control.
* An approved wallet transfer cannot be reversed by Cairn.
* Rate limits reduce abuse risk but do not prove that a request is human.

## Release checklist

Before release:

1. Run `npm test`, `npm run typecheck`, and `npm run build`.
2. Run `npm run security:deps`, `npm run security:secrets`, and
   `git diff --check`.
3. Confirm `GEMINI_API_KEY` is an encrypted secret and absent from Git.
4. Confirm `DEV_TRUST_PAYMENTS` is absent or off in production.
5. Confirm the existing `CAIRN` KV namespace, `CREDIT_LEDGER` binding, object
   name, and migration history are unchanged.
6. For a ledger release, follow the full freeze, backup, drain, and
   reconciliation procedure before enabling the readiness gate.
7. Verify the live site with a read only request and test free planning with an
   authenticated wallet. Do not make a real transfer during automated QA.
8. Ask the wallet owner to approve any real NIM action and record the result.

## Reporting

Do not report a vulnerability with a wallet key, seed phrase, provider secret,
or confidential plan text. Use a private GitHub security advisory or contact the
maintainer through a private channel.
