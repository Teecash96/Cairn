# Cairn

**Describe an idea. Get a plan.**

Cairn is a Nimiq Pay mini app that turns a few sentences about a product idea into
a builder pack an indie builder can act on:

- a **product requirements document** — summary, problem, target user, core
  features, user stories, success criteria, and an explicit list of what it
  assumed and what it left out
- a **user-flow diagram** — five to eight connected steps from first open to
  finished task, including one real decision point with both outcomes
- a **Build plan** — a small MVP scope, three milestones, local task checkboxes,
  risks, acceptance tests, and the next action
- a **Reality check** — three prioritized concerns with the smallest test or fix

Every field is editable. Nothing needs an account. Cairn uses practical MVP
planning rather than Scrum process. You pay per AI action, in NIM, and the first
few actions are free.

A cairn is a stack of stones left to mark the route for whoever comes next. That
is what a PRD is for.

---

## Why it exists

The gap between "I have an idea" and "I can start building" is a blank page.
Filling it properly takes a product manager twenty minutes of structured
thinking, and most ideas never get those twenty minutes — so they either die or
get built without a plan.

Cairn is those twenty minutes, on a phone, for about the cost of the inference.

## How it works

1. Describe the idea in your own words. One field is required.
2. Tap **Generate plan**. Nimiq Pay asks you to connect your wallet — this is the
   only time it asks, and it happens on the action you already chose to take.
3. Claude writes the full builder pack. It takes about twenty seconds.
4. Edit anything. It autosaves to your device.
5. Open the **Build** tab, check off local tasks, or ask Cairn to sharpen one
   part of the plan.
6. Copy it out as Markdown, or share a link.

### Planner follow ups

The Build tab has four quick actions: cut MVP scope, break work into smaller
tasks, find missing risks, and improve acceptance tests. You can also ask a
custom question. Cairn shows targeted changes in a preview before applying them.
One AI action costs one credit. Completed task checkboxes stay completed when a
refinement keeps that task.

### Pay it forward

Sharing a plan mints a link that carries a **free generation for whoever opens
it**. They read your plan, tap once, and get their own — paid for by you, without
costing you a credit.

This is the part we like most. NIM moves because someone chose to pass something
on, not because a paywall demanded it.

## Paying

The first few plans are free. After that, one payment buys a **bundle** of plans
rather than a single one — every wallet call opens a native confirmation dialog
that an app cannot suppress, and nobody should have to approve a transaction
between every idea and its result.

- The price is set by the server and shown before you confirm. Nothing is
  hardcoded in the app.
- Payment goes **straight from your wallet to Cairn's receiving address**. Cairn
  never holds your funds and has no balance to withdraw.
- Native NIM transfers inside Nimiq Pay carry no network fee.
- Credits are held against your wallet address. There is no account, no email,
  and no card.

## What leaves your phone

Stated plainly, because it matters:

| Data | Where it goes |
| --- | --- |
| The idea you type | Anthropic's Claude API, via Cairn's server, to write the plan |
| The finished plan | Your device's local storage. **Nothing else.** |
| A plan you tap **Share** on | Cairn's server, so the link can be opened. Explicit, per plan, never automatic |
| Your wallet address | Cairn's server, as the key your credit balance is held against |
| A pseudonymous device identifier | Cairn's server, so free plans can't be farmed with fresh wallets. It identifies the device, not you, and declining it does not block anything |

There is no analytics, no tracking, and no third-party script. The app loads no
external fonts and makes no requests other than to its own API.

Plans are stored per device by design. Clearing the app's storage deletes them,
and there is no copy on a server to restore from — so copy anything you need to
keep.

## Running it locally

```bash
npm install
npm run dev          # http://localhost:5173
```

To run the full local Worker, copy `.dev.vars.example` to `.dev.vars` and add a local Anthropic
key. Then run `npm run build` and `npm run worker:dev`. The Worker uses its local KV store. The
`DEV_TRUST_PAYMENTS=1` setting is available only for local testing and is refused on public
requests. Never commit `.dev.vars`.

Desktop, with no wallet and no API key, is a first-class path: the app detects
that it isn't inside Nimiq Pay, simulates the wallet, and — in a dev build only —
falls back to an obviously-labelled placeholder plan when no backend is reachable.
Every screen and every state is walkable this way.

### On a real device

The only form factor that matters is a portrait phone inside the Nimiq Pay
WebView.

```bash
npm run dev -- --host
```

Then in Nimiq Pay: **Mini Apps → open URL → `http://<your-lan-ip>:5173`**.

Note that LAN HTTP is not a secure context, so `navigator.clipboard` and
`crypto.randomUUID` are absent there. Both have fallbacks
(`src/lib/clipboard.ts`, `src/lib/plan.ts`) — which is the whole reason to test
this way rather than only on `localhost`.

### Build

```bash
npm run build        # vue-tsc -b && vite build
npm test              # Node's built-in test runner
```

## Layout

```
src/
  lib/
    nimiq.ts       Nimiq Pay SDK wrapper. Provider methods RESOLVE with
                   `T | ErrorResponse` rather than throwing, so every call goes
                   through unwrap().
    session.ts     Which mode are we in, and whose wallet is this
    units.ts       Luna ⇄ NIM. 1 NIM = 100,000 Luna; Luna everywhere internally
    plan.ts        The data model, and the on-device library
    api.ts         Typed client for the server
    markdown.ts    Plan → Markdown / plain text
    clipboard.ts   Copy, with a non-secure-context fallback
    stub.ts        Offline placeholder generator, dev only
  components/
    NewPlan.vue      Screen one: the description
    Workspace.vue    One plan: Brief, Flow, and Build behind three tabs
    PrdView.vue      The PRD, readable and editable
    FlowDiagram.vue  The flow diagram
    BuildView.vue    Milestones, tasks, risks, tests, and reality check
    RefineSheet.vue  Preview and apply targeted planner follow ups
    Library.vue      Everything you have made
    PaySheet.vue     Top up, in NIM
  tests/
    client/          Migration, task progress, and targeted merge tests
    worker/          Shape, credit, payment, and share tests
```

## Stack

Vue 3 + TypeScript + Vite on the front, a Cloudflare Worker with KV behind it.
No component library, no CSS framework, no webfont, no analytics. Type checking
is strict, including `erasableSyntaxOnly` and `verbatimModuleSyntax`.

No API key, secret, or credential is committed to this repository. The Anthropic
key lives only in an encrypted Cloudflare secret binding.

## Licence

MIT — see [LICENSE](LICENSE).

Built for the [Nimiq Mini Apps Competition](https://miniappscompetition.com).
