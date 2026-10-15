---
name: ledger
description: Use ONLY when the project's own instructions (its CLAUDE.md) name a task ledger or session files. The short form of that discipline - capture every ask before acting, keep one table, print it at four moments, re-probe before ranking. A project that names none: do not use it.
---

# Ledger: capture, then continue

Applies only when this project's CLAUDE.md names a task ledger. Otherwise keep the list of asks in
the reply and create no files.

A task said once and not written down is lost. The ledger is where work survives a compaction, a
break and a new session.

## Rule zero: an order, with a procedure

1. BEFORE acting on a message, list every distinct thing in it that has an outcome. A message joined
   by "and", "also", a list or a parenthesis holds several. The last item and the one in brackets
   are the two that vanish.
2. Write one row per item NOW, before the first tool call that serves any of them.
3. Then start work.
4. Print the open table in that same reply.

A task is anything with an outcome: an ask, a question you owe an answer to, a number you said you
would measure, something you found that nobody asked about, a decision that is not yours (a `[?]`
row addressed to its owner), a correction to your own earlier work. One outcome, one row: when a
task turns out to be three, it becomes three rows the moment you see that.

You may not send a reply while an uncaptured task from this turn exists.

## The files

| file | holds |
|---|---|
| the task ledger, `docs/SESSION-TODO-<date>-<lane>.md` | a `## TASKS` table FIRST: number, task, state, owner, note |
| the context file, `docs/SESSION-CONTEXT-<date>-<lane>.md` | what was asked, each number with its probe, beliefs overturned, instruments that lied |
| the index that outlives sessions, `docs/OPEN-WORK.md` | what survives, by pointer |

States: `[ ]` open, `[~]` in progress, `[x]` done and verified, `[?]` its owner decides, `[!]` blocked.
The names above are one project's; the project's own CLAUDE.md wins on names and paths. Create the pair before the first
substantive tool call and print both paths in the first reply.

## Print the table at four moments, and only these

The first reply of a session. When a task closes (the whole open table, never just "done"). When a
new task appears. When the user asks about status. Name every task in words: a bare row number is
not a task, and a count is not a list.

## Four rules that keep the ledger true

- Re-probe before you rank. A handoff records what its author believed. List the file, grep the
  caller, read the output before planning around an inherited row.
- Point, never copy. One fact, one home.
- A number carries its probe, its population, its unit and its period.
- When a premise expires, rewrite the row to keep what survives. Never delete it.

## End of a cycle

Fold what survives into the index, write the handoff (state, first moves, traps, what waits on the
user), and stop. The next session starts from the handoff, not from this conversation. Only if the user
says to continue in this session past the harness's handoff line, run once the exact command the context line prints (it carries the session id, and its waive.mjs path) and keep working.

The long form, with the dated cases behind each rule, is the `maintaining-project-docs` skill. Load
it only to settle a dispute about a rule.
