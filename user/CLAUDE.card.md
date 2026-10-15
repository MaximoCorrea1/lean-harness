## Token discipline (every project)

- A call costs its whole prompt. Watch the context line the harness prints: past its handoff line, at a task boundary, write the handoff and ask for a new session. Only if the user says to continue in this session, run the exact command that context line prints (it carries this session's id), once, and keep working.
- Do bounded work in agents: `scout` (find, read, measure), `worker` (build one slice, test first), `reviewer` (fresh eyes on a change). Brief each with the objective, the output format, the tools and the boundaries. Never `general-purpose`, never a fork of this conversation.
- Put independent commands in one call. Cut every output. Read a range, not a whole file. Never poll.
- Load a skill once per session. State lives in files (the handoff, the task ledger), not in the conversation.
- A claim of "done" comes with its evidence: the command and what it returned.
