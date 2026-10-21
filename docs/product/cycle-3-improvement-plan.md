# Cairn: Improvement Plan for Nimiq Mini Apps Competition, Cycle III

Prepared 21 October 2026. Cycle III runs 14 October to **11 November 2026, 11:59 pm UTC**. That leaves about three weeks.

## 1. The rules changed since the screenshots

The screenshots show the **Cycle II** rubric: four categories of 25 points each, plus a 5-point NIM bonus. The current scoring page at miniappscompetition.com/scoring shows a different rubric for **Cycle III**:

| Area | Points | Where Cairn stands |
| --- | --- | --- |
| Functionality, reliability and usefulness | **45** | Strong engineering: tests, continuous integration, retry on incomplete plans. The risk is that the scope is too broad to feel finished and reliable. |
| Nimiq Pay and Nimiq integration | **25** | Weakest area. NIM is used only for login and optional rewards. No USDT. No reward has been confirmed on-chain yet. |
| Real usage | **15** | Weak. The live dashboard shows 11 verified wallets, 3 repeat wallets, 0 active in the last 7 days, 0 shares, 0 team actions and 0 rewards. It was last updated 7 October 2026. |
| Design and UX | **10** | Good foundation: mobile-first, accessibility-tested, sample route. The main risk is how much there is to learn. |
| Builder promotion checklist | **5** | The README and docs are thorough. No demo video was found. |

Other Cycle III rules that matter for Cairn:

- **Cycle III is themed: Pay, Save, Earn, On/Off-Ramp.** Off-theme apps can still enter, but they are eligible **only for the $1,000 Community Council Prize**. Each theme pays **$4,000**. Cairn entered Cycle II as "Productivity", which would be off-theme now.
- **Non-winning apps may re-enter** only "with significant improvements or new functionality". Cairn did not win in Cycle II, so it qualifies, but the improvements have to be visible.
- **Integration requirement:** the app "must use Nimiq wallets, transactions, or payment infrastructure as a core part of the user experience". Simply displaying a Nimiq logo does not count.
- **Using NIM beyond simply accepting a payment is worth 5 points** (from the FAQ).
- **All submissions go public at the start of Week 3** for early-access testing. That is about 28 October and is the best moment to drive usage.
- The written description is limited to **250 words**. A demo video is optional but encouraged.
- Weekly Sip & Ship calls are on Wednesdays at 15:00 UTC: today, 28 October and 11 November.

## 2. Recommended strategy: enter in the **Pay** category

The Pay theme is "expanding the ways people spend NIM and USDT". Its example ideas include tipping, invoices and payments. Cairn already has the core of this: an owner pays a named teammate directly, after reviewing proof of completed work. Building that out into the headline feature is the most credible "significant improvement". It also turns the weakest area (Nimiq integration, 25 points) into the strongest.

**New positioning:** *"Pay your team for finished work. Plan the product, assign the tasks, approve the proof, and pay in NIM or USDT, all from Nimiq Pay."*

Planning stays in the app, but as the way work and payments get defined, not as the product itself. The alternative is to stay off-theme and compete only for the $1,000 Council prize. That needs less work but has a much lower ceiling.

## 3. Improvements, in priority order

### A. Nimiq integration (25 points), highest leverage

1. **USDT payouts alongside NIM.** Nimiq Pay exposes USDT on Polygon through `window.ethereum` (see nimiq.dev/mini-apps/features/evm-tokens). An owner pays the reward in NIM or USDT. The Worker verifies the transfer on-chain, the same way it verifies NIM today. Cairn's own docs currently say "USDT is not part of this release".
2. **Price tasks when they are planned.** Each task or milestone carries an amount. The plan then shows a **project budget**: total, committed, paid and remaining. Generation can suggest prices, which the owner edits.
3. **Payment requests (invoices).** A teammate whose work is approved gets a one-tap "request payment" link or QR code for the owner. This covers the Pay theme's "invoices" example.
4. **Batch payout.** "Pay all approved work" sends one payment per teammate in a single guided flow.
5. **On-chain payment receipts.** A shareable receipt page for each payment: task, proof, approver, transaction hash and a block-explorer link. Teammates get proof of paid work, and judges get visible on-chain activity.
6. **Tipping and appreciation.** A small NIM tip on any completed check-in or teammate update. Low effort, and it adds repeat NIM transactions.
7. **Upgrade `@nimiq/mini-app-sdk`** from `^0.1.0` to the current 0.2.x. Use `getHostNetwork()` to label mainnet and testnet clearly, so a judge never sends a real payment by accident.

### B. Functionality, reliability and usefulness (45 points)

The rubric says "Main promise works without errors" and "not a prototype with missing pieces". Breadth works against this.

1. **Narrow the core route.** The app currently has five workspace tabs (Today, Plan, Flow, Build, Track) plus Routes, Inbox, Reports, Release mode, experiments and a journal. Make one path flawless: **Idea → plan with priced tasks → invite teammate → teammate submits proof → owner approves → owner pays → receipt**. Move the rest behind "More" or into Plan.
2. **Test the payment path end to end on mainnet** with two real wallets in Nimiq Pay, on both iOS and Android. Record it, because that recording becomes the demo video. No reward has been confirmed yet, which means this path has never been shown working in public.
3. **Graceful failure on every payment step:** insufficient balance, user rejects the payment, the transaction is pending, chain verification times out, the wrong amount was sent. Each one needs a clear message and a retry option.
4. **Reliability of generation.** The Gemini step takes about 20 seconds. Show progress through the stages, allow cancelling, and keep the user's idea text if generation fails.
5. **Repeat value.** Use the existing inbox to give a reason to return, such as "2 tasks awaiting your approval" or "you were paid 15 NIM". Add a pending-actions indicator to the app's home.

### C. Real usage (15 points)

1. **Fix the usage dashboard freshness.** It reports `updatedAt` 7 October and 0 active wallets. Confirm it recomputes, then show the last-updated time.
2. **Seed real teams.** Run Cairn with other Cycle III builders: post small NIM or USDT bounties for real tasks such as testing an app, writing copy or designing an icon. Each one creates real wallets, real team actions and confirmed payouts.
3. **A public "open tasks" board (opt-in).** Owners can publish tasks with a bounty, so any Nimiq wallet can claim one, submit proof and get paid. This brings in unique users and NIM activity, and it is useful to the wider ecosystem.
4. **Time the push for Week 3 (from about 28 October),** when submissions go public.
5. **Use the existing source tracking** (`src/lib/acquisition.ts`) so the dashboard shows where users came from.

### D. Design and UX (10 points)

1. The first screen should show the **payment** promise within 5 seconds, with one primary call to action.
2. **Under 60 seconds to first value:** the sample route should open directly onto a priced task that is awaiting approval, ending in a clear "Pay" button.
3. Use consistent amount formatting (NIM and USDT, with a currency symbol). Add a payment confirmation sheet that shows recipient, amount and network.
4. Re-check the mobile layout in the Nimiq Pay WebView on a small Android phone, not only in Chromium.

### E. Builder promotion checklist (5 points)

1. A **60 to 90 second demo video** covering idea, priced plan, teammate proof, approval, payment and on-chain receipt. Post it on YouTube or X and link it from the README.
2. Rewrite the submission description to **under 250 words**, covering what it does, who it is for and how it uses Nimiq Pay, in that order.
3. Attend the Sip & Ship calls (28 October, 11 November) and share weekly progress in the Skool community and on X, tagging @miniappscomp.
4. Update the README headline, screenshots and social card to the payments positioning. Add a CHANGELOG entry titled "Cycle III improvements" so the significant changes are easy to verify.

## 4. Three-week schedule

| Week | Dates | Focus |
| --- | --- | --- |
| 1 | 21–27 Oct | Priced tasks and budget, USDT payout, SDK upgrade, payment error handling, mainnet test with two wallets |
| 2 | 28 Oct–3 Nov | Payment requests, batch payout, receipts, simplified navigation and onboarding. Seed real teams and bounties as submissions go public |
| 3 | 4–11 Nov | Bug fixes, demo video, README and description rewrite, usage push, submit before 11 Nov 23:59 UTC |

## 5. Points to confirm

- Whether Cairn's Cycle II entry counts as "non-winning". It is listed with no prize badge, so it appears to.
- Whether judges accept the Pay category for "paying people for verified work". The theme examples include invoices and tipping, which suggests yes. Asking in a Sip & Ship call or the Skool community would settle it.
- The exact USDT transfer method and gas handling in Nimiq Pay's Ethereum provider. See nimiq.dev/mini-apps/api-reference/ethereum-provider.
