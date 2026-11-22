// Prompt grader: grades how a session opened, once the first prompt has resolved,
// and shows the result in a side panel. Never blocks. Grading is one request to
// Jev on OpenRouter; no Claude tokens are spent.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Grading } from '../types'
import { firstTurn, planOf, usedBy, type Message } from './context'
import { API_URL, buildRequest, DEFAULT_MODEL, isSkippedPrompt, parseResponse, RAW_MARKER, stripReminders } from './jev'

const PANE = 'prompt-grader'
const TITLE = 'Prompt grader'
const TIMEOUT_MS = 5000
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])
const LOG_DIR = '.claude/plugins/data/prompt-grader-prompt-grader'
const LOG_MAX = 3 * 1024 * 1024

const INITIAL: Grading = { phase: 'waiting', isLive: true }
// Change the tag when Grading's fields change: it declines what an older version stored.
const grading = atom({ plugin: 'prompt-grader', key: 'grading' } as const, INITIAL, { shape: 'grading-1' })

const LABEL = { good: 'Good', could_be_better: 'Could be better', poor: 'Poor' } as const

async function apiKey($: EngineInterface, optionKey: string): Promise<string> {
  return optionKey || ((await $.env.get('OPENROUTER_API_KEY')) ?? '').trim()
}

async function home($: EngineInterface): Promise<string | undefined> {
  return (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
}

async function log($: EngineInterface, entry: Record<string, unknown>): Promise<void> {
  try {
    const dir = await home($)
    if (!dir) return
    const path = `${dir}/${LOG_DIR}/grades.jsonl`
    let text = ''
    try {
      text = await $.fs.read(path)
    } catch {
      text = ''
    }
    if (text.length > LOG_MAX) text = text.slice(text.indexOf('\n', text.length - LOG_MAX / 2) + 1)
    const line = JSON.stringify({ ts: new Date(await $.clock.now()).toISOString(), ...entry })
    await $.fs.write(path, text + line + '\n')
  } catch {
    // The log is a convenience; never let it break grading.
  }
}

async function grade($: EngineInterface, trigger: 'edit' | 'end', optionKey: string): Promise<void> {
  const state = await read($, grading)
  if (state.phase !== 'watching' || !state.prompt) return
  await update($, grading, s => ({ ...s, phase: 'grading' as const, trigger }))
  const started = await $.clock.now()
  const base = {
    mode: state.isLive ? 'live' : 'log',
    trigger,
    prompt: state.prompt,
    claude_model: state.model,
    effort: state.effort,
  }
  try {
    const key = await apiKey($, optionKey)
    if (!key) throw new Error('no OpenRouter API key')
    const messages = (await $.session.messages()) as unknown as Message[]
    const turn = firstTurn(messages, state.prompt)
    const [tools, commands] = await Promise.all([$.tool.list(), $.command.list()])
    const { used } = await usedBy(turn, tools, commands, async path => {
      try {
        return (await $.fs.read(path)).slice(0, 4096)
      } catch {
        return undefined
      }
    })
    const plan = planOf(turn)
    const { body, asked } = buildRequest(
      { prompt: state.prompt, model: state.model, effort: state.effort, used, plan },
      DEFAULT_MODEL,
    )
    const response = await Promise.race([
      $.http.fetch(API_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-OpenRouter-Title': 'prompt-grader' },
        body,
      }),
      $.clock.sleep(TIMEOUT_MS).then(() => {
        throw new Error(`Jev took longer than ${TIMEOUT_MS / 1000} s`)
      }),
    ])
    if (!response.ok) throw new Error(`Jev answered HTTP ${response.status}: ${response.text.slice(0, 160)}`)
    const result = parseResponse(response.text, asked, state.prompt)
    const names = used.map(u => ({ kind: u.kind, name: u.name }))
    await update($, grading, s => ({
      ...s,
      phase: 'graded' as const,
      grade: result.grade,
      issues: result.issues,
      rewrite: result.rewrite,
      used: names,
      lookedUp: result.lookedUp,
      skillMatched: result.skillMatched,
      hadPlan: plan.length > 0,
    }))
    await log($, {
      ...base,
      grade: result.grade,
      failed: result.failed.map(c => c.id),
      looked_up: result.lookedUp,
      skill_matched: result.skillMatched,
      used: names,
      had_plan: plan.length > 0,
      jev_model: result.jevModel,
      cost: result.cost,
      seconds: ((await $.clock.now()) - started) / 1000,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await update($, grading, s => ({ ...s, phase: message.includes('API key') ? ('nokey' as const) : ('error' as const), error: message }))
    await log($, { ...base, grade: 'error', error: message, seconds: ((await $.clock.now()) - started) / 1000 })
  }
}

/**
 * Whether a person is there to see the panel. `isInteractive` is false for any
 * SDK host, and the desktop app hosts Claude Code through the SDK, so it can't
 * decide this alone: the entrypoint tells `claude -p` and the SDK (`sdk-…`) from
 * the desktop app (`claude-desktop`) and the terminal (`cli`).
 */
async function isAttended($: EngineInterface, isInteractive: boolean): Promise<boolean> {
  if ((await $.env.get('CLAUDE_CODE_SESSION_ATTENDED')) === '0') return false
  if (isInteractive) return true
  const entrypoint = (await $.env.get('CLAUDE_CODE_ENTRYPOINT')) ?? ''
  return entrypoint !== '' && !entrypoint.startsWith('sdk')
}

async function openPane($: EngineInterface): Promise<void> {
  const s = await read($, grading)
  if (s.isLive && s.phase !== 'skipped') await $.ui.open({ id: PANE, title: TITLE })
}

async function start($: EngineInterface, isInteractive: boolean, mode: string, optionKey: string): Promise<void> {
  const isLive = mode !== 'log' && (await isAttended($, isInteractive))
  const resumed = (await $.session.messages()).length > 0
  const hasKey = (await apiKey($, optionKey)) !== ''
  const next: Grading = resumed
    ? { phase: 'skipped' as const, isLive, reason: 'Resumed session: only a new session is graded.' }
    : { phase: hasKey ? 'waiting' : 'nokey', isLive }
  await update($, grading, () => next)
  if (isLive && !resumed) void $.ui.open({ id: PANE, title: TITLE })
}

export const register: Register = (on, options) => {
  const mode = String(options.mode ?? 'live').toLowerCase()
  if (mode === 'off') return
  const optionKey = String(options.openrouter_api_key ?? '').trim()

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'prompt-grader', description: 'Show how this session opened, graded by Jev' })
    await start($, e.isInteractive, mode, optionKey)
    return next(e)
  })

  // /clear ends the session without a new session.start: start over here.
  on('session.end', async ($, e, next) => {
    const ran = await next(e)
    if (e.reason === 'clear') await start($, (await read($, grading)).isLive, mode, optionKey)
    return ran
  })

  // A surface that attaches after the session started (the desktop app's window)
  // may not have been drawing when session.start opened the panel.
  on('session.attach', async ($, e, next) => {
    const ran = await next(e)
    await openPane($)
    return ran
  })

  on('command.run', { command: 'prompt-grader' }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: 'Prompt grader panel opened.' }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const state = await read($, grading)
      const text = stripReminders(e.text)
      if (state.phase === 'waiting' && !isSkippedPrompt(text)) {
        if (text.endsWith(RAW_MARKER)) {
          await update($, grading, s => ({ ...s, phase: 'skipped' as const, reason: 'Sent with //raw, so not graded.' }))
          await log($, { mode: state.isLive ? 'live' : 'log', grade: 'skipped_raw' })
        } else {
          await update($, grading, s => ({ ...s, phase: 'watching' as const, prompt: text, turnId: e.turnId }))
          await openPane($)
        }
      }
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      const state = await read($, grading)
      if (state.turnId === e.turnId && state.model === undefined) {
        const effort = e.effort === undefined ? undefined : String(e.effort)
        await update($, grading, s => ({ ...s, model: e.model, effort }))
      }
    }
    return yield* next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId === undefined && EDIT_TOOLS.has(String(e.tool))) {
      const state = await read($, grading)
      // Grade beside the edit; the edit doesn't wait.
      if (state.phase === 'watching') void grade($, 'edit', optionKey)
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId === undefined) {
      const state = await read($, grading)
      if (state.phase === 'watching' && state.turnId === e.turnId) void grade($, 'end', optionKey)
    }
    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const s = await read($, grading)
    const surface = e.surface
    const width = Math.max(20, e.props.bodyColumns ?? 40)
    const short = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + '…' : t)

    if (s.phase === 'nokey') {
      return (
        <Box flexDirection="column">
          <Text bold>Needs an OpenRouter API key</Text>
          <Text>Run /plugin configure prompt-grader@prompt-grader, paste a key from openrouter.ai/keys, then restart Claude Code.</Text>
          {s.error ? <Text dimColor>{s.error}</Text> : null}
        </Box>
      )
    }
    if (s.phase === 'waiting') return <Text dimColor>Waiting for this session's first prompt.</Text>
    if (s.phase === 'skipped') return <Text dimColor>{s.reason ?? 'Not graded.'}</Text>
    if (s.phase === 'watching' || s.phase === 'grading') {
      return (
        <Box flexDirection="column">
          <Text dimColor>{short(s.prompt ?? '', width * 3)}</Text>
          <Text>{s.phase === 'grading' ? 'Grading…' : "Grading at Claude's first edit or the end of this turn."}</Text>
        </Box>
      )
    }
    if (s.phase === 'error') return <Text dimColor>Couldn't grade this opening: {s.error ?? 'unknown error'}</Text>

    const used = (s.used ?? []).filter(u => u.kind !== 'tool').map(u => u.name)
    const notes = [
      s.lookedUp ? 'The first turn looked up what the prompt points at.' : '',
      s.skillMatched ? 'A skill that fits the task loaded.' : '',
    ].filter(Boolean)
    return (
      <Box flexDirection="column">
        <Text bold>Opening: {LABEL[s.grade ?? 'good']}</Text>
        {notes.map(n => (
          <Text dimColor>{n}</Text>
        ))}
        {s.grade === 'good' ? <Text>Nothing to change.</Text> : null}
        {s.grade !== 'good' && !(s.issues ?? []).length ? <Text dimColor>Jev found no specific gap to point at.</Text> : null}
        {s.grade !== 'good'
          ? (s.issues ?? []).map(issue => (
              <Text>- {issue}</Text>
            ))
          : null}
        {used.length ? <Text dimColor>Used: {short(used.join(', '), width * 2)}</Text> : null}
        {s.rewrite ? (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Start again with</Text>
            <Text>{s.rewrite}</Text>
            <Button
              key="copy"
              label="Copy"
              onPress={async () => {
                const done = await $.ui.copy({ text: s.rewrite ?? '', surface })
                await update($, grading, g => ({
                  ...g,
                  copyNote: done.isCopied ? 'Copied.' : 'Copy not available here: select the text instead.',
                }))
              }}
            />
            {s.copyNote ? <Text dimColor>{s.copyNote}</Text> : null}
          </Box>
        ) : null}
        {s.grade === 'poor' ? (
          <Text dimColor>To start again: stop Claude, open a new session, paste the rewrite and fill in the brackets.</Text>
        ) : null}
      </Box>
    )
  })
}
