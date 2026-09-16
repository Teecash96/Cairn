# Cairn security

## Scope

Cairn is a Vue mini app served by a Cloudflare Worker. The Worker stores sessions
and explicit share snapshots in Cloudflare KV. SQLite-backed Durable Objects
coordinate the legacy credit ledger and protected team writes. The browser never receives
the Gemini key, a KV credential, or a private wallet key.

## Controls in this repository

| Area | Control |
| --- | --- |
| API keys | `GEMINI_API_KEY` is a Cloudflare encrypted secret binding. It is never in client code, `wrangler.toml`, or Git. |
| Git secrets | `.env`, `.dev.vars`, Wrangler state, and local strategy files are ignored. Run `npm run security:secrets` before a push. |
| Server auth | Private routes require a short lived bearer session created by an Ed25519 signature over a one time Nimiq challenge. |
| Record access | Credit, payment, refinement, and share writes use the address in the verified session. A body address must match it. |
| Field tampering | Request bodies are bounded and shaped. Plans, flow steps, milestones, tasks, and model output are clamped before use or storage. |
| Bot protection | Challenge, verification, generation, refinement, legacy receipt redemption, teammate reward checks, and sharing have rate limits. A server-observed network address limits abuse, and a daily model budget bounds AI cost. |
| Input limits | JSON bodies, ideas, questions, receipts, plan fields, RPC responses, and Gemini responses have size limits. |
| Output limits | Public plans expose a read only allowlist. JSON responses have a 256 KiB ceiling. |
| Browser security | The Worker sends CSP, HSTS on HTTPS, frame denial, no sniffing, referrer, permissions, opener, and resource policy headers. `assets.run_worker_first` keeps the same policy on static app files. |
| Transport | Non local HTTP requests receive a 301 redirect to HTTPS. Local HTTP remains available for handset testing. |
| Dependencies | `npm run security:deps` runs the production dependency audit. |

## Wallet sessions

Cairn does not ask for a password. Nimiq Pay signs a server challenge in the
wallet. The Worker verifies the signature, derives the address from the public
key, binds the session to that address, and stores only a short lived session
record. The token stays in memory in the mini app. It is not stored in
`localStorage` and Cairn does not use session cookies.

The challenge is single use, expires after five minutes, and is bound to the
wallet address and the observed client IP when both are available. Sessions
expire after twelve hours. KV has no compare and swap operation, so a rare
simultaneous challenge race can create two sessions for the same wallet. It
cannot change the wallet identity.

## Data and storage

Cloudflare manages encryption at rest for KV and Durable Objects. Cairn does not store passwords,
private keys, API keys, payment card data, or uploaded files. A shared plan is
intentionally readable by anyone holding its bearer link because sharing is an
explicit product action. Private plans remain in the browser's local storage.
The app does not expose a database key, so row level security is not applicable.
There is no SQL query layer, so parameterized queries are not applicable.

There are no file upload routes. There is no login password to hash. There are
no cookies to secure. These are absent by design, not skipped protections.

Vue renders user content as text. The repository contains no `v-html` usage and
the Worker never returns HTML built from user input. Static HTML pages contain
only authored content.

## Deployment checklist

1. Set `GEMINI_API_KEY` with `wrangler secret put GEMINI_API_KEY`.
2. Keep `.dev.vars` local and use `.dev.vars.example` as the redacted template.
3. Run `npm run security:secrets`.
4. Run `npm run security:deps`.
5. Run `npm run typecheck`, `npm test`, `npm run build`, and `git diff --check`.
6. Confirm the deployed response has HTTPS, CSP, HSTS, and `x-frame-options`.
7. Review Cloudflare KV and Durable Object access and Worker secrets after every change to the
   deployment account.

Report a suspected vulnerability through a private GitHub security advisory or
by opening an issue without including wallet keys, API keys, or confidential
product text.
