# Release checklist

## Automated gate

- [ ] `npm ci`
- [ ] `npm run check`
- [ ] `git diff --check`
- [ ] CI passes on the exact release commit

## Phone and wallet gate

- [ ] Open the production URL in a portrait phone and Nimiq Pay
- [ ] Connect a wallet on the landing screen without generating a plan
- [ ] Open a team invite with the added wallet and confirm no plan is required
- [ ] Generate a plan and confirm all four workspaces render
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

Do not mark a manual item complete without evidence. Never put seed phrases,
private keys, API keys, or confidential plan text in a release issue.
