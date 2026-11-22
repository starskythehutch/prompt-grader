// What the first turn used and what Claude said it would do, from the session's
// messages. Only names and descriptions leave the machine: no tool arguments, no
// tool results, no file contents.

import { stripReminders, type Used } from './jev'

export type Message = {
  role: 'user' | 'assistant'
  text: string
  toolUses: readonly { tool: string; input: Record<string, unknown> }[]
}

export type Described = { name: string; description: string }

const MEMORY_FILE = /(^|\/)(CLAUDE\.md|MEMORY\.md)$|\/(memory|memories)\//i

export function isMemoryPath(path: string): boolean {
  return MEMORY_FILE.test(path.replace(/\\/g, '/'))
}

/** The `description:` line of a markdown file's frontmatter, if it has one. */
export function frontmatterDescription(text: string): string | undefined {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  const line = fm?.[1]?.split(/\r?\n/).find(l => l.startsWith('description:'))
  return line?.slice('description:'.length).trim().replace(/^["']|["']$/g, '') || undefined
}

/** The messages of the turn that began with `prompt`: from its user message on. */
export function firstTurn(messages: readonly Message[], prompt: string): Message[] {
  const start = messages.findIndex(m => m.role === 'user' && stripReminders(m.text) === prompt)
  return start < 0 ? [] : messages.slice(start + 1)
}

// Tools that keep Claude's own task list: their items are Claude's stated plan.
const PLAN_TOOLS: Record<string, (input: Record<string, unknown>) => unknown[]> = {
  mcp__ccd_turn__update_plan: input => (Array.isArray(input.items) ? input.items : []),
  TodoWrite: input => (Array.isArray(input.todos) ? input.todos : []),
}

/** The Claude desktop app's own session tools (task list, wrap-up, sessions): not context. */
export function isAppTool(tool: string): boolean {
  return tool.startsWith('mcp__ccd_')
}

/**
 * Claude's stated plan so far in the turn: its text, plus the items of any task
 * list it kept. Grading runs at the first edit or the end of the turn, so this
 * is what Claude said before acting, or its answer when it only answered.
 */
export function planOf(turn: readonly Message[]): string {
  const parts: string[] = []
  for (const m of turn) {
    if (m.role !== 'assistant') continue
    if (m.text.trim()) parts.push(m.text.trim())
    for (const call of m.toolUses) {
      const items = PLAN_TOOLS[call.tool]?.(call.input ?? {}) ?? []
      const lines = items
        .map(i => (typeof i === 'object' && i !== null ? (i as { content?: unknown }).content : i))
        .filter((c): c is string => typeof c === 'string' && c.trim() !== '')
      if (lines.length) parts.push(lines.map(l => `- ${l}`).join('\n'))
    }
  }
  return parts.join('\n\n')
}

/** What the turn used, by name, with descriptions looked up locally. */
export async function usedBy(
  turn: readonly Message[],
  tools: readonly Described[],
  commands: readonly Described[],
  readMemory: (path: string) => Promise<string | undefined>,
): Promise<Used[]> {
  const seen = new Set<string>()
  const used: Used[] = []
  const add = (u: Used) => {
    const id = `${u.kind}:${u.name}`
    if (seen.has(id)) return
    seen.add(id)
    used.push(u)
  }
  const describe = (list: readonly Described[], name: string) =>
    list.find(d => d.name === name || d.name.endsWith(`:${name}`))?.description
  for (const m of turn) {
    for (const call of m.toolUses) {
      const input = call.input ?? {}
      if (isAppTool(call.tool) || call.tool in PLAN_TOOLS) continue
      if (call.tool === 'Skill') {
        const name = String(input.skill ?? input.name ?? input.command ?? 'skill')
        add({ kind: 'skill', name, description: describe(commands, name) })
      } else if (call.tool.startsWith('mcp__')) {
        add({ kind: 'connector', name: call.tool, description: describe(tools, call.tool) })
      } else if (call.tool === 'Agent' || call.tool === 'Task') {
        add({ kind: 'agent', name: String(input.subagent_type ?? 'subagent') })
      } else if (call.tool === 'Read' && typeof input.file_path === 'string' && isMemoryPath(input.file_path)) {
        const name = input.file_path.replace(/\\/g, '/').split('/').slice(-2).join('/')
        add({ kind: 'memory', name, description: frontmatterDescription((await readMemory(input.file_path)) ?? '') })
      } else {
        add({ kind: 'tool', name: call.tool })
      }
    }
  }
  return used
}
