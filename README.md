# Cairn

**Describe an idea. Get a plan.**

Cairn is a Nimiq Pay mini app that turns a few sentences about a product idea into
a builder pack an indie builder can act on:

- a **product requirements document** — summary, problem, target user, core
  features, user stories, success criteria, and an explicit list of what it
  assumed and what it left out
- a **Visual PRD** — a one page canvas that shows the problem, user, promise,
  first release, proof, and guardrails in one scan
- a **user-flow diagram** — five to eight connected steps from first open to
  finished task, including one real decision point with both outcomes
  - a **Build plan** — a small MVP scope, three milestones, risks, acceptance
    tests, and the next action
  - a **Track workspace** — a local project board and timeline for milestones,
    task status, due dates, labels, priorities, notes, and simple blockers
- a **Reality check** — three prioritized concerns with the smallest test or fix

Every field is editable. Your plan is local by default. Cairn uses practical MVP
planning rather than Scrum process. You pay per AI action, in NIM, and the first
few actions are free. An optional protected team workspace lets the owner share
only Track with named Nimiq wallets.

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
2. Tap **Generate plan**. In Nimiq Pay, Cairn asks the injected wallet to connect
   and sign a short login challenge. In Chrome, Nimiq Hub opens the wallet for the
   same signature flow. This creates a short lived server session. The prompt
   happens on the action you already chose to take.
3. Gemini writes the full builder pack. It takes about twenty seconds.
4. Edit anything. It autosaves to your device.
5. Open **Visual PRD** for a one page view of the problem, user, promise, first
   release, proof, and guardrails.
6. Open **Track** to update task status, dates, labels, blockers, and private
   notes. Changes save on this device.
7. Open **Build** for the builder pack summary, or ask Cairn to sharpen one part
   of the plan.
8. Copy it out as Markdown, share a public read only link, or create a protected
   team workspace for Track.

### Planner follow ups

The Build tab has four quick actions: cut MVP scope, break work into smaller
tasks, find missing risks, and improve acceptance tests. You can also ask a
custom question. Cairn shows targeted changes in a preview before applying them.
One AI action costs one credit. Task status, dates, labels, notes, and blockers
stay on your device when a refinement keeps that task. Cairn sends only task text
to Gemini during refinement.

### Track the work

The **Track** tab is a local owner workspace. Board view groups work into vertical
milestone lanes. Timeline view shows milestone ranges and task due dates. Use the
filters to see all, to do, in progress, done, or blocked work. A task becomes
blocked when one of its selected dependencies is not done. A milestone is blocked
only when you mark it blocked.

The first click on a task opens its editor. Status can also change directly from
the lane. Dates are never invented by AI. Notes, priorities, and dependency
details remain private to this device.

### Team workspaces

The owner can create one protected team workspace for a plan. The owner adds
Nimiq wallet addresses and chooses a **Viewer** or **Editor** role for each one.
Members must open the protected link with the wallet that was added. The link is
only a locator. The Worker checks the signed wallet session on every request.

Team members see and, when allowed, edit Track only. The shared snapshot contains
milestones, task text, status, labels, dates, and the owner's milestone blocker
flag. It does not contain the PRD, user flow, Build summary, private notes,
priorities, or dependency details. Owner changes to the team board sync through a
revision check, so a stale editor cannot overwrite a newer update. Public Share
links remain separate and read only.

### Pay it forward

Sharing a plan mints a link that carries a **free generation for whoever opens
it**. They read your plan, tap once, and get their own — paid for by you, without
costing you a credit.

This is the part we like most. NIM moves because someone chose to pass something
on, not because a paywall demanded it.

## Public pages

The deployed Worker serves a small information layer beside the mini app:

1. `/case-studies` contains illustrative examples. They are not customer
   claims.
2. `/faq` answers product, timing, payment, sharing, and privacy questions.
3. `/privacy` explains data handling in plain language.
4. `/thank-you` is a simple completion page for links and demos.
5. Unknown routes show a branded 404 page.

The app has a clear response promise: most plans are ready in under 30 seconds.
The public pages use canonical URLs, Open Graph metadata, a social card,
`robots.txt`, `sitemap.xml`, and `llms.txt`.

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
- Credits are held against your wallet address. There is no email account or
  password. A short lived signed wallet session is required for AI, payments,
  and protected team access.

## What leaves your phone

Stated plainly, because it matters:

| Data | Where it goes |
| --- | --- |
| The idea you type | Google's Gemini API, via Cairn's server, to write the plan |
| The finished plan and private Track data | Your device's local storage. **Nothing else**, unless you use a paid planner follow up, public Share, or a protected team workspace |
| A plan you refine | Cairn's server and Google's Gemini API for that one follow up. The PRD, flow, and text only builder pack are sent so the change can be targeted. Private tracker metadata is not sent |
| A plan you tap **Share** on | Cairn's server, so the link can be opened. Progress, milestone dates, task due dates, and labels are shared. Notes, priorities, and dependencies are not shared |
| A protected team workspace | Cairn's server, so named wallet members can use Track. Milestones, task text, status, labels, dates, and milestone blocker flags are shared. The PRD, flow, Build summary, notes, priorities, and dependencies are not shared |
| Your wallet address | Cairn's server, as the key your credit balance is held against and the identity bound to your wallet session |
| A pseudonymous device identifier | Cairn's server, so free plans can't be farmed with fresh wallets. It identifies the device, not you, and declining it does not block anything |
| A request network address | A short lived abuse counter in Cairn's server. It is not used for analytics |

There is no analytics, no tracking, and no third-party script. The app loads no
external fonts. The browser talks only to Cairn's API. Cairn's Worker sends
generation requests to Gemini on the server side.

Plans are stored per device by design. Clearing the app's storage deletes them,
and there is no private copy on a server to restore from. A protected team
snapshot is a separate server record for the Track fields only. Copy anything
you need to keep.

## Running it locally

```bash
npm install
npm run dev          # http://localhost:5173
```

To run the full local Worker, copy `.dev.vars.example` to `.dev.vars` and add a local Gemini
key. Then run `npm run build` and `npm run worker:dev`. The Worker uses its local KV store. The
`DEV_TRUST_PAYMENTS=1` setting is available only for local testing and is refused on public
requests. Never commit `.dev.vars`.

In a production build, Chrome uses Nimiq Hub for real wallet authentication and
checkout. Only a local Vite preview with no `VITE_API_BASE` uses a synthetic wallet
and an obviously-labelled placeholder plan. This keeps local UI work walkable
without weakening the production wallet path.

When you open the deployed app in Chrome, tap **Generate plan** and complete the
Nimiq Hub popup. Allow popups for the Cairn site. Hub returns the selected wallet
address and signature to Cairn, which the Worker verifies before any AI action.

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
    plan.ts        The data model, migration, and on-device library
    tracker.ts     Progress, dates, blocker, and dependency calculations
    api.ts         Typed client for the server
    markdown.ts    Plan → Markdown / plain text
    clipboard.ts   Copy, with a non-secure-context fallback
    stub.ts        Offline placeholder generator, dev only
  components/
    NewPlan.vue      Screen one: the description
    Workspace.vue    One plan: Brief, Visual PRD, Flow, Build, Track, and Team tabs
    PrdView.vue      The PRD, readable and editable
    VisualPrd.vue    A visual, editable PRD canvas
    FlowDiagram.vue  The flow diagram
    BuildView.vue    Read only builder pack summary
    MilestoneTracker.vue  Owner board and timeline tracker
    TrackerEditorSheet.vue  Task and milestone editor
    TeamPanel.vue    Owner member and permission controls
    RefineSheet.vue  Preview and apply targeted planner follow ups
    Library.vue      Everything you have made
    PaySheet.vue     Top up, in NIM
  tests/
    client/          Migration, tracker calculations, and targeted merge tests
    worker/          Shape, credit, payment, share, and team permission tests
```

## Stack

Vue 3 + TypeScript + Vite on the front, a Cloudflare Worker with KV behind it.
No component library, no CSS framework, no webfont, no analytics. Type checking
is strict, including `erasableSyntaxOnly` and `verbatimModuleSyntax`.

Google Analytics is intentionally not included. Cairn is a privacy first mini
app, and adding third party tracking would contradict the disclosure shown
before generation. Local business schema, maps, and directions are also not
included because Cairn has no physical business location.

No API key, secret, or credential is committed to this repository. The Gemini
key lives only in an encrypted Cloudflare secret binding.

## Licence

MIT — see [LICENSE](LICENSE).

Built for the [Nimiq Mini Apps Competition](https://miniappscompetition.com).
