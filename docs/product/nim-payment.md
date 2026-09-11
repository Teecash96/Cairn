# Required NIM payment

## Product rule

An authenticated wallet must have a paid credit before Cairn generates or
refines a plan. Production grants no free AI actions.

## Contract

1. One payment of 100,000 Luna, equal to 1 NIM, grants 10 AI actions.
2. The server owns the price, receiving address, and bundle size.
3. The client opens Nimiq Pay or Nimiq Hub only after the server returns HTTP
   402 with a quote.
4. The Worker verifies sender, recipient, amount, and confirmation on the Nimiq
   network.
5. A verified transaction hash can grant credits once.
6. One credit is spent only after Gemini returns a valid result.
7. Cairn stores a wallet credit count. It does not hold a user wallet balance or
   private key.
8. Local payment trust is allowed only on a local host and must never be enabled
   in production.
9. If confirmation is delayed, the client keeps the opaque receipt in session
   storage and checks the Worker with bounded backoff. It never opens a second
   payment prompt for the same pending receipt.

## Scope

NIM is the first payment asset. USDT is not part of this release because it
would add chain selection, gas, wallet compatibility, and a second verifier.

## Release evidence still required

Complete one small payment on a real phone in Nimiq Pay. Confirm that the Worker
detects the transaction, grants exactly 10 credits, spends one credit after a
successful generation, and rejects a second redemption of the same transaction.
