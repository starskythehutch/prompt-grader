// What Jev is asked: the overall grade, the checks from rubric-checks.ts, and the
// checks that read what the first turn looked up and Claude's plan.

import { GENERAL, MODEL_SPECIFIC, type Check } from './rubric-checks'

export type { Check }

export const GRADE_INSTRUCTIONS =
  "Grade how a Claude Code session opened. Claude Code is a coding agent working in " +
  "the user's repository; it reads code, runs commands, searches and loads skills, so " +
  "it doesn't need facts it can find itself. You get the user's opening prompt, the " +
  "names and descriptions of what Claude's first turn used (skills, tools, " +
  "connectors, memory) and Claude's stated plan. A short prompt can be enough when it " +
  "points at something the first turn looked up (a work item, ticket or document) or " +
  "when a matching skill supplied the structure. A good opening says, directly or " +
  "through what was looked up, what to do and on what, why when that changes the " +
  "approach, what Claude can't find itself, and what done looks like. Plain questions " +
  "are fine. Be lenient: most openings from an experienced user are good."

export const GRADES = {
  good: 'Claude had what it needed to do the right thing without guessing.',
  could_be_better:
    'Claude will probably get there, but a missing reason, done condition, scope or ' +
    'choice could cost a correction turn.',
  poor:
    'Claude had to guess the goal, the target or the scope, even with what it looked ' +
    'up, and is likely to go the wrong way.',
} as const

export type Grade = keyof typeof GRADES

// The general checks are worded for the prompt alone. With context they are asked
// of the prompt together with what the first turn looked up and Claude's plan.
export const CONTEXT_PREFIX =
  'Judge the opening prompt together with what the first turn looked up and ' +
  "Claude's plan. "

// Informational checks: not failures, they explain the grade in the panel.
export const LOOKUP: Check = {
  id: 'lookup',
  source: 'CC: let Claude read the context itself; the opening prompt can point at it',
  question:
    "Did the first turn look up something the prompt points at, such as a work item, " +
    'ticket, issue, pull request, document or URL?',
  true: 'Yes: a tool or connector fetched the thing the prompt refers to.',
  false: 'No: nothing the prompt points at was looked up, or it points at nothing.',
  issue: '',
  fill: null,
}

export const SKILL_MATCH: Check = {
  id: 'skill_match',
  source: 'CC: skills carry instructions for recurring tasks',
  question: 'Did a skill load whose description fits the task the prompt asks for?',
  true: 'Yes: a skill that fits the task was loaded.',
  false: 'No skill was loaded, or the one loaded does not fit the task.',
  issue: '',
  fill: null,
}

export const PLAN_ASSUMPTION: Check = {
  id: 'plan_assumption',
  yesIsProblem: true,
  source: "CC: state a preference between two reasonable approaches; Claude can't read it from the code",
  question:
    "Does Claude's plan settle a choice that changes the result in a way the user would " +
    'likely object to, and that the prompt and what was looked up left open, such as ' +
    'which of two different approaches, how much to change, or what to delete? Ordinary ' +
    'implementation details and reading files first are not such choices.',
  true: 'Yes: the plan makes a consequential choice the user never made and might not want.',
  false: 'No: the plan follows what the user asked, its choices are routine, or there is no plan.',
  issue: 'Claude picked an approach the prompt left open.',
  fill: '[which approach do you want, and why?]',
}

export function modelKey(model: string | undefined): string | undefined {
  const m = (model ?? '').toLowerCase().replace(/\./g, '-')
  const current: Record<string, string> = {
    fable: 'fable-5-2',
    opus: 'opus-5-5',
    sonnet: 'sonnet-5-5',
    haiku: 'haiku-5-5',
  }
  for (const family of Object.keys(current)) {
    if (!m.includes(family)) continue
    const found = new RegExp(family + '-(\\d+(?:-\\d)?)(?!\\d)').exec(m)
    return found ? `${family}-${found[1]}` : current[family]
  }
  return undefined
}

export type Asked = { check: Check; informational: boolean }

export function checksFor(
  model: string | undefined,
  effort: string | undefined,
  hasContext: boolean,
  hasPlan: boolean,
  hasSkill = false,
): Asked[] {
  const key = modelKey(model)
  const out: Asked[] = GENERAL.map(check => ({
    check: hasContext ? { ...check, question: CONTEXT_PREFIX + check.question } : check,
    informational: false,
  }))
  for (const check of MODEL_SPECIFIC) {
    if (key === undefined || !check.models?.includes(key)) continue
    if (check.efforts && !check.efforts.includes(effort)) continue
    out.push({ check, informational: false })
  }
  if (hasContext) {
    out.push({ check: LOOKUP, informational: true })
  }
  if (hasSkill) out.push({ check: SKILL_MATCH, informational: true })
  if (hasPlan) out.push({ check: PLAN_ASSUMPTION, informational: false })
  return out
}
