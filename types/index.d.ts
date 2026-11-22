export type GradingPhase =
  | 'waiting' // no graded prompt yet
  | 'watching' // first prompt sent, waiting for the first edit or the end of the turn
  | 'grading'
  | 'graded'
  | 'skipped' // resumed session, or the prompt ended with //raw
  | 'error'
  | 'nokey'

export type UsedName = { kind: string; name: string }

export type Grading = {
  phase: GradingPhase
  isLive: boolean
  reason?: string
  prompt?: string
  turnId?: string
  model?: string
  effort?: string
  trigger?: 'edit' | 'end'
  grade?: 'good' | 'could_be_better' | 'poor'
  issues?: string[]
  rewrite?: string
  used?: UsedName[]
  lookedUp?: boolean
  skillMatched?: boolean
  hadPlan?: boolean
  error?: string
  copyNote?: string
}

declare module 'claude-code' {
  interface PluginState {
    'prompt-grader': { grading: Shaped<Grading> }
  }
}
