# prompt-grader

Find out whether your opening prompt gave Claude enough to go on, while you can still do something about it.

prompt-grader is a Claude Code plugin. It watches the first turn of each new session. At Claude's first file edit, or at the end of that turn if Claude only answers, it grades how the session opened. The grade appears in a panel beside the chat, with the gaps it found and your prompt rewritten with a bracketed question for each gap. Claude keeps working while it grades; the edit doesn't wait.

This is the panel for one of the test openings below:

```
Opening: Could be better
- Leaves a choice to Claude that only you can make.
- Doesn't say how far to go or what's out of bounds.
- Doesn't say what done looks like or how to check it.

Start again with
add dark mode to the settings page

[which approach or behaviour do you want?]
[how far should it go, and what's off limits?]
[done when: which tests or command should pass?]
[Copy]
```

## Why the first prompt

Anthropic's [Claude Code best practices](https://code.claude.com/docs/en/best-practices) make two points about this. A prompt that names the file, describes the symptom and says what "fixed" looks like usually saves you a round of corrections. And once you have corrected the same thing twice, a third correction mostly adds to a conversation Claude has to keep re-reading, so the page's advice is to `/clear` and write a better prompt instead.

That advice arrives after two failed corrections. prompt-grader tells you after the first turn.

## It reads what Claude looked up

A short prompt can be a good prompt. "fix workitem 345" says very little, but if Claude fetched work item 345 and the item describes the bug and the test for the fix, Claude has what it needs. So prompt-grader waits until Claude has had a chance to look things up, and it grades your prompt together with what the first turn used (skills, connectors, memory files) and the plan Claude wrote.

These grades come from the plugin's own request code, with each opening sent to the grader five times as if Claude Opus 5.5 at high effort had run the first turn:

| Opening | Grade in all five runs |
| --- | --- |
| `make it better` | Poor |
| `make it dark mode` | Poor |
| `fix workitem 345` | Could be better |
| `fix workitem 345`, after Claude fetched the work item and planned from it | Good |
| `add dark mode to the settings page` | Could be better |
| `In src/auth/session.ts, refreshToken() retries forever when the server returns 401. Make it stop after 3 attempts and pass the error to the caller, so the login screen can show it. Done when npm test passes, including a new test for the 401 case.` | Good |
| `what does the retry logic in src/net/client.ts do?` | Good |

Plain questions and well-specified tasks pass. The grading instructions tell the grader to be lenient with experienced users.

## It costs almost nothing, and none of your Claude usage

Grading is one request per session to Jev, TypeSafe's classifier model on [OpenRouter](https://openrouter.ai). Claude is never called for grading, so it uses none of your Claude tokens or plan limits.

In the 35 test requests behind the table above, Jev answered in 0.19 to 0.61 seconds (median 0.21), and each request cost between $0.000061 and $0.000081 on the OpenRouter account. In five real sessions, the whole grade from trigger to panel took 0.36 to 0.66 seconds and cost at most $0.000084. At those prices, 10,000 graded sessions cost under a dollar.

These figures were measured on 2026-11-22 against Jev version `jev-1.14-20261014`. A longer plan or more context makes the request bigger, and the price goes up with it.

## What it checks

The grader answers a fixed set of yes/no checks plus an overall grade. Each check in [hooks/rubric-checks.ts](hooks/rubric-checks.ts) names the Anthropic page it comes from.

General checks come from [Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) and the [Claude Code best practices](https://code.claude.com/docs/en/best-practices). Does the prompt say what to do and on what? Does it give the reason where the reason changes the approach, state the choices only you can make, say what done looks like, and set the scope? Is pasted material marked off, and does it avoid shouted rules and requests for Claude's full reasoning?

Model checks apply to the model and effort the first turn actually ran with, from each model's prompting page. Sonnet 5.5 tends to add tests, docs and small files nobody asked for, so on Sonnet 5.5 a "quick fix" prompt that doesn't say whether to add them is flagged. Fable 5.2 treats "never" as absolute, so on Fable 5.2 the grader suggests "ask before" where you want judgment. The models covered are Fable 5.2, Opus 5.5, Sonnet 5.5, Haiku 5.5, Opus 5, Sonnet 5 and Fable 5.1.

First-turn checks ask whether Claude looked up what the prompt points at, whether a skill that fits the task loaded, and whether Claude's plan made a consequential choice your prompt left open.

The panel shows the failed checks, worst first, at most three. The rewrite is your prompt plus a bracketed question for each gap, ready to copy into a new session.

## Install

You need the latest Claude Code and an OpenRouter account with a little credit and an [API key](https://openrouter.ai/keys).

```bash
claude plugin install prompt-grader --marketplace starskythehutch/prompt-grader
```

This adds the marketplace and installs the plugin for your user, so it also runs in the Claude desktop app's Code tab.

Then give it your key. In a session, run `/plugin configure prompt-grader@prompt-grader` and paste the key into the masked field. Or pipe the key in from a shell; on macOS, if the key is already in your keychain, this copies it across without printing it:

```bash
security find-generic-password -a "$USER" -s OPENROUTER_API_KEY -w | jq -Rc '{openrouter_api_key: .}' | claude plugin configure prompt-grader@prompt-grader --values-stdin
```

Restart Claude Code afterwards. Claude Code keeps the key in your system's secure credential store. If the option is empty, the plugin uses `OPENROUTER_API_KEY` from Claude Code's environment. Until it finds a key, the panel says how to set one.

To remove the plugin, which also deletes its log:

```bash
claude plugin uninstall prompt-grader@prompt-grader
```

## Using it

The panel opens when a new session starts and fills in when the first turn reaches an edit or ends. Run `/prompt-grader` to reopen it.

Only the first prompt of a new session is graded. Resumed sessions aren't graded, `/clear` starts a new grading, and slash commands don't count as the first prompt. End a prompt with `//raw` to skip grading for that session.

The plugin's Mode option sets what it does. `live`, the default, grades and shows the panel. `log` grades and writes the log without a panel. `off` does nothing and sends nothing. Sessions with nobody at the keyboard (`claude -p`, the Agent SDK) are graded in `log` mode.

## What leaves your machine

For each graded session, OpenRouter and TypeSafe (which runs Jev) receive:

- your first prompt;
- the Claude model and effort;
- the names of the skills, tools, connectors and memory files the first turn used, with the descriptions of the skills, connectors and memory files;
- Claude's plan: its text in the first turn up to the grading point, and the items of its task list.

Claude writes its plan after reading things, so the plan can mention file and function names and details from what it looked up. Tool arguments, tool results, file contents and later prompts are never sent. Prompts ending in `//raw`, resumed sessions and `off` mode send nothing.

## Log

Each graded session adds a line to `~/.claude/plugins/data/prompt-grader-prompt-grader/grades.jsonl`, or under `CLAUDE_CONFIG_DIR` instead of `~/.claude` if you set it. The line has the time, mode, trigger, grade, failed checks, what was used, the prompt, the Claude model and effort, the Jev version, the cost and how long grading took. Errors and `//raw` skips are logged too. The key is never logged.

```bash
tail -n 20 ~/.claude/plugins/data/prompt-grader-prompt-grader/grades.jsonl | jq -c '{ts, grade, trigger, failed, prompt}'
```

## Development

The plugin is a TypeScript hooks module, [hooks/register.tsx](hooks/register.tsx), that Claude Code runs itself, so there is nothing to build. The request, the response parsing and the context extraction are pure functions in `hooks/jev.ts`, `hooks/rubric.ts` and `hooks/context.ts`. [docs/mod-design.md](docs/mod-design.md) has the design and calibration notes.

To work from a clone, add it as a marketplace and install from it. Claude Code then reads the plugin straight from that folder:

```bash
claude plugin marketplace add /path/to/prompt-grader
```

```bash
claude plugin install prompt-grader@prompt-grader --scope user
```

The tests stub Claude Code's engine and Jev:

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

## Licence

MIT. See [LICENSE](LICENSE).
