# The lean harness: keep intelligence high and sessions small, on every project

A Claude Code harness that keeps sessions small and smart: a context line that orders the handoff
before a session gets expensive, Sonnet agents for bounded work, a short task-ledger skill and a
usage check. Built at [Flowy](https://flowy.sh) and measured on real sessions there.

## The one idea

A call costs its whole prompt, and a session re-sends everything on every call. So the lead session
stays small and thinks; bounded work runs in small agent contexts; state lives in files. Mechanisms
enforce this, because the written rule "say so past 300,000 tokens" was measured to change nothing.

## What does what

| Layer | Where | What it does |
|---|---|---|
| Settings (enforce) | `~/.claude/settings.json` | Compact at the window W (500,000 unless you set it: see "The one knob"), capped at the model's own context window (below); agents without a model of their own run on Sonnet; when no status line is set, one that shows context, the 5-hour and the weekly usage (an existing one is kept) |
| Hook (enforce) | plugin `lean` | Past the note line (W / 2) one line tells the model to end at the next task boundary; past the handoff line (W * 2 / 3) it orders the handoff. Below the note line it prints nothing, except a growth note when a prompt added 15,000 tokens or more |
| Agents (do the work) | `~/.claude/agents/` | `scout`, `worker`, `reviewer`: Sonnet, effort and turn limits pinned, a report format that costs the lead little |
| Skills (how) | plugin `lean` | `ledger` (the task discipline in about 800 tokens, against 6,600 for the long form) and `usage-check` |
| Card (pointer) | `~/.claude/CLAUDE.md` | One block: a heading, five bullets and two marker comments, paid on every call of every session, so it stays that size; it holds no token number: it points at the hook's line |
| Measurement | existing tools | `ccusage`, Anthropic's `session-report`, and the probe in `docs/measurements/instruments-2026-10-11/` for causes |

A plugin cannot ship settings (the docs: of a plugin's `settings.json` "Two keys take effect, `agent`
and `subagentStatusLine`, and every other key is dropped"), which is why there are two halves.

The window is capped by the model. Claude Code's docs for `CLAUDE_CODE_AUTO_COMPACT_WINDOW`
(https://code.claude.com/docs/en/env-vars.md): "from `100000` to `1000000`. ... The effective window is
also capped at the model's context window." On a model whose window is 200,000 the built-in
compaction comes first, and the hook (lines at W / 2 and W * 2 / 3) stays silent.

## Install on this machine, for every project

Needs `node` on the PATH of the shell Claude Code uses: the hook and the status line are `node`
commands. `CLAUDE_CONFIG_DIR` is not supported: the installer and the hook use `~/.claude`.

Look first, then apply. What was observed (2026-10-11): the compaction window reaches a session that is
already running; the hook, the card and the agents need a NEW session; the status line: not tested.
Before it changes `settings.json` or `CLAUDE.md` the installer copies the file to
`<file>.lean-backup-<stamp>`, and never over an older backup.

```bash
git clone https://github.com/MaximoCorrea1/lean-harness && cd lean-harness
```

```bash
node install.mjs
```

```bash
node install.mjs --apply
```

```bash
claude plugin marketplace add MaximoCorrea1/lean-harness
```

```bash
claude plugin install lean@flowy-harness
```

Check it: a new session shows the status line; `/context` shows the two skills; a session past
the note line (see the table below) gets the context line. Undo: `node install.mjs --remove --apply`, and
`claude plugin uninstall lean@flowy-harness`. Silence the hook for one session: `LEAN_OFF=1`.

Re-running `--apply` after the harness folder changed updates the agent files this installer wrote
(it records a hash of each). A file you edited, or wrote yourself, is left as it is, and `--remove`
leaves it too. A `## Token discipline` section you wrote in `CLAUDE.md` without the markers is
left as it is and no second block is added.

## Another project on this machine

Nothing to install: the settings, the card, the agents and the plugin are all at USER level, so every
project on this machine has them. Check with `claude plugin list` (`lean@flowy-harness`, Scope: user,
enabled). A session that was already running when the plugin was installed has no hook until it is
restarted.

## Another machine

Copy or clone this folder (or the repository that holds it) there, then run the four install commands above
with that folder's path in place of `E:/Projects VS/skills marketplace/harness`.

## The one knob: the compaction window W

**Why the default is 500,000 and not 300,000 (a decision, 2026-10-11).** The founder, the evening the harness went
in: "i think 300k tokens is too low. i cant get much work done and it already compacts". Measured on that session's
transcript: a window of 300,000 compacts at about 256,000 and restarts at 81,000 to 133,000, so 125,000 to 175,000
tokens of room; and of what the session weighed, output was 44%, cache writes 40% and re-reading the prompt 16%
(`docs/TOKENS.md`, section 12). A fresh reviewer flagged the move as against section 10's "86% over 200,000"; that
number came from sessions at 850,000 with no compaction, which this window still prevents.
Observed the same evening: the window reaches a session that is already running; the hook's files need a restart.

Three numbers follow one: the window W (`CLAUDE_CODE_AUTO_COMPACT_WINDOW`), the note line (W / 2) and
the handoff line (W * 2 / 3), each rounded down to a multiple of 1,000. The card in `CLAUDE.md` points
at the line the hook prints and holds no number. The arithmetic lives in `lean/hooks/lines.mjs`, once. The hook reads W
from its environment, else from `env` in `~/.claude/settings.json`, else 500,000; a missing, empty,
non-numeric or out-of-range (outside 100,000 to 1,000,000, the range Claude Code documents) value falls
to the next source. `LEAN_NOTE_AT` and
`LEAN_HANDOFF_AT` still override their own line.

| W | note line | handoff line |
|---|---|---|
| 300,000 | 150,000 | 200,000 |
| 500,000 (default) | 250,000 | 333,000 |
| 700,000 | 350,000 | 466,000 |

Change it (the window applies to a running session; the new card and hook lines need a NEW one):

```bash
node install.mjs --window 600000 --apply
```

```bash
claude plugin update lean@flowy-harness
```

Without `--window` the installer keeps the valid number already in your settings. NOT verified by the selftest: that Claude Code passes the settings `env` block into a hook's
environment; the hook therefore also reads `settings.json` itself.

## The waiver and the growth note (0.4.0)

**Waiver.** The card orders a handoff at a task boundary past the handoff line, unless the user says
to continue in this session. Then the session records it once, with the exact command the order
line prints (`node "<plugin dir>/hooks/waive.mjs" <session id>`: the id is the one the hook
received, so the waiver always lands on the file the hook reads; run bare, `waive.mjs` falls back
to `CLAUDE_CODE_SESSION_ID`, which may differ, and it prints the id and file it wrote). It writes `~/.claude/lean/sessions/<id>.waive`
(`LEAN_STATE_DIR` moves the folder). With a waiver, past the handoff line the hook prints the
context size, that the user waived the line, and the tokens left before W, instead of the order to
stop. Once less than 12% of W is left, the order returns. The card holds no token number: it points
at the line the harness prints, so the thresholds follow `CLAUDE_CODE_AUTO_COMPACT_WINDOW` in one
place (the arithmetic above); the installer reports the handoff line it derives, nothing is written into the card.

**Growth.** The hook keeps the previous reading per session (`<id>.last`, same folder). When a
prompt arrives with the context 15,000 tokens or more above the previous one, the line ends with
`Grew +Nk tokens since the previous prompt.`, at every level, also below the note line (where it is
the only reason the hook prints). The first prompt of a session, and a smaller reading after a
compaction, show none. Files are never pruned: a few bytes per session.

## Self-test

`node selftest.mjs` runs the hook, the status line and the installer offline against a temp
folder. NOT verified by it: that Claude Code fires the hook and draws the status line. Only a new
session shows that.

## What was reused instead of built

| Need | Reused | Verified how |
|---|---|---|
| Usage by day and session | `ccusage` (`bunx ccusage@latest daily`) | Run here 2026-10-11: same shape as our probe |
| Usage report with skills and subagents | Anthropic's `session-report` plugin | Its skill text read; not yet run here |
| Auto-compaction at a chosen size | Claude Code's own `CLAUDE_CODE_AUTO_COMPACT_WINDOW` | Docs quoted in `docs/TOKENS.md` |
| The resume warning after an idle hour | Claude Code's own dialog | Docs quoted in `docs/TOKENS.md` section 6 |
| Writing new blocking hooks from a rule | Anthropic's `hookify` plugin | README read; not installed |
| Saved working context | gstack `context-save` and `context-restore` | Installed here; not used by the lanes |

Not found ready-made (one search, three collections read): a hook that orders a handoff at a token
threshold. That is the one hook this bundle adds.

## What the people who build these systems say (quotes fetched 2026-10-11)

- Anthropic, on its research system: "a multi-agent system with Claude Opus 4 as the lead agent and
  Claude Sonnet 4 subagents outperformed single-agent Claude Opus 4 by 90.2%", and "multi-agent
  systems use about 15× more tokens than chats". A brief: "Each subagent needs an objective, an
  output format, guidance on the tools and sources to use, and clear task boundaries."
- On long-running work: "Every subsequent session asks the model to make incremental progress, then
  leave structured updates." A session starts with "Read the git logs and progress files to get up
  to speed". Task lists as JSON, because "the model is less likely to inappropriately change or
  overwrite JSON files compared to Markdown files."
- On review: "Separating the agent doing the work from the agent judging it proves to be a strong
  lever". On cost: "The harness was over 20x more expensive", so "It is worth the cost when the
  task sits beyond what the current model does reliably solo."
- On context: "Claude's context window fills up fast, and performance degrades as it fills."
- On pruning a harness: "every component in a harness encodes an assumption about what the model
  can't do on its own, and those assumptions are worth stress testing".

## Not built yet, and why

- A hook that blocks a second load of the same skill. Measured: re-reading loaded skill text was
  2.5% of nine days. Not worth a blocking hook; the rule "once per session" and shorter skills do it.
- A hook that blocks agents on the lead's model. `CLAUDE_CODE_SUBAGENT_MODEL=sonnet` already moves
  every agent without a model of its own. A fork still runs on the lead's model: watch it in the
  weekly check before adding a gate.
- Publishing the plugin beyond this machine (a release is the founder's).
