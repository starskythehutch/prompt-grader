import { describe, expect, test } from 'claude-code/testing'

import { firstTurn, frontmatterDescription, isMemoryPath, planOf, usedBy, type Message } from '../hooks/context'
import { buildRequest, capUsed, isSkippedPrompt, parseResponse, stripReminders } from '../hooks/jev'
import { checksFor, modelKey } from '../hooks/rubric'

// ---------- Pure parts ----------

describe('rubric', () => {
  test('model keys', async () => {
    expect(modelKey('claude-sonnet-5-5')).toBe('sonnet-5-5')
    expect(modelKey('claude-opus-5')).toBe('opus-5')
    expect(modelKey('claude-opus-5-20261001')).toBe('opus-5')
    expect(modelKey('claude-fable-5-2[1m]')).toBe('fable-5-2')
    expect(modelKey('opus')).toBe('opus-5-5')
    expect(modelKey(undefined)).toBe(undefined)
  })

  test('model-specific and effort-limited checks', async () => {
    const ids = (m?: string, e?: string, ctx = false, plan = false) => checksFor(m, e, ctx, plan).map(a => a.check.id)
    expect(ids('claude-fable-5-2')).toContain('fable_never')
    expect(ids('claude-opus-5-5')).not.toContain('fable_never')
    expect(ids('claude-sonnet-5-5')).toContain('no_extras')
    expect(ids('claude-haiku-5-5', 'low')).toContain('finish_all_parts')
    expect(ids('claude-haiku-5-5', 'high')).not.toContain('finish_all_parts')
    expect(ids(undefined)).not.toContain('no_extras')
    expect(ids('claude-opus-5-5', 'medium', true, true)).toContain('lookup')
    expect(ids('claude-opus-5-5', 'medium', true, true)).toContain('plan_assumption')
    expect(ids('claude-opus-5-5', 'medium', false, false)).not.toContain('lookup')
    expect(ids('claude-opus-5-5', 'medium', true, true)).not.toContain('skill_match')
    expect(checksFor('claude-opus-5-5', 'medium', true, true, true).map(a => a.check.id)).toContain('skill_match')
  })

  test('general checks are asked of the prompt and context together when there is context', async () => {
    const withCtx = checksFor(undefined, undefined, true, false).find(a => a.check.id === 'target')
    const without = checksFor(undefined, undefined, false, false).find(a => a.check.id === 'target')
    expect(withCtx?.check.question).toContain("Claude's plan")
    expect(without?.check.question).not.toContain("Claude's plan")
  })
})

describe('request and response', () => {
  const opening = {
    prompt: 'fix workitem 345',
    model: 'claude-opus-5-5',
    effort: 'medium',
    used: [{ kind: 'connector' as const, name: 'mcp__devops__get_work_item', description: 'Gets a work item' }],
    plan: 'I will read work item 345 and fix the bug it describes.',
  }

  test('the request carries the prompt, names, descriptions and plan', async () => {
    const { body } = buildRequest(opening)
    const req = JSON.parse(body)
    expect(req.model).toBe('~typesafe/jev-latest')
    expect(req.state.opening_prompt).toBe('fix workitem 345')
    expect(req.state.used[0].name).toBe('mcp__devops__get_work_item')
    expect(req.state.claude_plan).toContain('work item 345')
    expect(req.questions.grade.type).toBe('choice')
    expect(req.questions.lookup.type).toBe('noul')
  })

  test('no context and no plan: no context fields', async () => {
    const req = JSON.parse(buildRequest({ prompt: 'x', used: [], plan: '' }).body)
    expect(req.state).toEqual({ opening_prompt: 'x' })
    expect(req.questions.lookup).toBe(undefined)
  })

  test('caps the plan and the used list', async () => {
    const big = { ...opening, plan: 'p'.repeat(20000), used: Array.from({ length: 500 }, (_, i) => ({ kind: 'tool' as const, name: `Tool${i}` })) }
    const req = JSON.parse(buildRequest(big).body)
    expect(req.state.claude_plan.length).toBeLessThanOrEqual(8192)
    expect(JSON.stringify(req.state.used).length).toBeLessThanOrEqual(8192)
    expect(capUsed([{ kind: 'tool', name: 'a', description: 'd'.repeat(1000) }])[0]?.description?.length).toBeLessThanOrEqual(300)
  })

  test('parses a poor grade into issues, fills and a rewrite, worst first', async () => {
    const { asked } = buildRequest(opening)
    const answers: Record<string, unknown> = { grade: { type: 'choice', choice: 'poor' } }
    for (const { check } of asked) answers[check.id] = { type: 'noul', noul: check.yesIsProblem ? 0.1 : 0.9 }
    answers.done = { type: 'noul', noul: 0.05 }
    answers.target = { type: 'noul', noul: 0.3 }
    answers.lookup = { type: 'noul', noul: 0.95 }
    answers.skill_match = { type: 'noul', noul: 0.1 }
    const r = parseResponse(JSON.stringify({ answers, model: 'typesafe/jev-1.14', usage: { cost: 0.00006 } }), asked, 'fix workitem 345')
    expect(r.grade).toBe('poor')
    expect(r.failed.map(c => c.id)).toEqual(['done', 'target'])
    expect(r.issues[0]).toBe("Doesn't say what done looks like or how to check it.")
    expect(r.rewrite).toBe('fix workitem 345\n\n[done when: which tests or command should pass?]\n[which file, feature or error?]')
    expect(r.lookedUp).toBe(true)
    expect(r.skillMatched).toBe(false)
  })

  test('a yes-is-problem check fails on a high yes', async () => {
    const { asked } = buildRequest(opening)
    const answers: Record<string, unknown> = { grade: { type: 'choice', choice: 'could_be_better' } }
    for (const { check } of asked) answers[check.id] = { type: 'noul', noul: check.yesIsProblem ? 0.1 : 0.9 }
    answers.plan_assumption = { type: 'noul', noul: 0.9 }
    const r = parseResponse(JSON.stringify({ answers }), asked, 'p')
    expect(r.failed.map(c => c.id)).toEqual(['plan_assumption'])
  })

  test('good grade: no rewrite', async () => {
    const { asked } = buildRequest(opening)
    const r = parseResponse(JSON.stringify({ answers: { grade: { type: 'choice', choice: 'good' }, done: { type: 'noul', noul: 0.1 } } }), asked, 'p')
    expect(r.rewrite).toBe('')
  })

  test('errors and bad grades throw', async () => {
    expect(() => parseResponse(JSON.stringify({ error: { message: 'no credit' } }), [], 'p')).toThrow('no credit')
    expect(() => parseResponse(JSON.stringify({ answers: { grade: { type: 'choice', choice: 'great' } } }), [], 'p')).toThrow('unexpected grade')
  })

  test('prompt filtering', async () => {
    expect(stripReminders('<system-reminder>\nscratch\n</system-reminder>\n\nbang')).toBe('bang')
    expect(isSkippedPrompt('/model opus')).toBe(true)
    expect(isSkippedPrompt('<task-notification>x</task-notification>')).toBe(true)
    expect(isSkippedPrompt('fix it')).toBe(false)
  })
})

describe('context', () => {
  const messages: Message[] = [
    { role: 'user', text: 'old', toolUses: [] },
    { role: 'user', text: '<system-reminder>x</system-reminder>\nfix workitem 345', toolUses: [] },
    { role: 'assistant', text: "I'll look the item up first.", toolUses: [{ tool: 'mcp__devops__get_work_item', input: { id: 345 } }] },
    { role: 'user', text: '', toolUses: [] },
    {
      role: 'assistant',
      text: 'It says the export fails.',
      toolUses: [
        { tool: 'Skill', input: { skill: 'debugging' } },
        { tool: 'Read', input: { file_path: '/Users/u/.claude/memory/devops.md' } },
        { tool: 'Read', input: { file_path: '/repo/src/export.ts' } },
        { tool: 'Agent', input: { subagent_type: 'Explore' } },
      ],
    },
  ]

  test('first turn, plan and what was used', async () => {
    const turn = firstTurn(messages, 'fix workitem 345')
    expect(turn.length).toBe(3)
    expect(planOf(turn)).toBe("I'll look the item up first.\n\nIt says the export fails.")
    const { used } = await usedBy(
      turn,
      [{ name: 'mcp__devops__get_work_item', description: 'Gets an Azure DevOps work item' }],
      [{ name: 'debugging', description: 'Systematic debugging' }],
      async () => '---\nname: devops\ndescription: Work items live in Azure DevOps\n---\nbody',
    )
    expect(used).toEqual([
      { kind: 'connector', name: 'mcp__devops__get_work_item', description: 'Gets an Azure DevOps work item' },
      { kind: 'skill', name: 'debugging', description: 'Systematic debugging' },
      { kind: 'memory', name: 'memory/devops.md', description: 'Work items live in Azure DevOps' },
      { kind: 'tool', name: 'Read' },
      { kind: 'agent', name: 'Explore' },
    ])
    expect(JSON.stringify(used)).not.toContain('export.ts')
  })

  test("the task list is part of the plan, and the app's own tools are not context", async () => {
    const turn: Message[] = [
      {
        role: 'assistant',
        text: '',
        toolUses: [
          { tool: 'mcp__ccd_turn__update_plan', input: { items: [{ content: 'Read the work item', status: 'in_progress' }, { content: 'Fix the export', status: 'pending' }] } },
          { tool: 'TodoWrite', input: { todos: [{ content: 'Run the tests' }] } },
          { tool: 'mcp__ccd_turn__wrap_up', input: { recap: 'x' } },
          { tool: 'mcp__devops__get_work_item', input: {} },
        ],
      },
    ]
    expect(planOf(turn)).toBe('- Read the work item\n- Fix the export\n\n- Run the tests')
    const { used } = await usedBy(turn, [], [], async () => undefined)
    expect(used.map(u => u.name)).toEqual(['mcp__devops__get_work_item'])
  })

  test('memory paths and frontmatter', async () => {
    expect(isMemoryPath('/a/CLAUDE.md')).toBe(true)
    expect(isMemoryPath('C:\\Users\\u\\.claude\\memory\\x.md')).toBe(true)
    expect(isMemoryPath('/repo/src/a.ts')).toBe(false)
    expect(frontmatterDescription('---\ndescription: "Quoted"\n---')).toBe('Quoted')
    expect(frontmatterDescription('no frontmatter')).toBe(undefined)
  })
})
