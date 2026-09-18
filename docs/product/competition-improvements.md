# Competition improvements

This document records the product and engineering work completed for Cairn's
competition release. It explains what changed, why it matters, and how each
change is verified.

## Product direction

Cairn is no longer presented as only an AI plan generator. Its product route is:

**Idea → Plan → Focus → Execute → Check in → Validate → Replan → Approve → Reward → Release**

The distinction from a general AI chat is the persistent execution system after
generation: editable product structure, daily focus, evidence, wallet-native
teamwork, task approval, direct teammate rewards, and release preparation.

## Improvements shipped

| Area | Improvement | Why it matters |
| --- | --- | --- |
| First run | The landing screen explains **Plan once**, **Work daily**, and **Finish together** | A new user can understand the complete product before connecting a wallet |
| Product proof | The sample route opens on **Today** and exposes Today, Plan, Flow, Build, and Track | Judges can inspect the execution loop without a wallet or generated plan |
| Daily execution | Today recommends one available task and shows progress, blockers, reviews, and active experiments | Cairn helps a builder act instead of stopping at a generated document |
| Learning loop | Check-ins, validation experiments, the build journal, and progress-aware replanning are connected | Decisions can respond to evidence without replacing completed work |
| Teamwork | Nimiq wallet identity supports team discovery, roles, assignments, proof, owner review, and activity history | Named teammates can work in a protected Track workspace without creating Cairn accounts |
| Rewards | An owner can reward approved work directly to the assigned teammate's Nimiq address | Payment is tied to verified contribution and Cairn never holds the funds |
| Release | Release mode checks readiness and creates product copy, social copy, a demo outline, known issues, metrics, and release notes | The workspace continues through launch instead of ending at planning |
| Recovery | Meaningful progress triggers a JSON backup reminder | Device-local work has a clear recovery path before a browser or device change |
| Accessibility | Secondary text meets WCAG AA contrast, browser zoom remains available, and the phone layout has no horizontal overflow | The core route remains readable and usable in a portrait mobile WebView |
| Trust | Product metadata correctly describes Cairn as free; the public privacy copy explains each data boundary | Users are not shown an obsolete 1 NIM product price and can understand what leaves the device |
| Operations | Sampled logs contain only API category, method, status, and duration | Service failures can be diagnosed without recording prompts, URLs, identifiers, wallets, bodies, or network addresses |
| Presentation | The social preview is a valid 1200 × 630 PNG and public copy uses the idea-to-release message | Shared links show the current product instead of an outdated planning-only description |

## Automated release evidence

Every pull request to `main` runs the same validation gate before deployment:

- strict TypeScript checks for the client and Worker
- 78 client and server tests
- a tracked-file and Git-history secret scan
- a production dependency audit
- a production Vite build
- four mobile Chromium end-to-end checks covering the landing message, sample
  route, horizontal overflow, JSON-LD metadata, and automated WCAG A/AA rules

The deployment job runs only after validation succeeds. It rebuilds the app and
deploys the Worker and static assets through Wrangler.

## Privacy boundaries

- Personal plans, private task metadata, check-ins, experiments, journal entries,
  and release drafts stay on the device unless the user chooses an action that
  needs server processing.
- A public share is read-only and excludes private notes, priorities, and
  dependencies.
- A protected team workspace exposes Track data only to named, signed Nimiq
  wallets. It excludes the PRD, flow, Build summary, private notes, priorities,
  and dependency details.
- Planner generation and refinements send only the data required for that
  selected action.
- Cairn has no email, password, profile, or Cairn username. The wallet address
  is the identity, permission key, and direct reward address.

## Manual release evidence still required

Automation cannot replace a real wallet and network test. Before the final
competition demonstration, use two Nimiq wallets to confirm this route:

1. The owner connects a wallet and creates a protected team workspace.
2. The invited wallet discovers and opens Teammate work without creating a plan.
3. The owner assigns a task and the teammate submits completion proof.
4. The owner approves the proof and sends a small direct NIM reward.
5. Cairn keeps checking the public transaction automatically, survives a close
   and reopen, and records the reward once without requesting another payment.

Record this test in the demo video because it is the clearest proof that Cairn
does more than a general AI chat.
