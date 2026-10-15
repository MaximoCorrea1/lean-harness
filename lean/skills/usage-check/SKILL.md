---
name: usage-check
description: Use when the user asks where the tokens went, why a usage limit was hit, or for the weekly usage review. Three existing tools, cheapest first, and how to read them.
---

# Where the tokens went

Run the cheapest tool that answers the question. All three read the local transcripts under
`~/.claude/projects` and send nothing anywhere.

1. `bunx ccusage@latest daily --since YYYYMMDD` (also `weekly` and `session`). Tokens and list-price
   cost by day. An existing tool with nothing to maintain. Its dates are local, not UTC.
2. Anthropic's `session-report` plugin (marketplace `claude-plugins-official`). An HTML report of
   tokens, cache, subagents, skills and the most expensive prompts.
3. For CAUSES, the probe in the checkout that holds this harness (run `claude plugin marketplace
   list` and take the folder shown for `flowy-harness`; its repository root is the checkout). From
   that root: `bun docs/measurements/instruments-2026-10-11/claude-usage.probe.cjs --days 7`. Prompt
   size per call, the calls that rebuilt the cache and what came before them, lead against agents,
   agents by model, and what re-reading loaded skill text cost. `--from` and `--to` (ISO instants)
   replace `--days` and measure one local day.

Read the result as a shape, never as the plan's own meter (that one is not published):

- Which sessions grew large. A call costs its whole prompt, so the median prompt of a lead call is
  the number to watch. The handoff line (two thirds of the compaction window, as the context line
  and the CLAUDE.md card state it) is the line.
- Which calls rebuilt the cache. A pause over an hour before a large prompt is the dearest call.
- Which agents ran on the lead's model.

Then name ONE change, make it, and measure again in a week. A rule that does not move a number is
not a rule.
