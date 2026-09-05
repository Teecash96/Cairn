/**
 * Plan → text.
 *
 * The spec asks for three exports: copy the PRD, copy the numbered flow, and
 * one Markdown document containing the complete builder pack.
 *
 * On a phone these are the *only* export paths that reliably work — a page
 * cannot be trusted to initiate a file download inside the Nimiq Pay WebView —
 * so the clipboard is the primary channel rather than a convenience. See
 * `lib/clipboard.ts`.
 */
import { titleOf, type FlowStep, type FlowStepKind, type Plan } from './plan'

const KIND_LABEL: Record<FlowStepKind, string> = {
  entry: 'Entry point',
  action: 'Action',
  decision: 'Decision',
  success: 'Success',
  exit: 'Next step',
}

function clean(value: string | undefined): string {
  return (value ?? '').trim()
}

function present(items: string[]): string[] {
  return items.map(clean).filter(Boolean)
}

/**
 * Emit a section only when it has content. Every PRD field is user-editable, so
 * blanks are a normal state — and an export full of empty headings reads like a
 * broken template.
 */
function section(heading: string, body: string): string {
  const text = body.trim()
  return text ? `## ${heading}\n\n${text}` : ''
}

function bulleted(items: string[]): string {
  return present(items)
    .map((item) => `- ${item}`)
    .join('\n')
}

function join(blocks: string[]): string {
  return blocks.filter(Boolean).join('\n\n')
}

/** The numbered flow, as plain text. Shown under the diagram and copyable. */
export function flowToText(flow: FlowStep[]): string {
  return flow
    .map((step, index) => {
      const lines = [
        `${index + 1}. ${clean(step.title)} — ${KIND_LABEL[step.kind] ?? 'Step'}`,
        `   Action: ${clean(step.action)}`,
        `   Result: ${clean(step.result)}`,
      ]

      for (const branch of step.branches ?? []) {
        lines.push(`   If ${clean(branch.label)}: ${clean(branch.result)}`)
      }

      return lines.join('\n')
    })
    .join('\n\n')
}

/** The PRD as formatted Markdown, without the document title. */
export function prdToMarkdown(plan: Plan): string {
  const { prd } = plan

  return join([
    section('Product summary', clean(prd.summary)),
    section('Problem', clean(prd.problem)),
    section('Target user', clean(prd.targetUser)),
    section('User goal', clean(prd.userGoal)),
    section('Core features', bulleted(prd.coreFeatures)),
    section('User stories', bulleted(prd.userStories)),
    section('Success criteria', bulleted(prd.successCriteria)),
    section('Assumptions', bulleted(prd.assumptions)),
    section('Out of scope', bulleted(prd.outOfScope)),
  ])
}

/** What the "Copy PRD" button puts on the clipboard. */
export function prdToText(plan: Plan): string {
  return join([`# ${titleOf(plan)}`, prdToMarkdown(plan)])
}

export function buildToText(plan: Plan): string {
  const { build } = plan
  const milestones = build.milestones
    .map((milestone, index) => {
      const tasks = milestone.tasks
        .map((task) => `  ${task.done ? '[x]' : '[ ]'} ${task.text}`)
        .join('\n')
      return `${index + 1}. ${clean(milestone.title)}\n   Outcome: ${clean(milestone.outcome)}${tasks ? `\n${tasks}` : ''}`
    })
    .join('\n\n')

  return join([
    'MVP scope',
    bulleted(build.mvpScope),
    'Milestones',
    milestones,
    'Risks',
    bulleted(build.risks),
    'Acceptance tests',
    bulleted(build.acceptanceTests),
    'Next action',
    clean(build.nextAction),
    'Reality check',
    plan.realityCheck
      .map((item, index) => `${index + 1}. [${item.priority}] ${clean(item.concern)}\n   Why: ${clean(item.why)}\n   Smallest fix or test: ${clean(item.fix)}`)
      .join('\n\n'),
  ])
}

function buildToMarkdown(plan: Plan): string {
  const { build } = plan
  const milestones = build.milestones
    .map((milestone) => {
      const tasks = milestone.tasks
        .map((task) => `- [${task.done ? 'x' : ' '}] ${task.text}`)
        .join('\n')
      return join([
        `### ${clean(milestone.title)}`,
        clean(milestone.outcome) ? `**Outcome:** ${clean(milestone.outcome)}` : '',
        tasks,
      ])
    })
    .join('\n\n')

  const reality = plan.realityCheck
    .map((item) => join([
      `### ${item.priority.toUpperCase()}: ${clean(item.concern)}`,
      clean(item.why) ? `**Why:** ${clean(item.why)}` : '',
      clean(item.fix) ? `**Smallest fix or test:** ${clean(item.fix)}` : '',
    ]))
    .join('\n\n')

  return join([
    section('MVP scope', bulleted(build.mvpScope)),
    section('Build milestones', milestones),
    section('Risks', bulleted(build.risks)),
    section('Acceptance tests', bulleted(build.acceptanceTests)),
    section('Next action', clean(build.nextAction)),
    section('Reality check', reality),
  ])
}

/**
 * The complete document: title, PRD, builder pack, and numbered flow. This is what
 * `{project-name}-plan.md` contains.
 */
export function planToMarkdown(plan: Plan): string {
  return `${join([
    `# ${titleOf(plan)}`,
    prdToMarkdown(plan),
    buildToMarkdown(plan),
    section('User flow', flowToText(plan.flow)),
    '---',
    `_Generated with Cairn._`,
  ])}\n`
}
