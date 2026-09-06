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
import type {
  BuildPlanDraft,
  FlowStep,
  Plan,
  PlanChanges,
  PlanInput,
  Prd,
  RealityCheckItem,
} from './plan'
import type { RefineAction } from './api'

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
      `before the AI backend is connected. Real output is written by Gemini from your ` +
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

export function stubBuild(input: PlanInput): BuildPlanDraft {
  const thing = subject(input)
  return {
    mvpScope: [
      `A focused first version of ${thing}`,
      'One clear path from the first input to the promised result',
      'A simple way to learn whether the result helps',
    ],
    milestones: [
      {
        title: 'Prove the core path',
        outcome: 'A real person can reach the main result without help.',
        tasks: ['Write the smallest happy path', 'Test it with one real person', 'Fix the first confusing step'],
      },
      {
        title: 'Make it dependable',
        outcome: 'The core path handles ordinary mistakes and empty states.',
        tasks: ['Add the most important error state', 'Write one acceptance test for the core path', 'Remove one nonessential feature'],
      },
      {
        title: 'Learn before expanding',
        outcome: 'The next decision is based on observed use, not guesses.',
        tasks: ['Choose one signal to watch manually', 'Run a small release', 'Record what to change next'],
      },
    ],
    risks: [
      'The first version may try to solve too much at once.',
      'The target user may describe the problem differently than expected.',
    ],
    acceptanceTests: [
      'A first user can complete the core path without instructions.',
      'An invalid or empty input produces a useful next step.',
      'The creator can explain what to build next in one sentence.',
    ],
    nextAction: 'Show the idea to one target user and ask them to describe the hardest part.',
  }
}

export function stubRealityCheck(_input: PlanInput): RealityCheckItem[] {
  return [
    {
      priority: 'high',
      concern: 'The problem may be too broad for a first release.',
      why: 'A broad promise makes it hard to choose what to build and what to ignore.',
      fix: 'Choose one user and one outcome, then test that path before adding scope.',
    },
    {
      priority: 'medium',
      concern: 'The plan has no evidence that people will change their current behavior.',
      why: 'A clear document is not proof that the product is wanted.',
      fix: 'Ask three target users to show how they solve this today.',
    },
    {
      priority: 'low',
      concern: 'Success is not yet tied to an observable signal.',
      why: 'Without a signal, the next iteration becomes opinion.',
      fix: 'Pick one behavior that would prove the core path is useful.',
    },
  ]
}

export interface StubRefinement {
  answer?: string
  explanation: string
  changes: PlanChanges
}

/**
 * A deterministic local preview for the planner follow-up sheet.
 *
 * The real Worker owns the AI key. When `vite dev` runs without a Worker there
 * is no honest network result to show, so these small, clearly labelled changes
 * keep the follow-up interaction reviewable without pretending they came from
 * Gemini.
 */
export function stubRefinement(plan: Plan, action: RefineAction, question?: string): StubRefinement {
  if (action === 'cut_mvp_scope') {
    return {
      explanation: 'Local preview: keep the first three scope items and the shortest useful task set in each milestone.',
      changes: {
        build: {
          mvpScope: plan.build.mvpScope.slice(0, 3),
          milestones: plan.build.milestones.map((milestone) => ({
            title: milestone.title,
            outcome: milestone.outcome,
            tasks: milestone.tasks.slice(0, 2).map((task) => task.text),
          })),
        },
      },
    }
  }

  if (action === 'break_into_tasks') {
    return {
      explanation: 'Local preview: each task is rewritten as one visible action, ready for a real Worker refinement.',
      changes: {
        build: {
          milestones: plan.build.milestones.map((milestone) => ({
            title: milestone.title,
            outcome: milestone.outcome,
            tasks: milestone.tasks.map((task) => `Do: ${task.text}`),
          })),
        },
      },
    }
  }

  if (action === 'find_missing_risks') {
    return {
      explanation: 'Local preview: three checks that challenge the plan before more features are added.',
      changes: {
        build: {
          risks: [...plan.build.risks.slice(0, 4), 'The first user may not reach the promised outcome.'].slice(0, 5),
        },
        realityCheck: [
          {
            priority: 'high',
            concern: 'The first user may not finish the core path.',
            why: 'A plan can look clear while the real path still has friction.',
            fix: 'Watch one person complete the path without coaching.',
          },
          {
            priority: 'medium',
            concern: 'The problem may not be urgent enough.',
            why: 'People often tolerate a manual workaround when the cost is low.',
            fix: 'Ask three target users what they do today and what it costs them.',
          },
          {
            priority: 'low',
            concern: 'The success signal may be too vague.',
            why: 'Without an observable behavior, the next decision becomes opinion.',
            fix: 'Choose one behavior that proves the core outcome happened.',
          },
        ],
      },
    }
  }

  if (action === 'improve_acceptance_tests') {
    return {
      explanation: 'Local preview: acceptance tests rewritten as observable outcomes.',
      changes: {
        build: {
          acceptanceTests: [
            'A first user completes the core path without instructions.',
            'An invalid input shows a useful recovery step.',
            'The creator can name the next build decision after one test.',
          ],
        },
      },
    }
  }

  return {
    answer: `Local preview answer: test "${question?.trim() || 'the next decision'}" with one real person before adding more scope.`,
    explanation: 'This is a local preview. The deployed Worker will answer from the current plan only.',
    changes: {},
  }
}

/** Mirrors the shape of a real `/api/generate` success, minus credits. */
export function stubGenerate(input: PlanInput): {
  prd: Prd
  flow: FlowStep[]
  build: BuildPlanDraft
  realityCheck: RealityCheckItem[]
} {
  return {
    prd: stubPrd(input),
    flow: stubFlow(input),
    build: stubBuild(input),
    realityCheck: stubRealityCheck(input),
  }
}
