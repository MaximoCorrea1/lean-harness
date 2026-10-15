// UserPromptSubmit hook of the `lean` plugin.
//
// It reads the session's transcript (the path comes on stdin), finds the size of the last
// main-conversation prompt, and prints ONE line into the model's context when that prompt
// is large. Below the first threshold it prints nothing, unless the context grew by 15,000 tokens
// or more since the previous prompt (then it prints that growth); a quiet prompt costs no tokens.
//
// It never blocks and never fails: any error exits 0 in silence. LEAN_OFF=1 switches it off.
// Thresholds follow ONE knob, the compaction window W, through lines.mjs beside this file:
// note line W / 2, handoff line W * 2 / 3 (W = 300000 gives 150k and 200k). W comes from
// CLAUDE_CODE_AUTO_COMPACT_WINDOW in the environment, else from env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
// in the user's settings.json, else 500000; a missing, empty, non-numeric or absurd (under
// 50000) value falls to the next source. LEAN_NOTE_AT and LEAN_HANDOFF_AT, in tokens, still win
// for their own line.
//
// Since 0.4.0 it keeps two small files per session id (folder: lines.mjs, stateDir): the previous
// reading, so a prompt that grew the context by 15,000 tokens or more says so at every level, and
// a waiver written by waive.mjs, which replaces the order to stop past the handoff line by the
// tokens left before the window (the order returns when under 12% of the window is left).
//
// WHY: a call costs its whole prompt. Nine days measured on 2026-10-11 (docs/TOKENS.md,
// section 10): calls with a prompt over 200,000 tokens were 86% of the spend, and a rule that
// only asked the model to "say so" past 300,000 changed nothing.
//
// Three cases a fresh-context review found (2026-10-11), each held by harness/selftest.mjs:
// right after a compaction the sizes recorded before it are stale, so the scan stops at the
// compaction and says nothing; a record with zero tokens is skipped; when the last 6 MB hold
// no usable record (one very large line), a second, larger read is tried once.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const WINDOWS = [6 * 1024 * 1024, 48 * 1024 * 1024]

function tail(file, size, bytes) {
  const n = Math.min(size, bytes)
  const buf = Buffer.alloc(n)
  const fd = fs.openSync(file, 'r')
  try {
    fs.readSync(fd, buf, 0, n, size - n)
  } finally {
    fs.closeSync(fd)
  }
  return buf.toString('utf8')
}

// Newest record first. Returns { tokens, at } for the last model call of the main conversation,
// { stale: true } when a compaction is newer than any such call, or null when nothing was found.
function scan(text) {
  const lines = text.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (!line.includes('"usage"') && !line.includes('compact_boundary') && !line.includes('isCompactSummary')) continue
    let o
    try {
      o = JSON.parse(line)
    } catch {
      continue
    }
    if (!o || typeof o !== 'object') continue
    if ((o.type === 'system' && o.subtype === 'compact_boundary') || o.isCompactSummary === true) return { stale: true }
    const u = o.message && o.message.usage
    if (!u || o.type !== 'assistant' || o.isSidechain) continue
    const model = String(o.message.model || '')
    if (!model || model.startsWith('<')) continue
    const tokens = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
    if (!(tokens > 0)) continue
    return { tokens, at: Date.parse(o.timestamp || '') }
  }
  return null
}

function lastUsage(file) {
  const size = fs.statSync(file).size
  for (const bytes of WINDOWS) {
    const found = scan(tail(file, size, bytes))
    if (found) return found.stale ? null : found
    if (size <= bytes) break
  }
  return null
}

// o.grew: tokens added since the previous prompt, or 0. o.waived: a waiver file exists for this
// session. o.left: tokens before the compaction window o.window; o.floor: the share of the window
// (a percent) under which a waiver no longer holds. Below the note line the only reason to
// print is growth. The waive command is hinted only when no waiver is recorded: once one is, the
// hint would change nothing.
function lineFor(tokens, idleMin, NOTE_AT, HANDOFF_AT, o = {}) {
  if (!Number.isFinite(tokens)) return ''
  const k = Math.round(tokens / 1000) + 'k'
  const grew = o.grew > 0 ? ' Grew +' + Math.round(o.grew / 1000) + 'k tokens since the previous prompt.' : ''
  if (tokens < NOTE_AT) return grew ? 'Context: ' + k + ' tokens.' + grew : ''
  const cold = Number.isFinite(idleMin) && idleMin > 60 ? ' The cache is cold after ' + Math.round(idleMin) + ' idle minutes: this turn re-writes all of it.' : ''
  if (tokens >= HANDOFF_AT) {
    const order = ' Finish the current step, write the handoff, and tell the user to continue in a NEW session. Do not start a new task in this one.'
    const over = 'Context: ' + k + ' tokens, over the ' + Math.round(HANDOFF_AT / 1000) + 'k line.'
    if (o.waived && o.left * 100 >= o.floor * o.window)
      return 'Context: ' + k + ' tokens. A waiver is recorded for this session: ' + Math.round(o.left / 1000) + 'k tokens left before the ' + Math.round(o.window / 1000) + 'k compaction window.' + grew + cold
    if (o.waived) return over + ' The waiver no longer holds: under ' + o.floor + '% of the window is left.' + grew + cold + order
    return over + grew + cold + order + (o.waiveCmd ? ' Only if the user says to continue in this session, record it once with this exact command: ' + o.waiveCmd : '')
  }
  return 'Context: ' + k + ' tokens.' + grew + cold + ' End this session at the next task boundary: handoff, then a new session.'
}

try {
  if (process.env.LEAN_OFF !== '1') {
    const input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}')
    const p = input && input.transcript_path
    if (p && fs.existsSync(p)) {
      const u = lastUsage(p)
      if (u) {
        // Loaded here, inside the try: if lines.mjs is missing or throws, the catch below
        // runs, so the hook prints nothing and exits 0 (it has no fallback numbers of its own).
        const L = await import('./lines.mjs')
        const derived = L.linesFor(L.resolveWindow(process.env))
        // An explicit line wins only when it is a number over 0; -5, 0 and abc fall through.
        const explicit = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0)
        const noteAt = explicit(process.env.LEAN_NOTE_AT) || derived.note
        const handoffAt = explicit(process.env.LEAN_HANDOFF_AT) || derived.handoff
        // Per-session state (0.4.0): the waiver, and the previous reading for the growth note.
        const windowSize = L.resolveWindow(process.env)
        const id = L.safeId(input.session_id)
        const dir = L.stateDir(process.env)
        let waived = false
        let prev = 0
        if (id) {
          try {
            waived = fs.existsSync(path.join(dir, id + '.waive'))
            prev = Number(JSON.parse(fs.readFileSync(path.join(dir, id + '.last'), 'utf8')).tokens) || 0
          } catch {
            // no previous reading: the first prompt of the session, or an unreadable file
          }
        }
        const grew = prev > 0 && u.tokens - prev >= L.GROWTH_AT ? u.tokens - prev : 0
        const out = lineFor(u.tokens, (Date.now() - u.at) / 60000, noteAt, handoffAt, { grew, waived, left: windowSize - u.tokens, window: windowSize, floor: L.FLOOR_PERCENT, waiveCmd: id ? 'node "' + fileURLToPath(new URL('./waive.mjs', import.meta.url)) + '" ' + id : '' })
        if (out) process.stdout.write(out + '\n')
        if (id) {
          try {
            fs.mkdirSync(dir, { recursive: true })
            fs.writeFileSync(path.join(dir, id + '.last'), JSON.stringify({ tokens: u.tokens }))
          } catch {
            // the next prompt then has no previous reading; nothing else depends on it
          }
        }
      }
    }
  }
} catch {
  // A hook that fails must never cost the user a prompt.
}
process.exit(0)
