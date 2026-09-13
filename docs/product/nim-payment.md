# Optional NIM support

## Product rule

Cairn plans and planner refinements are free. A signed Nimiq wallet session is
still required for AI requests and protected team access, so the app keeps a
real Nimiq identity flow without putting a payment wall in front of the user.

## Optional support path

1. The app can open Nimiq Pay when a user explicitly chooses **Support Cairn**.
2. The Worker owns the receiving address, amount, and verifier settings.
3. The Worker verifies sender, recipient, amount, and network confirmation.
4. A verified transaction hash is accepted once. Retrying it cannot grant a
   second result.
5. Existing ledger balances and saved receipts remain valid for compatibility.
   They are never required to generate or refine a plan.
6. If confirmation is delayed, the client keeps the opaque receipt in session
   storage and checks the Worker with bounded backoff. It never asks for a
   second payment for the same receipt.
7. Local payment trust is allowed only on a local host and must never be
   enabled in production.

## Nimiq integration

Nimiq Pay is used for wallet authentication and for the voluntary NIM support
flow. The Nimiq Mini App template also gives builders a concrete NIM checkout,
confirmation, and recovery journey to adapt in their own projects. USDT is not
part of this release.

## Release checks

Test free generation and refinement with an authenticated wallet. Separately,
if a supporter completes a real NIM transfer, confirm that the Worker verifies
it once and that a retry does not grant it twice. Do not initiate a real
transfer during automated QA.
