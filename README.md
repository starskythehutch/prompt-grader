# prompt-grader

A Claude Code mod that grades how each session opened and shows suggestions in a side panel. A vague opening prompt can send a whole session the wrong way, and every correction turn after that reloads the full context. The panel tells you early, so you can stop and start again with a better prompt, and it teaches what a good opening looks like.

It never blocks. It waits until your first prompt has resolved (Claude's first file edit, or the end of its first turn, whichever comes first), because a short prompt can be enough once the context is known. "fix workitem 345" says little on its own, but if Claude looked the work item up and it describes the task, the opening was fine.

Grading is done by Jev, TypeSafe's decisions model on OpenRouter (`~typesafe/jev-latest` on the `/api/alpha/decisions` endpoint), not by Claude, so it spends none of your Claude allowance. A grade costs about $0.0001 on your OpenRouter account and takes under half a second.

## What you see

The panel opens beside the chat when a new session starts:

1. Before your first prompt: "Waiting for this session's first prompt."
2. After it: your prompt, and "Grading at Claude's first edit or the end of this turn."
3. Once graded: the grade (good, could be better or poor), notes such as "The first turn looked up what the prompt points at", at most three issues, the skills, connectors and memory the first turn used, and a rewrite of your prompt with `[bracketed]` questions for what was missing. A Copy button copies the rewrite where the surface allows it; otherwise select the text.

If the grade is poor and you want to start again: stop Claude, open a new session, paste the rewrite and fill in the brackets.

Run `/prompt-grader` to open the panel again after closing it.

Only the first prompt of a new session is graded. Resumed sessions aren't graded, and `/clear` starts a new grading. Slash commands and notifications that Claude Code or other plugins inject don't count as the first prompt. End a prompt with `//raw` to skip grading for that session; the marker stays in the prompt Claude sees.

## How it grades

One request to Jev per session. Jev is a classifier: it answers typed questions with probabilities and writes no text. The request asks for an overall grade and a set of yes/no checks, defined in [hooks/rubric-checks.ts](hooks/rubric-checks.ts) and [hooks/rubric.ts](hooks/rubric.ts), each with the Anthropic page it comes from:

- General checks from Anthropic's [prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) and the [Claude Code best practices](https://code.claude.com/docs/en/best-practices): says what to do and on what, gives the reason where it changes the approach, states choices only you can make, says what done looks like, names the output form, sets the scope, states rules plainly, marks off pasted material, doesn't ask for full reasoning. When the first turn used anything, these are judged against your prompt together with what was looked up and Claude's plan.
- Model-specific checks from each model's prompting page, for the model and effort the first turn actually ran with: Fable 5.2, Opus 5.5, Sonnet 5.5, Haiku 5.5, and the previous Opus 5, Sonnet 5 and Fable 5.1.
- Context checks: did the first turn look up what the prompt points at, did a matching skill load (both shown as notes, not faults), and did Claude's plan settle a consequential choice your prompt left open.

The issues are the failed checks, worst first. The rewrite is your prompt plus a bracketed question for each gap.

## Install

You need the latest Claude Code and an [OpenRouter](https://openrouter.ai) account with a little credit and an API key from https://openrouter.ai/keys.

Install from GitHub. At the prompt of a terminal session:

```
/plugin install prompt-grader --marketplace starskythehutch/prompt-grader
```

Answer `y` to add the marketplace, then pick the user scope. From a shell:

```bash
claude plugin install prompt-grader --marketplace starskythehutch/prompt-grader
```

In the desktop app, where `/plugin` doesn't run: click + next to the prompt box, then Plugins, Add marketplace with `starskythehutch/prompt-grader`, then Add plugin.

The repository is private: installing needs read access to it on GitHub and a git credential for github.com on your machine (an SSH key, or `gh auth login` then `gh auth setup-git`). The install doesn't prompt for one.

To work on it from a clone instead, add the clone as a marketplace and install from there; Claude Code then reads the mod straight from that folder:

```bash
claude plugin marketplace add /path/to/prompt-grader
```

```bash
claude plugin install prompt-grader@prompt-grader --scope user
```

Then set your key. In a Claude Code session run `/plugin configure prompt-grader@prompt-grader`, or open `/plugin`, pick prompt-grader and choose Configure, and paste the key into the masked field. From a terminal, pipe a JSON object to `--values-stdin`; on macOS, if the key is already in your keychain, this copies it across without printing it:

```bash
security find-generic-password -a "$USER" -s OPENROUTER_API_KEY -w | jq -Rc '{openrouter_api_key: .}' | claude plugin configure prompt-grader@prompt-grader --values-stdin
```

Restart Claude Code afterwards. Claude Code keeps the key in your system's secure credential store. If the option is empty, the mod uses `OPENROUTER_API_KEY` from Claude Code's environment. Until a key is found, the panel says how to set one.

To remove it, which also deletes the stored key:

```bash
claude plugin uninstall prompt-grader@prompt-grader
```

## Modes

The plugin's Mode option:

- `live` (default): grade and show the panel.
- `log`: grade and write the log, with no panel.
- `off`: do nothing and make no OpenRouter calls.

Sessions with nobody at the keyboard (`claude -p`, the Agent SDK) are always graded in `log` mode.

## Log

Every graded session adds a line to `~/.claude/plugins/data/prompt-grader-prompt-grader/grades.jsonl`: the time, mode, what triggered grading (`edit` or `end`), the grade, the failed checks, the notes, what was used, whether there was a plan, the prompt, the Claude model and effort, the Jev version, the cost and how long it took. Errors and `//raw` skips are logged too. The key is never logged.

```bash
tail -n 20 ~/.claude/plugins/data/prompt-grader-prompt-grader/grades.jsonl | jq -c '{ts, grade, trigger, failed, prompt}'
```

## Privacy

For each graded session, OpenRouter and TypeSafe (the provider that runs Jev) receive:

- your first prompt;
- the Claude model and effort;
- the names of the skills, tools, connectors and memory files the first turn used, with the descriptions of skills, connectors and memory files;
- Claude's plan: its text in the first turn up to the grading point, and the items of its task list.

Claude writes its plan after reading things, so the plan can mention file names, function names and details from what it looked up. Tool arguments, tool results, file contents and later prompts are never sent. Prompts ending in `//raw`, resumed sessions and everything in `off` mode send nothing.

## Development

The mod is a TypeScript hooks module ([hooks/register.tsx](hooks/register.tsx)) that Claude Code runs itself; there is nothing to build. Pure parts (the request, the response, the context) are in `hooks/jev.ts`, `hooks/rubric.ts` and `hooks/context.ts`.

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

The tests stub the engine and Jev; [docs/mod-design.md](docs/mod-design.md) has the design.
