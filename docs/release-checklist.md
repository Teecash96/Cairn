# Release checklist

## Automated gate

- [ ] `npm ci`
- [ ] `npm run check`
- [ ] `npm run test:e2e`
- [ ] `git diff --check`
- [ ] CI passes on the exact release commit

## Phone and wallet gate

- [ ] Open the production URL in a portrait phone and Nimiq Pay
- [ ] Connect a wallet on the landing screen without generating a plan
- [ ] Open a team invite with the added wallet and confirm no plan is required
- [ ] Confirm Routes separates Personal work and Teammate work without overflow
- [ ] Leave and reopen a remembered teammate route with the same signed wallet
- [ ] Generate a plan and confirm Today, Plan, Flow, Build, and Track render
- [ ] Open the sample and confirm Today, Plan, Flow, Build, and Track fit without horizontal overflow
- [ ] Confirm generation and refinement work without payment
- [ ] Complete one task and test a small direct reward with two test wallets
- [ ] Confirm reward checking resumes without requesting a second payment
- [ ] Invite a second wallet and test Viewer and Editor access to Track
- [ ] Confirm the teammate cannot read the PRD, Flow, Build summary, or private notes

## Production gate

- [ ] `CREDIT_LEDGER_READY` is `1` only after the ledger reconciliation is complete
- [ ] Cloudflare has `GEMINI_API_KEY`; GitHub has Cloudflare deploy secrets
- [ ] The deployed commit matches the tagged commit
- [ ] `/`, `/privacy`, `/faq`, and a safe public share link load over HTTPS
- [ ] CSP, HSTS, frame denial, and no-sniff headers are present
- [ ] README, changelog, app version, and public privacy copy match behavior
- [ ] `social-card.png` is a valid 1200 × 630 PNG and the social metadata describes the current execution loop

Do not mark a manual item complete without evidence. Never put seed phrases,
private keys, API keys, or confidential plan text in a release issue.
