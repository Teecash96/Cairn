# Credit ledger cutover

This release moves balances and receipt consumption from Workers KV into one
SQLite-backed Durable Object. `CREDIT_LEDGER_READY = "0"` deliberately keeps
credit operations unavailable until the existing ledger has been frozen and
reconciled. Do not enable it during a gradual rollout alongside the old Worker.

## First production deployment

1. Schedule a brief payment/AI maintenance window. Back up the existing CAIRN
   namespace's `credit:*` and `spent:*` records using the account's approved
   export process. Treat this export as private financial data.
2. Deploy this version with `CREDIT_LEDGER_READY = "0"` to 100% of traffic.
   Stop or remove any other deployments that can write these legacy keys.
   Local editing and saved plans remain available; paid AI actions do not.
3. Drain requests from the old version. Verify the old version receives no
   traffic and that its outstanding generation and redemption requests have
   ended. Do not infer this merely from a successful deployment command.
4. Wait for legacy KV propagation/caches to settle and verify the frozen export
   against the final balances and receipts. Reconcile known lost grants or
   receipts written without a credit grant with payment records. This migration
   cannot reconstruct balances already corrupted by historical lost updates.
   Preserve historical receipt keys and normalize any mixed-case transaction
   hash keys to lowercase before opening the new ledger (do not delete the originals).
5. Deploy with `CREDIT_LEDGER_READY = "1"` after reconciliation. Preserve the
   `CREDIT_LEDGER` binding, `CreditLedger` class and `cairn-credits-v1` object name.
   Record this enabled setting in the deployment configuration so the next
   deployment does not accidentally return the service to maintenance mode.
6. Verify balances with existing wallets. Check a new payment, a repeated
   receipt, one successful AI action, and a failed generation before ending
   the maintenance window. The wallet owner completes any real transfer.

The Wrangler migration `v1-credit-ledger` creates the object class. It does not
copy existing KV values by itself. Each wallet's frozen balance is imported on
first access within a storage transaction and then owned by the Durable Object.
Old `spent:*` records remain a read-only replay guard. Keep the KV namespace and
these legacy records; deleting them would make old receipts redeemable again.

## Atomic guarantees

- Balance check and deduction are one transaction.
- A verified receipt's marker and its credit addition are one transaction.
- Retrying a newly redeemed receipt from the same wallet returns the current
  balance and `granted: 0`, without granting again.
- Another wallet cannot reuse that receipt.
- Previously spent legacy receipts are rejected; their historical grant cannot
  be safely inferred from their marker alone.
- AI failures before spending still leave credits unchanged. This change keeps
  the existing post-generation charging policy: concurrent requests may both
  compute, but only available credits can be spent and an unpaid result is not
  returned. It does not add AI-result caching or end-to-end request idempotency.

## Recovery

If verification fails, set `CREDIT_LEDGER_READY` back to `"0"`. Preserve both
stores for reconciliation. Do not roll back to the old KV-writing Worker after
the new ledger has accepted writes: that would split balances between stores
and reintroduce the concurrency bug. Fix forward with the same binding, class,
object name, and stored records.

## Tests

`npm test` runs the ledger against Wrangler's local Miniflare/workerd runtime
with SQLite Durable Object storage. Regression cases cover 12 concurrent
spends, 12 concurrent grants, duplicate/cross-wallet receipts, legacy migration,
failed grants, and a deliberately injected failure after writes but before
transaction commit. The fault-injecting class exists only in tests.

No production payment or deployment is performed by these tests.
