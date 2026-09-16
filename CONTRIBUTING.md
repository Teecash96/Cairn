# Contributing to Cairn

Thank you for helping builders turn rough ideas into useful plans.

## Start locally

Use Node 24 and npm 11.

```bash
npm ci
npm run dev
```

Run the full release check before opening a pull request:

```bash
npm run check
git diff --check
```

## Pull requests

Keep each change focused. Explain the user problem, the visible result, and how
you tested it on a portrait phone. Add or update tests when behavior changes.
Update privacy, payment, and deployment documents when their contracts change.

Do not commit `.dev.vars`, wallet keys, seed phrases, API keys, production data,
or confidential plan text. Use synthetic plan examples and redacted transaction
details. Report security issues as described in [SECURITY.md](SECURITY.md).
