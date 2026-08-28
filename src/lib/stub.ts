/**
 * Offline generator, for development and desktop review only.
 *
 * The Worker holds the AI key, so `vite dev` on its own cannot generate
 * anything. Rather than leave the whole UI unreviewable until the backend
 * exists, this produces a structurally complete plan derived from the actual
 * form input — realistic field lengths, exactly one decision step, the full
 * five-to-eight step range — so layout, overflow and every screen state can be
 * judged before a single API call is wired up.
 *
 * It is deliberately obvious that this is not real output (see `summary`), and
 * it is only ever reached when the API is unreachable in a dev build.
 */
import type { FlowStep, PlanInput, Prd } from './plan'

function subject(input: PlanInput): string {
  const name = input.name.trim()
  if (name) return name

  const idea = input.idea.trim().replace(/\s+/g, ' ')
  // "An app that helps freelancers…" → "freelancers…"; good enough for a stub.
  const trimmed = idea.replace(/^(an?|the)\s+(app|tool|service|platform)\s+(that|which|to)\s+/i, '')
  const words = trimmed.split(' ').slice(0, 6).join(' ')
  return words || 'this product'
}

function audience(input: PlanInput): string {
  return input.targetUser?.trim() || 'people who currently solve this manually'
}

function pain(input: PlanInput): string {
  return input.problem?.trim() || 'the work is done by hand, so it is slow and easy to get wrong'
}

function objective(input: PlanInput): string {
  return input.goal?.trim() || 'get a usable result on the first attempt, without training'
}

export function stubPrd(input: PlanInput): Prd {
  const thing = subject(input)
  const who = audience(input)

  return {
    summary:
      `${thing} — a placeholder plan generated offline, so the layout can be reviewed ` +
      `before the AI backend is connected. Real output is written by Claude from your ` +
      `own description and reads nothing like this.`,
    problem: `Today, ${pain(input)}. That cost is absorbed quietly and repeatedly.`,
    targetUser: who.charAt(0).toUpperCase() + who.slice(1),
    userGoal: `As ${/^(a|an|the)\s/i.test(who) ? who : `a ${who.replace(/s$/, '')}`}, I want to ${objective(input)}.`,
    coreFeatures: [
      'Single-screen capture of the one input that matters',
      'Structured output the user can edit in place',
      'A saved library, browsable without an account',
      'One-tap copy of the finished result',
      'Shareable read-only link',
    ],
    userStories: [
      `As ${who}, I can describe the problem in my own words and get something structured back.`,
      'I can correct anything the generator got wrong without starting over.',
      'I can come back tomorrow and find what I made yesterday.',
      'I can hand the result to someone else without asking them to sign up.',
    ],
    successCriteria: [
      'A first-time user reaches a finished result in under two minutes',
      'Over half of results are edited rather than discarded',
      'A quarter of results get shared at least once',
      'Nothing is lost when the app is closed mid-edit',
    ],
    assumptions: [
      'Assumption: users would rather edit a draft than fill in a blank template.',
      'Assumption: the input is typed on a phone, so it will be short and informal.',
      'Assumption: no market research has been done — nothing here is validated.',
    ],
    outOfScope: [
      'Accounts, teams and permissions',
      'Real-time collaborative editing',
      'Integrations with external trackers',
    ],
  }
}

export function stubFlow(input: PlanInput): FlowStep[] {
  const thing = subject(input)

  return [
    {
      kind: 'entry',
      title: 'Opens the app',
      action: `Arrives at ${thing} with nothing saved yet.`,
      result: 'An empty state invites them to describe their idea.',
    },
    {
      kind: 'action',
      title: 'Describes the idea',
      action: 'Types a few sentences in plain language, skipping the optional fields.',
      result: 'The primary button becomes available.',
    },
    {
      kind: 'action',
      title: 'Requests a result',
      action: 'Taps the primary action and waits.',
      result: 'A short, on-brand progress state appears — never a bare spinner.',
    },
    {
      kind: 'decision',
      title: 'Is the result usable?',
      action: 'Reads what came back and judges it.',
      result: 'They either refine it or move straight on.',
      branches: [
        { label: 'Yes', result: 'They edit a couple of lines and save it to the library.' },
        { label: 'No', result: 'They adjust the description and retry — their input is preserved.' },
      ],
    },
    {
      kind: 'success',
      title: 'Keeps the result',
      action: 'Saves it and copies it out.',
      result: 'A brief confirmation appears; the plan is in the library.',
    },
    {
      kind: 'exit',
      title: 'Shares or returns',
      action: 'Sends the link on, or closes the app.',
      result: 'The plan is reachable again from the library on next open.',
    },
  ]
}

/** Mirrors the shape of a real `/api/generate` success, minus credits. */
export function stubGenerate(input: PlanInput): { prd: Prd; flow: FlowStep[] } {
  return { prd: stubPrd(input), flow: stubFlow(input) }
}
