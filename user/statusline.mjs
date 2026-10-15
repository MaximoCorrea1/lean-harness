// Status line: the model, the context in use, and the plan's two usage windows.
// Example:  Opus 5.5 | ctx 310k (31%) | 5h 12% | week 64%
// It reads the JSON Claude Code passes on stdin and prints one line. Any field that is missing
// is left out; an error prints nothing. Display only: it changes nothing.
import fs from 'node:fs'

let j = {}
try {
  j = JSON.parse(fs.readFileSync(0, 'utf8') || '{}') || {}
} catch {
  j = {}
}
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const pct = (v) => (num(v) === null ? null : Math.round(v) + '%')

const parts = []
const model = j.model && (j.model.display_name || j.model.id)
if (model) parts.push(String(model))

const cw = j.context_window || {}
const used = num(cw.used_percentage)
const size = num(cw.context_window_size)
if (used !== null) {
  const tokens = size !== null ? Math.round((used * size) / 100 / 1000) + 'k ' : ''
  parts.push('ctx ' + tokens + '(' + Math.round(used) + '%)')
}

const rl = j.rate_limits || {}
const fiveHour = pct(rl.five_hour && rl.five_hour.used_percentage)
const week = pct(rl.seven_day && rl.seven_day.used_percentage)
if (fiveHour) parts.push('5h ' + fiveHour)
if (week) parts.push('week ' + week)

process.stdout.write(parts.join(' | '))
