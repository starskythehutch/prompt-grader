// The one request to Jev and how its answer becomes a grade. Pure functions, so
// the hooks module, the tests and the calibration script share them.

import { checksFor, GRADE_INSTRUCTIONS, GRADES, type Asked, type Check, type Grade } from './rubric'

export const API_URL = 'https://openrouter.ai/api/alpha/decisions'
export const DEFAULT_MODEL = '~typesafe/jev-latest'
export const FAIL_BELOW = 0.5
export const CAP = 8 * 1024

export type Used = { kind: 'skill' | 'tool' | 'connector' | 'memory' | 'agent'; name: string; description?: string }

export type Opening = {
  prompt: string
  model?: string
  effort?: string
  used: Used[]
  plan: string
}

export type Result = {
  grade: Grade
  failed: Check[]
  issues: string[]
  fills: string[]
  rewrite: string
  lookedUp: boolean
  skillMatched: boolean
  jevModel?: string
  cost?: number
}

/** Cut `text` to `max` UTF-16 units, keeping the start. */
export function cap(text: string, max = CAP): string {
  return text.length <= max ? text : text.slice(0, max - 1) + '…'
}

/** The `used` list cut to fit `max` characters of JSON, dropping from the end. */
export function capUsed(used: Used[], max = CAP): Used[] {
  const out: Used[] = []
  let size = 2
  for (const u of used) {
    const one = { ...u, description: u.description ? cap(u.description, 300) : undefined }
    const add = JSON.stringify(one).length + 1
    if (size + add > max) break
    out.push(one)
    size += add
  }
  return out
}

export function buildRequest(o: Opening, model = DEFAULT_MODEL): { body: string; asked: Asked[] } {
  const used = capUsed(o.used)
  const plan = cap(o.plan.trim())
  const asked = checksFor(o.model, o.effort, used.length > 0, plan.length > 0, used.some(u => u.kind === 'skill'))
  const questions: Record<string, unknown> = {
    grade: { type: 'choice', instructions: GRADE_INSTRUCTIONS, criteria: GRADES },
  }
  for (const { check } of asked) {
    questions[check.id] = {
      type: 'noul',
      instructions: check.question,
      criteria: { true: check.true, false: check.false },
    }
  }
  const state: Record<string, unknown> = { opening_prompt: o.prompt }
  if (o.model) state.claude_model = o.model
  if (o.effort) state.effort = o.effort
  if (used.length) state.used = used
  if (plan) state.claude_plan = plan
  return { body: JSON.stringify({ model, state, questions }), asked }
}

type Answer = { type?: string; choice?: string; noul?: number | null }

export function parseResponse(text: string, asked: Asked[], prompt: string): Result {
  const data = JSON.parse(text) as {
    answers?: Record<string, Answer>
    model?: string
    usage?: { cost?: number }
    error?: { message?: string }
  }
  if (!data.answers) throw new Error(data.error?.message ?? 'Jev sent no answers')
  const grade = data.answers.grade?.choice
  if (!grade || !(grade in GRADES)) throw new Error(`unexpected grade: ${String(grade)}`)
  const scored: { ok: number; check: Check }[] = []
  let lookedUp = false
  let skillMatched = false
  for (const { check, informational } of asked) {
    const a = data.answers[check.id]
    if (a?.type !== 'noul' || typeof a.noul !== 'number') continue
    if (informational) {
      if (check.id === 'lookup') lookedUp = a.noul >= FAIL_BELOW
      if (check.id === 'skill_match') skillMatched = a.noul >= FAIL_BELOW
      continue
    }
    const ok = check.yesIsProblem ? 1 - a.noul : a.noul
    if (ok < FAIL_BELOW) scored.push({ ok, check })
  }
  scored.sort((x, y) => x.ok - y.ok)
  const failed = scored.map(s => s.check)
  const fills = failed.slice(0, 4).flatMap(c => (c.fill ? [c.fill] : []))
  const isGood = grade === 'good'
  return {
    grade: grade as Grade,
    failed,
    issues: failed.slice(0, 3).map(c => c.issue),
    fills: isGood ? [] : fills,
    rewrite: isGood || fills.length === 0 ? '' : `${prompt}\n\n${fills.join('\n')}`,
    lookedUp,
    skillMatched,
    jevModel: data.model,
    cost: data.usage?.cost,
  }
}

/** The desktop app puts <system-reminder> blocks in front of what the user typed. */
export function stripReminders(text: string): string {
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()
}

/** Prompts that are not graded and don't use up the first-prompt slot. */
export function isSkippedPrompt(text: string): boolean {
  return text === '' || text.startsWith('/') || text.startsWith('<task-notification>')
}

export const RAW_MARKER = '//raw'
