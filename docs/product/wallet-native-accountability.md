# Wallet-native teammate accountability

## Product promise

Cairn teams need no account registration. There are no email addresses,
usernames, passwords, profiles, or signup forms. A teammate needs only a Nimiq
wallet address. That address is the person's identity, team permission, task
assignee, completion signer, and reward destination.

The protected team link is only a locator. It grants no access by itself. On
every protected request, Cairn verifies a short-lived signature from the wallet
address that the owner added to the team.

## What works now

- The owner adds a Nimiq wallet address as a Viewer or Editor.
- The teammate opens the protected link and signs in with that wallet.
- Editors update the shared Track board; Viewers can follow progress.
- The owner can send NIM directly to a named member for a completed task.
- Cairn verifies the public transaction and attaches its proof to the task.
- Cairn never holds teammate reward funds.

Today, the owner selects the reward recipient manually. Cairn does not yet
prove which editor performed or completed a specific task.

## Next accountability milestone

### 1. Wallet assignment

The owner assigns a task to one current team wallet. Track shows the shortened
wallet address on the board, timeline, and task editor. Removing a member must
first unassign or transfer that member's open tasks.

### 2. Signed activity history

Each protected tracker change records the authenticated wallet address, action,
task, and server timestamp. The history uses simple statements such as:

- `NQ… started “Publish the landing page”.`
- `NQ… submitted “Publish the landing page” for approval.`
- `Owner approved the completion.`
- `Owner sent 2 NIM to NQ… for the completed task.`

The log must not expose private wallet data beyond addresses already visible to
team members. It must never include a private key, seed phrase, email address,
or device identifier.

### 3. Completion approval

An assignee submits a task as complete. The task enters **Pending approval**.
The owner can approve it or return it with a short reason. Only approval changes
the task to **Done** and enables its reward action.

### 4. Reward integrity

The reward recipient comes from the approved task assignment, not from a manual
recipient picker. The server verifies that:

- the task is assigned to a current member;
- that wallet submitted the completion;
- the owner approved it;
- the task has no prior reward; and
- the NIM transaction sender, recipient, amount, and confirmation are valid.

The completed task then shows the assignee, approval, amount, and transaction
proof together.

## Privacy boundary

The team workspace continues to contain Track fields only. The private PRD,
flow, Build summary, notes, priorities, and dependency details stay on the
owner's device. Activity history is stored only for the protected team and is
available only to authenticated members.

## Acceptance criteria

- A teammate joins with a Nimiq wallet address only; no signup form exists.
- The owner can assign each task to one current member.
- An authenticated member cannot submit another wallet's assigned task.
- Completion requires owner approval before a reward can be sent.
- Every team mutation shows which authenticated wallet made it.
- A reward can go only to the approved assignee and can be recorded once.
- Removing a member cannot leave an unowned open task or erase reward proof.
- Viewer, Editor, and Owner permissions remain enforced on the server.
- No private plan fields cross the team boundary.
