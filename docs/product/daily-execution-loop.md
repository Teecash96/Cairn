# Cairn daily execution loop

## Product promise

Cairn turns a rough product idea into work a builder can finish. It does not stop
after it writes a plan. It helps the builder choose today's work, record what
happened, test assumptions, adjust the route, coordinate with wallet-identified
teammates, and prepare a release.

There is no Cairn signup. A Nimiq wallet is the user's identity, team access key,
and direct reward address.

## The loop

**Idea → Plan → Focus → Execute → Check in → Validate → Replan → Approve → Reward → Release**

| Step | User action | Cairn response |
| --- | --- | --- |
| Idea | Describe the product in plain language | Create a structured builder pack |
| Plan | Review and edit the PRD, map, flow, MVP, milestones, risks, tests, and tasks | Keep every planning view connected to one local route |
| Focus | Open Today | Show progress, blockers, reviews, experiments, and one available task |
| Execute | Update Track | Save status, dates, labels, dependencies, priorities, and notes |
| Check in | Record completed work, a blocker, a change, and the next step | Add the entry to the private journal and update Today |
| Validate | Define a hypothesis, smallest test, target, result, and decision | Keep product evidence beside the plan |
| Replan | Choose Replan from progress | Propose a small adjustment from current progress and evidence |
| Approve | Review a teammate's completion proof | Approve the task or return it with a reason |
| Reward | Send NIM for approved work | Lock the recipient to the assignee and verify the public transaction |
| Release | Open Release mode | Check readiness and prepare a reusable launch pack |

## Today workspace

Today is the return point for daily work. It shows:

- plan progress
- active task and milestone blockers
- teammate work waiting for owner review
- active validation experiments
- one recommended task that is available now

The recommendation respects completed work and task dependencies. It is a focus
aid, not an automatic status change.

## Daily check-ins and build journal

A check-in records four short facts:

1. what was completed
2. what is blocked
3. what changed
4. what should happen next

Cairn adds check-ins, task transitions, experiment decisions, and releases to a
chronological build journal. The journal is private to the local plan. It gives
the builder a compact record of why the route changed without requiring a
separate project diary.

## Validation experiments

Each experiment connects:

- a hypothesis
- the smallest useful test
- a success target
- the observed result
- a continue, change, or stop decision

This prevents the plan from becoming a static list of assumptions. Evidence can
change the next task and support a targeted replan.

## Replan from progress

Replanning uses the current execution state instead of asking the builder to
repeat the full story. Cairn sends Gemini:

- a compact check-in summary
- task status and due dates
- milestone blocker state

Cairn does not send private notes, priorities, dependency details, wallet
assignments, reward data, the full journal, or release drafts. The result is a
proposed adjustment that the user reviews before applying.

## Team accountability

An owner can share only Track with named Nimiq wallets. A teammate does not need
to create a plan first. After the wallet connects and signs a one-time challenge,
Cairn discovers the protected team routes available to that wallet.

The team workflow is:

1. The owner adds a wallet as a Viewer or Editor.
2. The owner assigns an open task to an Editor.
3. The teammate filters My Tasks and submits completion proof.
4. The owner approves the work or returns it with a reason.
5. Cairn records the authenticated wallet and server time for each protected action.
6. The owner can send NIM only after approval. The recipient is fixed to the assigned wallet.

For the complete team contract, see
[wallet-native teammate accountability](wallet-native-accountability.md).

## Release mode

Release mode turns execution state into a final readiness review. It checks the
work and prepares:

- release notes
- concise product copy
- a social post
- a demo outline
- known issues
- launch metrics

The generated launch pack remains editable and local until the builder copies or
shares it.

## Privacy boundary

| Data | Default location | Shared only when |
| --- | --- | --- |
| PRD, flow, Build summary, journal, experiments, release drafts | The user's device | Required by an explicit AI action or copied by the user |
| Task status, labels, and dates | The user's device | The owner creates a public share or protected team workspace |
| Private notes, priorities, and dependencies | The user's device | Never included in public shares or team snapshots |
| Team membership, assignments, reviews, and reward proofs | Cairn's server | The owner creates and uses a protected team workspace |
| Wallet address | Cairn's server during a signed session | The user connects and signs, or joins a protected team |

JSON backup includes the private execution data so a builder can move or recover
a route. Restoring a backup creates a new local route and does not inherit old
share or team control.

## Acceptance criteria

The execution loop is complete when:

- Today always identifies the most useful available task or explains why none is available.
- A check-in changes the visible progress context without changing task status by itself.
- An experiment keeps its hypothesis, evidence, and decision together.
- Replanning preserves completed work and requires review before changes are applied.
- Private execution records stay out of public shares and protected Track snapshots.
- A teammate can find an invited route with only the invited wallet and a signature.
- Only an approved, assigned teammate can be the recipient of a recorded reward.
- Release mode produces an editable launch pack from the current route.
