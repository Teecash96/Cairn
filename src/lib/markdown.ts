/**
 * Plan → text.
 *
 * The spec asks for three exports: copy the PRD, copy the numbered flow, and
 * one Markdown document containing the title, the PRD and the flow.
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

/**
 * The complete document: title, PRD, numbered flow. This is what
 * `{project-name}-plan.md` contains.
 */
export function planToMarkdown(plan: Plan): string {
  return `${join([
    `# ${titleOf(plan)}`,
    prdToMarkdown(plan),
    section('User flow', flowToText(plan.flow)),
    '---',
    `_Generated with Cairn._`,
  ])}\n`
}
