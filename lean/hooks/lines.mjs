// The one knob of the lean harness: the compaction window W (CLAUDE_CODE_AUTO_COMPACT_WINDOW).
// The note line and the handoff line are DERIVED from it, here and nowhere else. The hook and
// the installer both import this file; harness/selftest.mjs holds the arithmetic.
//
//   note line    = W / 2      "end at the next task boundary"
//   handoff line = W * 2 / 3  "write the handoff, continue in a NEW session"
//   each rounded DOWN to a multiple of 1,000. W = 300000 gives 150000 and 200000.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const KEY_WINDOW = 'CLAUDE_CODE_AUTO_COMPACT_WINDOW'
export const DEFAULT_WINDOW = 500000
// The range is Claude Code's own. Docs, https://code.claude.com/docs/en/env-vars.md (fetched 2026-10-12):
// "Set the auto-compact window in tokens, from `100000` to `1000000`. ... The effective window is
// also capped at the model's context window." A value outside it is not one Claude Code honours.
export const MIN_WINDOW = 100000
export const MAX_WINDOW = 1000000

export function linesFor(w) {
  return { note: Math.floor(w / 2000) * 1000, handoff: Math.floor((w * 2) / 3000) * 1000 }
}

// A window as a number, or null when the value is missing, empty, not a number or absurd
// (under MIN_WINDOW or over MAX_WINDOW).
export function validWindow(v) {
  if (v === undefined || v === null || String(v).trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) && n >= MIN_WINDOW && n <= MAX_WINDOW ? Math.floor(n) : null
}

// The settings directory: the installer's rule, used by the hook too. `home` defaults to yours.
export function claudeDir(home) {
  return path.join(path.resolve(home || os.homedir()), '.claude')
}

// `dir` is optional: the default is worked out INSIDE the try, so a throwing os.homedir() gives null.
export function settingsWindow(dir) {
  try {
    const text = fs.readFileSync(path.join(dir ?? claudeDir(), 'settings.json'), 'utf8').replace(/^\uFEFF/, '')
    const s = JSON.parse(text)
    return validWindow(s && s.env && s.env[KEY_WINDOW])
  } catch {
    return null
  }
}

// ---- per-session state (0.4.0): the waiver and the previous reading --------------------------------
// One small file per session id in `<claude dir>/lean/sessions/`, the folder beside the installer's
// own `<claude dir>/lean/`. LEAN_STATE_DIR moves it (the self-test points it at a temp folder).
export const GROWTH_AT = 15000 // tokens added since the previous prompt that are worth a mention
export const FLOOR_PERCENT = 12 // a waiver never holds when less than this percent of W is left

// A session id that is safe to use as a file name, or null (a path, an empty value, a long one).
export function safeId(v) {
  const s = String(v ?? '').trim()
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(s) ? s : null
}

export function stateDir(env, dir) {
  const own = env && env.LEAN_STATE_DIR
  return own ? path.resolve(own) : path.join(dir ?? claudeDir(), 'lean', 'sessions')
}

// W from the environment, else the user's settings.json, else the default.
export function resolveWindow(env, dir) {
  return validWindow(env[KEY_WINDOW]) ?? settingsWindow(dir) ?? DEFAULT_WINDOW
}
