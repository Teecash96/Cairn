# Nimiq payments and wallet identity

## Product rule

Cairn plans and planner refinements are free. A signed Nimiq wallet session is
required for AI requests and protected team access. No payment wall is shown
for planning work.

## Product payment actions

1. A PRD anchor writes a Blake2b hash in a one Luna self transfer.
2. A completed milestone can trigger a direct bounty from the owner wallet to
   the collaborator wallet.
3. A public plan can show a voluntary builder tip for its creator.
4. Nimiq Pay shows the wallet confirmation. Cairn does not custody these
   payments or decide disputes.

## Legacy receipt compatibility

The Worker keeps the credit ledger and receipt verifier for existing balances.
A saved receipt can be checked without asking for a second payment. A verified
transaction hash is accepted once. Local payment trust is allowed only on a
local host and must never be enabled in production.

## Nimiq integration

Nimiq Pay is used for wallet authentication and explicit product payments. The
Nimiq Mini App template gives builders a concrete NIM checkout, confirmation,
and recovery journey to adapt in their own projects. USDT is not part of this
release.

## Release checks

Test free generation and refinement with an authenticated wallet. Test anchors,
bounties, and builder tips only with explicit user approval. Do not initiate a
real transfer during automated QA.
