// The grading rubric, taken from Anthropic's prompting docs (read 2026-11-22).
// The general and model-specific checks. rubric.ts adds the checks that
// use what the first turn looked up and Claude's plan.
//
// Jev answers typed questions only, so the rubric is a set of yes/no checks plus
// one overall grade. Each check carries the issue shown to the user and the
// bracketed fill-in added to the rewrite when it fails. Most checks are asked so
// that yes means fine (including when the point doesn't apply); `yesIsProblem`
// checks are asked the other way round, which Jev separated better.
//
// Sources:
//   BP   https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
//   CC   https://code.claude.com/docs/en/best-practices
//   F52  https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-2
//   O55  https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5
//   S55  https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-sonnet-5-5
//   H55  https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-haiku-5-5
//   O5   https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5
//   S5   https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-sonnet-5
//   F51  https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-fable-5-1

export type Check = {
  id: string
  source: string
  question: string
  true: string
  false: string
  issue: string
  fill: string | null
  yesIsProblem?: boolean
  models?: readonly string[]
  efforts?: readonly (string | undefined)[]
}

export const GENERAL: readonly Check[] = [
  {
    "id": "action",
    "source": "BP: be clear and direct; phrase action requests as actions",
    "question": "Does the prompt ask for a concrete action or ask a clear question?",
    "true": "It says what to do (fix, add, change, explain, review something specific) or asks a clear question.",
    "false": "It gives only a topic or a vague wish such as 'make it better', or asks 'can you suggest' when it wants changes made.",
    "issue": "Doesn't say what Claude should do.",
    "fill": "[what exactly should Claude do?]"
  },
  {
    "id": "target",
    "source": "CC: name the file, the symptom, and what fixed looks like",
    "question": "Does the prompt say what to work on?",
    "true": "It names the file, feature, component, error or symptom, or the task plainly covers the whole repo.",
    "false": "Claude would have to guess which code, feature or problem is meant.",
    "issue": "Doesn't name the file, feature or symptom.",
    "fill": "[which file, feature or error?]"
  },
  {
    "id": "reason",
    "source": "BP: give the reason behind an instruction",
    "question": "Does the prompt give the goal or reason where knowing it would change how the work is done?",
    "true": "It gives the reason, or the task is simple enough that the reason would change nothing.",
    "false": "The task could be done several ways and the prompt doesn't say what it is for.",
    "issue": "Doesn't say why, so Claude can't pick the right approach.",
    "fill": "[what is this for?]"
  },
  {
    "id": "outside_context",
    "source": "CC: tell Claude what it can't see from the repo; state a preference between approaches",
    "question": "Does the task hinge on a choice only the user can make (which of several approaches, a design preference, how something should behave) that the prompt doesn't state?",
    "true": "Yes: Claude would have to guess the user's choice or preference.",
    "false": "No: the prompt states the choice, or there is only one sensible way to do it.",
    "issue": "Leaves a choice to Claude that only you can make.",
    "fill": "[which approach or behaviour do you want?]",
    "yesIsProblem": true
  },
  {
    "id": "done",
    "source": "CC: give a check Claude can run that passes or fails; Sonnet 5.5 and Haiku 5.5 pages: ask for a real check",
    "question": "If the task changes code, does the prompt say what done looks like?",
    "true": "It names a check (tests, a command, a behaviour to see) or a finished state, or the task is a question or read-only.",
    "false": "It asks for code changes with no way to tell when they are finished or correct.",
    "issue": "Doesn't say what done looks like or how to check it.",
    "fill": "[done when: which tests or command should pass?]"
  },
  {
    "id": "output_form",
    "source": "BP: state the output format and constraints",
    "question": "If the result isn't code changes (a report, list, plan, document or file), does the prompt say what form it should take?",
    "true": "It names the form, or the result is code changes or a short answer.",
    "false": "It asks for a written result without saying its form, length or where it goes.",
    "issue": "Doesn't say what form the result should take.",
    "fill": "[what form: a list, a file, a short answer?]"
  },
  {
    "id": "scope",
    "source": "CC: name what Claude may touch; O5 and F51: constrain scope for narrow tasks",
    "question": "If the task could grow (refactor, redesign, improve, clean up), does the prompt say how far to go?",
    "true": "It sets the scope or what is out of bounds, or the task is already narrow.",
    "false": "It is open-ended about how much to change.",
    "issue": "Doesn't say how far to go or what's out of bounds.",
    "fill": "[how far should it go, and what's off limits?]"
  },
  {
    "id": "plain_rules",
    "source": "CC: current models follow a plainly worded line; emphasis makes Claude over-apply the rule",
    "question": "Does the prompt state its rules plainly, without capitals, stacked MUST/NEVER or other heavy emphasis?",
    "true": "Rules are written plainly, or there are no rules.",
    "false": "It shouts rules in capitals or piles on emphasis.",
    "issue": "Heavy emphasis makes Claude over-apply a rule; write it plainly.",
    "fill": null
  },
  {
    "id": "pasted_marked",
    "source": "BP: separate instructions from input with XML tags; O55: pasted text can carry instructions",
    "question": "If the prompt includes pasted material (logs, errors, emails, docs), is it marked off from the instructions?",
    "true": "Pasted material sits in a code block, quotes or tags, or there is none.",
    "false": "Pasted material runs into the instructions with nothing to mark where it starts and ends.",
    "issue": "Pasted material isn't marked off from the instructions.",
    "fill": null
  },
  {
    "id": "no_reasoning_dump",
    "source": "F52, O55, S55, H55: requests to write out reasoning can be refused",
    "question": "Does the prompt avoid asking Claude to write out its full reasoning or chain of thought?",
    "true": "It doesn't ask for that, or asks only for a short explanation or summary.",
    "false": "It asks for the full reasoning or thought process in the reply.",
    "issue": "Asking for full reasoning can be refused; ask for a short explanation.",
    "fill": null
  }
]

export const MODEL_SPECIFIC: readonly Check[] = [
  {
    "id": "fable_never",
    "models": [
      "fable-5-2"
    ],
    "source": "F52: an absolute 'never' is treated as absolute; write 'ask before'",
    "question": "Does the prompt avoid absolute 'never' or 'always' rules where the user would want judgment?",
    "true": "No absolute rules, or the rule really is absolute.",
    "false": "It says 'never' or 'always' about something where asking first would be better.",
    "issue": "Fable 5.2 treats 'never' as absolute; say 'ask before' if you want judgment.",
    "fill": null
  },
  {
    "id": "fable_ownership",
    "models": [
      "fable-5-2"
    ],
    "source": "F52: ownership wording leads to unrequested changes",
    "question": "Does the prompt avoid telling Claude it owns the codebase or its design, unless broad changes are wanted?",
    "true": "No ownership wording, or the prompt wants broad changes.",
    "false": "It hands Claude ownership of the code or design while asking for a narrow change.",
    "issue": "Fable 5.2 reads ownership wording as licence for changes you didn't ask for.",
    "fill": null
  },
  {
    "id": "opus55_style",
    "models": [
      "opus-5-5"
    ],
    "source": "O55: responds to instructions that name the patterns to avoid in frontend work",
    "question": "If the task is UI or visual design work, does the prompt say what look to aim for or avoid?",
    "true": "It names styles or patterns to use or avoid, or the task isn't visual.",
    "false": "It asks for UI or design work with no direction on the look.",
    "issue": "Opus 5.5 does better on UI work when you name styles to aim for or avoid.",
    "fill": "[look and feel: what to aim for or avoid?]"
  },
  {
    "id": "build_or_ideas",
    "models": [
      "sonnet-5-5"
    ],
    "source": "S55: open-ended requests can trigger building; say if you only want ideas",
    "question": "If the request is open-ended (ideas, options, what could we do), does it say whether to build or only suggest?",
    "true": "It says whether to build or only suggest, or the request isn't open-ended.",
    "false": "It is open-ended and doesn't say whether to make changes.",
    "issue": "Sonnet 5.5 tends to start building on open asks; say if you only want ideas.",
    "fill": "[only ideas, or build it?]"
  },
  {
    "id": "no_extras",
    "models": [
      "sonnet-5-5"
    ],
    "source": "S55: adds tests, docs and small files at every effort level unless told not to",
    "question": "Does the prompt describe a small or minimal change (words like 'just', 'only', 'quick', 'small') without saying whether tests or docs should be added?",
    "true": "Yes: it signals a minimal change and says nothing about tests or docs.",
    "false": "No: it doesn't signal a minimal change, or it says what to do about tests and docs.",
    "issue": "Sonnet 5.5 adds tests, docs and files unless told not to.",
    "fill": "[add tests or docs, or only the change?]",
    "yesIsProblem": true
  },
  {
    "id": "finish_all_parts",
    "models": [
      "sonnet-5-5",
      "haiku-5-5"
    ],
    "efforts": [
      "low",
      "medium",
      undefined,
      undefined
    ],
    "source": "S55 and H55: at low and medium effort the model can stop after one part",
    "question": "If the prompt asks for several things, does it make clear that all of them must be done before stopping?",
    "true": "It is a single task, or it says to finish every part.",
    "false": "It lists several tasks and doesn't say to finish them all.",
    "issue": "At this effort the model can stop after one part; say to finish every part.",
    "fill": "[finish every part before stopping]"
  },
  {
    "id": "opus5_oververify",
    "models": [
      "opus-5"
    ],
    "source": "O5: verifies its own work; asking for extra checks causes over-verification",
    "question": "Does the prompt avoid asking for extra double-checking or a final verification pass?",
    "true": "It doesn't ask for extra checking beyond a named test or command.",
    "false": "It asks Claude to double-check or add a final verification step.",
    "issue": "Opus 5 already checks its work; extra 'double-check' asks cause over-verification.",
    "fill": null
  },
  {
    "id": "sonnet5_literal",
    "models": [
      "sonnet-5"
    ],
    "source": "S5: follows instructions literally and doesn't generalise from one item to the next",
    "question": "If a rule should apply to many items, does the prompt say it applies to all of them?",
    "true": "It states the scope of each rule, or there are no such rules.",
    "false": "It gives a rule for one item and seems to expect it applied everywhere.",
    "issue": "Sonnet 5 applies rules literally; say when a rule applies to every item.",
    "fill": null
  },
  {
    "id": "fable51_scope",
    "models": [
      "fable-5-1"
    ],
    "source": "F51: for coding, say not to fix, optimise or extend beyond the request",
    "question": "For a coding change, does the prompt say whether nearby fixes or extensions are wanted?",
    "true": "It says whether to stay narrow, or the task isn't a code change.",
    "false": "It asks for a code change without saying whether to stay narrow.",
    "issue": "Fable 5.1 may extend the change; say whether to stay narrow.",
    "fill": "[stay narrow, or fix nearby issues too?]"
  }
]
