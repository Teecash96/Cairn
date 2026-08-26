# Ecoflow

A shared living grid inside [Nimiq Pay](https://nimiq.com/pay).

One 6×6 grid that every player sees. Each tile is a plant.

- **Seeding bare soil is free.** You can hold up to three tiles at a time.
- A planted tile **grows through five stages** while it's left alone.
- **Anyone can take any tile by paying its current value straight to whoever holds it** —
  wallet to wallet, in NIM. Value comes from *growth*, not from what anyone paid:
  **1 / 2 / 4 / 8 NIM** as it matures.

So letting a plant grow is literally how you get paid more. Nobody loses NIM when their tile is
taken — they profit. **Ecoflow holds no treasury and never touches the funds.**

## Flow

Above the grid is one number that belongs to nobody: **Flow**.

It rises while the grid is left to grow, and falls every time someone takes a tile. High Flow
makes everything grow faster for **everyone**. Low Flow stalls it for everyone.

Taking a tile is good for you and bad for the grid. That tension is the whole game — and none of
it is self-reported. It's all derived from real on-chain payments.

## Running it

```sh
npm install
npm run dev -- --host     # --host exposes it on your LAN
```

Open `http://localhost:5173` in a browser for the **preview mode** — the grid is fully playable
and payments are simulated, so you can explore without a wallet.

To play for real, open Nimiq Pay on your phone → **Mini Apps** → enter your machine's LAN address
(`http://192.168.x.x:5173`). Phone and computer must be on the same network.

> LAN HTTP is not a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts),
> so browser APIs gated behind HTTPS are unavailable during LAN testing. Feature-detect anything
> in that category rather than assuming it exists.

```sh
npm run build      # typecheck (vue-tsc) + production build
npm run preview    # serve the production build
```

## How it's put together

| Path | What it does |
|---|---|
| `src/lib/units.ts` | Luna⇄NIM conversion. **1 NIM = 100,000 Luna** — every provider amount is Luna. |
| `src/lib/nimiq.ts` | Wrapper over `@nimiq/mini-app-sdk`, including the `unwrap()` guard described below. |
| `src/lib/game.ts` | Pure rules: pricing, growth stages, Flow, the protection window. No I/O. |
| `src/lib/store.ts` | `GridStore` interface + a localStorage implementation. |
| `src/lib/session.ts` | Wallet and runtime-mode state (`nimiq` vs `preview`). |
| `src/components/` | Grid, tile, plant SVG, Flow meter, claim sheet, wallet bar. |

### Two things worth knowing if you're reading the SDK docs alongside this

1. **Provider methods resolve with `T | ErrorResponse`. They do not throw.** A declined prompt
   comes back as `{ error: { type, message } }` on the promise's happy path, so a bare
   `try/catch` reads a refusal as success. Everything goes through `unwrap()` in
   `src/lib/nimiq.ts`.
2. **`init()` polls `window.nimiq` for up to 10 seconds** and rejects outside Nimiq Pay. Waiting
   that out would mean a ten-second blank screen for anyone opening the URL in a normal browser,
   so `isInsideNimiqPay()` checks for the synchronously-seeded host objects first and falls back
   to preview mode straight away.

### State

`GridStore` is deliberately async and coarse-grained so the local implementation can be swapped
for an HTTP client without touching a component.

The server's job is the part that matters: **the client has no authority to assert that it paid.**
A claim carries the receipt from `sendBasicTransaction`, and the server resolves that against a
Nimiq node — confirming recipient and amount — *before* the tile moves.

## Licence

MIT
