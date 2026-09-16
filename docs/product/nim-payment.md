# Legacy NIM credit ledger

## Product rule

Cairn plans and planner refinements are free. A signed Nimiq wallet session is
required for AI requests and protected team access. Cairn has no donation or
support checkout.

## Compatibility rule

1. Existing ledger balances and receipt protections remain available for
   backwards compatibility.
2. They are never required to generate or refine a plan.
3. New user-facing payments are direct rewards from an owner to a named
   teammate for completed work.
4. Local payment trust is allowed only on a local host and must never be
   enabled in production.

## Nimiq integration

Nimiq Pay is used for wallet authentication and direct teammate rewards. The
Nimiq Mini App template gives builders a concrete NIM checkout, confirmation,
and recovery journey to adapt in their own projects. USDT is not part of this
release.

## Release checks

Test free generation and refinement with an authenticated wallet. Separately,
use two test wallets to verify one small teammate reward and its recorded proof.
Do not initiate a real transfer during automated QA.
