import { expect, test } from 'claude-code/testing'

// The whole flow through the engine: session start, first prompt, the trigger,
// one Jev request, the panel. The test's hooks stand for the engine beneath.

const PANE = {
  plugin: 'prompt-grader',
  component: 'Pane',
  requestId: 'prompt-grader',
  props: {
    title: 'Prompt grader',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

type Fetch = { url: string; init?: { body?: string; headers?: Record<string, string> } }

function engine(on: any, opts: { configDir?: string; grade?: string; failing?: string[]; messages?: unknown[]; key?: string; entrypoint?: string; httpError?: { status: number; text: string }; hang?: boolean } = {}) {
  const fetches: Fetch[] = []
  const writes: { path: string; text: string }[] = []
  const opened: string[] = []
  let messages: unknown[] = opts.messages ?? []
  on('command.register', () => ({ value: { command: 'prompt-grader' } }))
  on('ui.open', (_: unknown, e: { id: string }) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.messages', () => ({ value: messages }))
  on('tool.list', () => ({ value: [{ name: 'mcp__devops__get_work_item', description: 'Gets a work item', mcp: true }] }))
  on('command.list', () => ({ value: [] }))
  on('env.get', (_: unknown, e: { name: string }) => ({
    value:
      e.name === 'OPENROUTER_API_KEY' ? opts.key ?? 'test-key'
      : e.name === 'HOME' ? '/home/t'
      : e.name === 'CLAUDE_CONFIG_DIR' ? opts.configDir
      : e.name === 'CLAUDE_CODE_ENTRYPOINT' ? opts.entrypoint
      : undefined,
  }))
  on('fs.read', () => ({ value: '' }))
  on('clock.now', () => ({ value: 1_000 }))
  on('clock.sleep', () => new Promise(() => {}))
  on('fs.write', (_: unknown, e: { path: string; text: string }) => {
    writes.push(e)
    return { value: undefined }
  })
  on('http.fetch', (_: unknown, e: Fetch) => {
    fetches.push(e)
    if (opts.hang) return new Promise(() => {})
    if (opts.httpError) return { value: { ...opts.httpError, ok: false, headers: {} } }
    const body = JSON.parse(e.init?.body ?? '{}')
    const answers: Record<string, unknown> = { grade: { type: 'choice', choice: opts.grade ?? 'good' } }
    for (const [id, q] of Object.entries(body.questions ?? {}) as [string, any][]) {
      if (q.type !== 'noul') continue
      const yesIsProblem = String(q.criteria?.true ?? '').startsWith('Yes:') && id !== 'lookup' && id !== 'skill_match'
      const bad = (opts.failing ?? []).includes(id)
      answers[id] = { type: 'noul', noul: bad !== yesIsProblem ? 0.1 : 0.9 }
    }
    return { value: { status: 200, ok: true, headers: {}, text: JSON.stringify({ answers, model: 'typesafe/jev-1.14' }) } }
  })
  on('turn.start', (_: unknown, e: unknown) => e)
  on('turn.complete', (_: unknown, e: { answer: string }) => ({ text: e.answer }))
  on('tool.call', () => ({ result: {} }))
  on('session.end', (_: unknown, e: { sessionId?: string }) => ({ sessionId: e.sessionId ?? 's-1' }))
  return { fetches, writes, opened, setMessages: (m: unknown[]) => (messages = m) }
}

// The test runner has timers; the mod's own environment doesn't, so they aren't in its types.
declare const setTimeout: (run: () => void, ms: number) => unknown
const settle = () => new Promise<void>(resolve => setTimeout(resolve, 30))

async function panelText($: any): Promise<string> {
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const texts = await ui.findAll({ type: 'Text' })
  await ui.unmount()
  return texts.map((t: { text: string }) => t.text).join('\n')
}

const PROMPT_MESSAGES = (prompt: string, plan: string) => [
  { role: 'user', text: prompt, toolUses: [] },
  { role: 'assistant', text: plan, toolUses: [{ tool: 'mcp__devops__get_work_item', tool_use_id: 't1', input: { id: 345 } }] },
]

test('grades at the first edit, with context, and shows it in the panel', async ($, on) => {
  const eng = engine(on, { grade: 'poor', failing: ['done', 'target'] })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(eng.opened).toEqual(['prompt-grader'])
  expect(await panelText($)).toContain('Waiting')

  await $.turn.start({ text: 'fix workitem 345', turnId: 'turn-1' })
  expect(await panelText($)).toContain("first edit or the end of this turn")

  eng.setMessages(PROMPT_MESSAGES('fix workitem 345', "I'll read work item 345."))
  await $.tool.call({ tool: 'Edit', file_path: '/r/a.ts', old_string: 'a', new_string: 'b' })
  await settle()

  expect(eng.fetches.length).toBe(1)
  const req = JSON.parse(eng.fetches[0]!.init!.body!)
  expect(req.state.used[0].name).toBe('mcp__devops__get_work_item')
  expect(req.state.claude_plan).toBe("I'll read work item 345.")
  expect(eng.fetches[0]!.init!.headers!.Authorization).toBe('Bearer test-key')

  const text = await panelText($)
  expect(text).toContain('Opening: Poor')
  expect(text).toContain("Doesn't say what done looks like")
  expect(text).toContain('[done when: which tests or command should pass?]')
  expect(text).toContain('Used: mcp__devops__get_work_item')

  const log = eng.writes.at(-1)!
  expect(log.path).toBe('/home/t/.claude/plugins/data/prompt-grader-prompt-grader/grades.jsonl')
  expect(log.text).toContain('"trigger":"edit"')
  expect(log.text).not.toContain('test-key')
})

test('grades at the end of the turn when Claude makes no edit', async ($, on) => {
  const eng = engine(on, { grade: 'good' })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'what does the retry logic do?', turnId: 'turn-1' })
  eng.setMessages([{ role: 'user', text: 'what does the retry logic do?', toolUses: [] }, { role: 'assistant', text: 'It retries three times.', toolUses: [] }])
  await $.turn.complete({ answer: 'It retries three times.', durationMs: 5, isAborted: false, turnId: 'turn-1', reason: 'answer' })
  await settle()
  expect(eng.fetches.length).toBe(1)
  expect(await panelText($)).toContain('Opening: Good')
})

test('only the first prompt is graded', async ($, on) => {
  const eng = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'first', turnId: 'turn-1' })
  await $.turn.complete({ answer: 'ok', durationMs: 5, isAborted: false, turnId: 'turn-1', reason: 'answer' })
  await settle()
  await $.turn.start({ text: 'second', turnId: 'turn-2' })
  await $.tool.call({ tool: 'Write', file_path: '/r/b.ts', content: 'x' })
  await $.turn.complete({ answer: 'ok', durationMs: 5, isAborted: false, turnId: 'turn-2', reason: 'answer' })
  await settle()
  expect(eng.fetches.length).toBe(1)
})

test('slash commands and notifications keep waiting; //raw skips', async ($, on) => {
  const eng = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: '/model opus', turnId: 't0' })
  await $.turn.start({ text: '<task-notification>x</task-notification>', turnId: 't1' })
  expect(await panelText($)).toContain('Waiting')
  await $.turn.start({ text: 'do the thing //raw', turnId: 't2' })
  await $.turn.complete({ answer: 'ok', durationMs: 5, isAborted: false, turnId: 't2', reason: 'answer' })
  await settle()
  expect(eng.fetches.length).toBe(0)
  expect(await panelText($)).toContain('//raw')
})

test('a resumed session is not graded and opens no panel', async ($, on) => {
  const eng = engine(on, { messages: [{ role: 'user', text: 'earlier', toolUses: [] }] })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(eng.opened).toEqual([])
  expect(await panelText($)).toContain('Resumed')
})

test('subagent edits do not trigger grading', async ($, on) => {
  const eng = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'fix it', turnId: 'turn-1' })
  await $.tool.call({ tool: 'Edit', file_path: '/r/a.ts', old_string: 'a', new_string: 'b', agentId: 'sub-1' })
  await settle()
  expect(eng.fetches.length).toBe(0)
})

test('no key: the panel says how to set one, and nothing is sent', async ($, on) => {
  const eng = engine(on, { key: '' })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(await panelText($)).toContain('/plugin configure prompt-grader@prompt-grader')
  await $.turn.start({ text: 'fix it', turnId: 'turn-1' })
  expect(eng.fetches.length).toBe(0)
})

test('the key option is used before the environment', { options: { openrouter_api_key: 'option-key' } }, async ($, on) => {
  const eng = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'fix it', turnId: 'turn-1' })
  await $.tool.call({ tool: 'Edit', file_path: '/r/a.ts', old_string: 'a', new_string: 'b' })
  await settle()
  expect(eng.fetches[0]!.init!.headers!.Authorization).toBe('Bearer option-key')
})

test('log mode grades without opening the panel', { options: { mode: 'log' } }, async ($, on) => {
  const eng = engine(on, { grade: 'poor', failing: ['action'] })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  expect(eng.opened).toEqual([])
  await $.turn.start({ text: 'make it better', turnId: 'turn-1' })
  await $.turn.complete({ answer: 'ok', durationMs: 5, isAborted: false, turnId: 'turn-1', reason: 'answer' })
  await settle()
  expect(eng.fetches.length).toBe(1)
  expect(eng.writes.at(-1)!.text).toContain('"mode":"log"')
})

test('a headless session is log-only', async ($, on) => {
  const eng = engine(on, { entrypoint: 'sdk-cli' })
  await $.session.start({ cwd: '/', surface: null, isInteractive: false })
  expect(eng.opened).toEqual([])
  await $.turn.start({ text: 'fix it', turnId: 'turn-1' })
  expect(eng.opened).toEqual([])
})

test('the desktop app is live although its session reads as not interactive', async ($, on) => {
  const eng = engine(on, { entrypoint: 'claude-desktop', grade: 'poor', failing: ['action'] })
  await $.session.start({ cwd: '/', surface: null, isInteractive: false })
  expect(eng.opened.length).toBeGreaterThan(0)
  await $.turn.start({ text: 'make it better', turnId: 'turn-1' })
  await $.turn.complete({ answer: 'ok', durationMs: 5, isAborted: false, turnId: 'turn-1', reason: 'answer' })
  await settle()
  expect(eng.writes.at(-1)!.text).toContain('"mode":"live"')
})

test('off mode does nothing', { options: { mode: 'off' } }, async ($, on) => {
  const eng = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'fix it', turnId: 'turn-1' })
  await $.turn.complete({ answer: 'ok', durationMs: 5, isAborted: false, turnId: 'turn-1', reason: 'answer' })
  expect(eng.opened).toEqual([])
  expect(eng.fetches.length).toBe(0)
})

test('the first turn records the model and effort it ran with', async ($, on) => {
  const eng = engine(on)
  on('turn.step', (async function* (_: unknown, e: { turnId: string; index: number }) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] }
  }) as any)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'fix it', turnId: 'turn-1' })
  const stream = $.turn.step({ turnId: 'turn-1', index: 0, model: 'claude-haiku-5-5', effort: 'low', messageCount: 1 })
  for await (const _ of stream) {
    // drain
  }
  await $.turn.complete({ answer: 'ok', durationMs: 5, isAborted: false, turnId: 'turn-1', reason: 'answer' })
  await settle()
  const req = JSON.parse(eng.fetches[0]!.init!.body!)
  expect(req.state.claude_model).toBe('claude-haiku-5-5')
  expect(req.state.effort).toBe('low')
  expect(Object.keys(req.questions)).toContain('finish_all_parts')
})

test('two edits at once send one request', async ($, on) => {
  const eng = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'fix it', turnId: 'turn-1' })
  await Promise.all([
    $.tool.call({ tool: 'Edit', file_path: '/r/a.ts', old_string: 'a', new_string: 'b' }),
    $.tool.call({ tool: 'Edit', file_path: '/r/b.ts', old_string: 'a', new_string: 'b' }),
  ])
  await settle()
  expect(eng.fetches.length).toBe(1)
})

test('a rejected key is an error, not a missing key', async ($, on) => {
  engine(on, { httpError: { status: 401, text: '{"error":{"message":"Invalid API key"}}' } })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'fix it', turnId: 'turn-1' })
  await $.tool.call({ tool: 'Edit', file_path: '/r/a.ts', old_string: 'a', new_string: 'b' })
  await settle()
  const text = await panelText($)
  expect(text).toContain("Couldn't grade")
  expect(text).not.toContain('Needs an OpenRouter API key')
})

test('/clear starts a new grading even while the old messages are still there', async ($, on) => {
  const eng = engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'fix it', turnId: 'turn-1' })
  eng.setMessages([{ role: 'user', text: 'fix it', toolUses: [] }])
  await $.session.end({ reason: 'clear' })
  expect(await panelText($)).toContain('Waiting')
})

test('the log follows CLAUDE_CONFIG_DIR', async ($, on) => {
  const eng = engine(on, { configDir: '/cfg' })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'fix it', turnId: 'turn-1' })
  await $.tool.call({ tool: 'Edit', file_path: '/r/a.ts', old_string: 'a', new_string: 'b' })
  await settle()
  expect(eng.writes.at(-1)!.path).toBe('/cfg/plugins/data/prompt-grader-prompt-grader/grades.jsonl')
})

test('the edit runs without waiting for Jev', async ($, on) => {
  const eng = engine(on, { hang: true })
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'fix it', turnId: 'turn-1' })
  await $.tool.call({ tool: 'Edit', file_path: '/r/a.ts', old_string: 'a', new_string: 'b' })
  await settle()
  expect(eng.fetches.length).toBe(1)
  expect(await panelText($)).toContain('Grading')
})
