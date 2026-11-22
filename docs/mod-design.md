# Prompt grader as a mod: design

Status: built and in use, 2026-11-22. The mod replaced the earlier hooks plugin, which has been removed. My proposals were accepted, except keeping the hooks plugin as a fallback; they are still marked **Proposal** so the record shows where each decision came from.

## Why change it

The current plugin grades the first prompt before Claude sees it and blocks poor ones. That misses context the first prompt creates. "fix workitem 345" fails every check on its own, but in a setup where memory says work items live in Azure DevOps and a connector can fetch the item, Claude may have everything it needs. The same goes for a prompt that loads a skill, by slash command or because the skill's description matches.

The grader can only judge that after the first prompt has resolved. By then Claude has started work, so blocking no longer makes sense. The grader becomes a guide: it shows how the opening went, and you decide whether to stop and start again with a better prompt.

## Agreed decisions

- Grade only the first prompt of a session.
- Grade after the first prompt has resolved, at whichever comes first: Claude's first file edit, or the end of the first turn.
- Never block. The edit goes ahead without waiting for the grade.
- Show the result in a side panel beside the chat.
- Jev sees the prompt, the names and descriptions of what the first turn used (skills, tools and connectors, memory), and Claude's stated plan. It doesn't see fetched content, such as a work item's text or file contents.
- Jev is called directly as a classifier: `~typesafe/jev-latest` on OpenRouter's `/api/alpha/decisions` endpoint.
- The rubric comes from Anthropic's prompting docs, general and per model, as in the current `scripts/rubric.py`.
- No Claude tokens are spent on grading.
- Build it as a mod (a TypeScript hooks module), replacing the Python hooks.

## How it works

A mod is a plugin whose hooks are a TypeScript module that Claude Code runs itself. It can watch events, call HTTP, read the session's transcript, and draw a pane. The API names below come from Claude Code 2.1.330's mod types.

### Events

| Event | What the mod does |
| --- | --- |
| `session.start` | Opens the panel and resets the session's grading state. |
| `turn.start` | On the main loop's first turn with typed text, records the turn id and the prompt. Skips slash commands and prompts ending in `//raw`, as now. Subagent turns (`agentId` set) are ignored. |
| `turn.step` | Records the model and effort of the first turn's model requests, as sent. |
| `tool.call` | On the first `Edit`, `Write` or `NotebookEdit` in the first turn, starts grading without waiting for it, then calls `next(e)` so the edit runs at once. |
| `turn.complete` | For the first turn, starts grading if no edit started it already. |
| `ui.render` (Pane) | Draws the panel from the session's state. |

The panel's state lives in `$.state`, so each session shows its own grade and a reload keeps it.

### What Jev is sent

One decisions request, built when grading starts:

- `opening_prompt`: the typed text, with `<system-reminder>` blocks removed.
- `claude_model` and `effort`: from the first turn's `turn.step` records.
- `used`: a list of names and descriptions, taken from `$.session.messages()` up to that point:
  - skills loaded, with their descriptions;
  - tools and connector tools called, by name (`mcp__devops__get_work_item`, `Read`, `Grep`), with no arguments or results;
  - memory and instruction files read, with the description line from their frontmatter where there is one.
- `plan`: Claude's text in the first turn up to the grading point, plus the items of its task list (`update_plan` in the desktop app, `TodoWrite` elsewhere). The first version took only the text before the first tool call; the calibration replay showed that was empty in most desktop sessions, where Claude's first call is its task list.
- The desktop app's own session tools (`mcp__ccd_*`) are left out of `used`: they're the app's, not context.

Questions: the overall grade, the general and model-specific checks from the current rubric, and the new checks below.

### New checks

**Proposal.** The current checks are written for the prompt alone. With context, two kinds of question change:

- "Did the first turn look up something the prompt points at?" (a work item, ticket, PR or document). Yes means the prompt delegated its context to that item. The target, reason and done checks are then asked of the prompt and the plan together, not the prompt alone.
- "Did a skill load that matches the task?" Yes means the skill's own instructions supply structure the prompt doesn't need to.
- "Does Claude's plan show an assumption the prompt left open?" This asks of the plan the question the current `outside_context` check asks of the prompt.

The thresholds need setting again on real first turns, not on prompts alone.

### The panel

The panel has three states:

1. Before grading: the first prompt and "Grading after Claude's first edit or the end of this turn".
2. Grading: a short wait, about 0.3 to 0.5 seconds.
3. Graded: the grade, at most three issues, what the first turn used (names only), and the rewrite with `[bracketed]` fill-ins.

**Proposal.** A copy button for the rewrite, and one line of guidance when the grade is poor: stop Claude, then start a new session with the rewrite. For a good grade, the panel says so in one line and shows nothing else.

**Proposal.** A good grade is shown in the panel too, unlike the current notice, because the panel sits there anyway and "the work item carried the context" is useful to learn.

### Settings

Plugin options, as now:

- `openrouter_api_key`, sensitive. The mod passes it to `$.http.fetch` as an auth handle, so Claude Code adds it to the request and the mod's code never holds the key. To confirm: exactly how a sensitive `userConfig` value becomes a handle.
- `mode`: `live` shows the panel, `log` grades and logs without opening the panel, `off` does nothing.

### Log

One line per graded session, as now, with the extra fields: what was used, whether a plan was present, and what triggered grading (edit or end of turn). **Proposal:** keep writing `grades.jsonl` in the plugin's data folder through `$.fs`, so existing log entries and the planned analysis of correction turns carry on.

## What carries over and what goes

Carries over: the rubric and its sources, the Jev request, fill-in rewrites, the log, `//raw`, skipping slash commands, the modes, the key option.

Goes: blocking, the `could be better` transcript notice, the Python script, the `run.sh` launcher, the Git Bash and Python requirements on Windows, the desktop session-file lookup for model and effort, the keychain fallback (**Proposal**: keep `OPENROUTER_API_KEY` from the environment as the only fallback).

## Privacy

More leaves the machine than today. For each graded session OpenRouter and TypeSafe receive the first prompt, the names of skills, tools and memory files used, their descriptions, and Claude's plan text. The plan can mention file names, function names and details from fetched items, because Claude writes it after reading them. Fetched content itself and tool arguments are not sent. The README's privacy note has to say this plainly.

## Cost

Unchanged in kind: one Jev request per session, no Claude tokens. The request is larger. Jev charges about $0.04 per million input tokens, so a request of a few thousand tokens still costs well under a tenth of a cent. Requests over about 32 KB of text run in Jev's slower, less accurate long-context mode, so `used` and `plan` need a size cap. **Proposal:** 8 KB for `plan` and 8 KB for `used`, cut from the end.

## Open questions

- Whether mods load for every user by default or need turning on per machine. This decides how the plugin is shared.
- How the panel looks below 110 columns, where it no longer docks beside the chat.
- Whether a slash command for the panel is needed (for example `/prompt-grader` to reopen it) when it's closed.
- Which Claude Code version mods need, and what users on older versions get. **Proposal:** keep the current hooks plugin available as the fallback for them.
- How to test calibration: the log has first prompts, and transcripts have the first turns. **Proposal:** replay twenty recent first turns through the new request and compare grades by hand before releasing.

## Verification plan

**Proposal.**

- Unit tests with `claude plugin test`: first-turn detection, subagent turns ignored, slash commands and `//raw` skipped, edit trigger versus end-of-turn trigger, the edit not waiting on grading, the request built from a recorded transcript, the panel's three states, and mode handling. Jev stubbed through the `http.fetch` event.
- One live Jev call in a test that's skipped by default, as now.
- A real desktop session for each trigger: one where Claude edits, one where it only reads and answers. Each checked in the panel and in the log.

## Seen working (2026-11-22)

In the desktop Code tab: a session that created a file was graded live at the edit and the panel showed "Opening: Good". A session opening with "make it dark mode" was graded poor; the panel showed three issues, the rewrite with bracketed questions, and a Copy button that copied. The first desktop test opened no panel, because the desktop app hosts Claude Code through the SDK and `session.start` reports `isInteractive: false` there; live mode now goes by `CLAUDE_CODE_ENTRYPOINT`.

## Calibration notes (2026-11-22)

Twenty recent first turns from this machine's transcripts were replayed through the request. Every "make it better" was poor, detailed pasted briefs were good, "add dark mode to the settings page" was could be better. The plan check, first worded as "does the plan commit to a choice the prompt left open", failed on 13 of 20 openings, because any plan makes choices; reworded to ask about consequential choices the user would likely object to, it failed on 4. The skill check is asked only when a skill loaded, after it said yes for a turn with none. Grades vary a little between runs, since `~typesafe/jev-latest` may change and Jev isn't fully deterministic; two of twenty moved one step between replays.
