// Offline checks of the harness: the hook, the status line and the installer, each run as a
// child process the way Claude Code runs it. No network, nothing outside a temp folder.
//   node harness/selftest.mjs
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(HERE, 'lean', 'hooks', 'context-line.mjs')
const STATUS = path.join(HERE, 'user', 'statusline.mjs')
const INSTALL = path.join(HERE, 'install.mjs')
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-selftest-'))
let failed = 0
const check = (name, ok, detail) => {
  if (!ok) failed++
  console.log((ok ? 'pass  ' : 'FAIL  ') + name + (ok ? '' : '\n      ' + String(detail).slice(0, 400)))
}
// Every child gets an EMPTY home and no window variable of the machine this runs on, so the
// founder's real settings.json is never read; a test that needs one names it (undefined deletes).
const EMPTY_HOME = path.join(TMP, 'nohome')
const run = (file, args, input, env) => {
  const e = { ...process.env }
  for (const k of Object.keys(e)) if (k === 'CLAUDE_CODE_AUTO_COMPACT_WINDOW' || k.startsWith('LEAN_')) delete e[k]
  e.HOME = e.USERPROFILE = EMPTY_HOME
  for (const [k, v] of Object.entries(env || {})) {
    if (v === undefined) delete e[k]
    else e[k] = v
  }
  return spawnSync(process.execPath, [file, ...args], { input: input ?? '', encoding: 'utf8', env: e })
}

const cardSrc = fs.readFileSync(path.join(HERE, 'user', 'CLAUDE.card.md'), 'utf8').trim()
const blockInner = (t) => t.slice(t.indexOf('-->', t.indexOf('<!-- lean:start')) + 3, t.indexOf('<!-- lean:end -->'))

// ---- the hook ---------------------------------------------------------------------------
const rec = (tokens, opts = {}) =>
  JSON.stringify({
    type: 'assistant',
    timestamp: new Date(Date.now() - (opts.minutesAgo || 0) * 60000).toISOString(),
    isSidechain: opts.sidechain || false,
    message: { model: opts.model || 'claude-opus-5-5', usage: { input_tokens: 10, cache_read_input_tokens: tokens - 110, cache_creation_input_tokens: 100, output_tokens: 5 } },
  })
const transcript = (name, lines) => {
  const f = path.join(TMP, name + '.jsonl')
  fs.writeFileSync(f, lines.join('\n') + '\n')
  return f
}
// The older checks below were written for a 300000 window (lines 150k and 200k): they say so.
// Since 0.4.0 the hook keeps the previous reading per session id, so each call gets a FRESH id
// unless a test names one, and the state folder is always a temp one (LEAN_STATE_DIR).
const WAIVE = path.join(HERE, 'lean', 'hooks', 'waive.mjs')
const STATE = path.join(TMP, 'state')
let sidN = 0
const hook = (file, env, sid) => run(HOOK, [], JSON.stringify({ transcript_path: file, session_id: sid || 'fresh-' + ++sidN, hook_event_name: 'UserPromptSubmit', prompt: 'hi' }), { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '300000', LEAN_STATE_DIR: STATE, ...env })

// ---- the one knob: the window W and the two lines derived from it ----------------------------
let L = null
let loadErr = ''
try {
  L = await import(pathToFileURL(path.join(HERE, 'lean', 'hooks', 'lines.mjs')).href)
} catch (e) {
  loadErr = String(e && e.message)
}
const lines = (w) => (L ? L.linesFor(w) : null)
const same = (w, note, handoff) => {
  const x = lines(w)
  return !!x && x.note === note && x.handoff === handoff
}
check('lines: W 300000 is the old 150000 and 200000', same(300000, 150000, 200000), loadErr || JSON.stringify(lines(300000)))
check('lines: W 500000 is 250000 and 333000', same(500000, 250000, 333000), loadErr || JSON.stringify(lines(500000)))
check('lines: W 700000 is 350000 and 466000', same(700000, 350000, 466000), loadErr || JSON.stringify(lines(700000)))
check('lines: both round DOWN to a multiple of 1000', same(123456, 61000, 82000) && same(1000000, 500000, 666000), loadErr || JSON.stringify([lines(123456), lines(1000000)]))
const plugin = JSON.parse(fs.readFileSync(path.join(HERE, 'lean', '.claude-plugin', 'plugin.json'), 'utf8'))
const market = JSON.parse(fs.readFileSync(path.join(HERE, '.claude-plugin', 'marketplace.json'), 'utf8'))
const marketLean = (market.plugins || []).find((p) => p.name === 'lean')
check('plugin: the plugin manifest and the marketplace manifest state the same version, so `claude plugin update` picks a change up', /^\d+\.\d+\.\d+$/.test(plugin.version) && !!marketLean && marketLean.version === plugin.version, plugin.version + ' vs ' + (marketLean && marketLean.version))
check('lines: the window range is the one Claude Code documents, 100000 to 1000000', !!L && L.validWindow(60000) === null && L.validWindow(99999) === null && L.validWindow(100000) === 100000 && L.validWindow(1000000) === 1000000 && L.validWindow(1000001) === null, loadErr || JSON.stringify([60000, 99999, 100000, 1000000, 1000001].map((n) => L && L.validWindow(n))))

let r = hook(transcript('small', [rec(50000)]))
check('hook: 50k prints nothing', r.status === 0 && r.stdout === '', r.stdout + r.stderr)
r = hook(transcript('note', [rec(50000), rec(160000)]))
check('hook: 160k prints the note', r.status === 0 && /Context: 160k tokens\./.test(r.stdout) && /next task boundary/.test(r.stdout) && !/over the/.test(r.stdout), r.stdout + r.stderr)
r = hook(transcript('over', [rec(160000), rec(230000)]))
check('hook: 230k orders the handoff', r.status === 0 && /Context: 230k tokens, over the 200k line/.test(r.stdout) && /NEW session/.test(r.stdout), r.stdout + r.stderr)
r = hook(transcript('side', [rec(120000), rec(400000, { sidechain: true })]))
check('hook: an agent record is not the lead prompt', r.status === 0 && r.stdout === '', r.stdout + r.stderr)
r = hook(transcript('synthetic', [rec(120000), rec(400000, { model: '<synthetic>' })]))
check('hook: a synthetic record is skipped', r.status === 0 && r.stdout === '', r.stdout + r.stderr)
r = hook(transcript('cold', [rec(230000, { minutesAgo: 180 })]))
check('hook: an idle large session is called cold', r.status === 0 && /cold after 180 idle minutes/.test(r.stdout), r.stdout + r.stderr)
r = hook(transcript('off', [rec(230000)]), { LEAN_OFF: '1' })
check('hook: LEAN_OFF=1 silences it', r.status === 0 && r.stdout === '', r.stdout + r.stderr)
r = hook(transcript('custom', [rec(90000)]), { LEAN_NOTE_AT: '80000', LEAN_HANDOFF_AT: '100000' })
check('hook: thresholds come from the environment', r.status === 0 && /Context: 90k tokens\./.test(r.stdout), r.stdout + r.stderr)
r = run(HOOK, [], 'not json')
check('hook: bad stdin exits 0 in silence', r.status === 0 && r.stdout === '' && r.stderr === '', r.stdout + r.stderr)
r = run(HOOK, [], JSON.stringify({ transcript_path: path.join(TMP, 'missing.jsonl') }))
check('hook: a missing transcript exits 0 in silence', r.status === 0 && r.stdout === '', r.stdout + r.stderr)
r = hook(transcript('garbage', ['{"usage" broken', 'plain text', rec(210000)]))
check('hook: broken lines are skipped', r.status === 0 && /over the 200k line/.test(r.stdout), r.stdout + r.stderr)

// ---- the hook follows the window W ------------------------------------------------------------
const W6 = { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '600000' }
r = hook(transcript('w6-small', [rec(290000)]), W6)
check('hook W 600000: 290k is under the 300k note line', r.status === 0 && r.stdout === '', r.stdout + r.stderr)
r = hook(transcript('w6-note', [rec(310000)]), W6)
check('hook W 600000: 310k prints the note, not the handoff order', r.status === 0 && /Context: 310k tokens\./.test(r.stdout) && !/over the/.test(r.stdout) && !/NEW session/.test(r.stdout), r.stdout + r.stderr)
r = hook(transcript('w6-over', [rec(410000)]), W6)
check('hook W 600000: 410k orders the handoff and names 400k', r.status === 0 && /Context: 410k tokens, over the 400k line/.test(r.stdout) && /NEW session/.test(r.stdout), r.stdout + r.stderr)
r = hook(transcript('w6-explicit', [rec(310000)]), { ...W6, LEAN_HANDOFF_AT: '300000' })
check('hook: an explicit LEAN_HANDOFF_AT still wins for its own line', r.status === 0 && /over the 300k line/.test(r.stdout), r.stdout + r.stderr)
r = hook(transcript('w6-explicit-note', [rec(200000)]), { ...W6, LEAN_NOTE_AT: '190000' })
check('hook: an explicit LEAN_NOTE_AT still wins for its own line', r.status === 0 && /Context: 200k tokens\./.test(r.stdout), r.stdout + r.stderr)

const hookHome = path.join(TMP, 'hookhome')
fs.mkdirSync(path.join(hookHome, '.claude'), { recursive: true })
const hookSettings = path.join(hookHome, '.claude', 'settings.json')
const NOENV = { CLAUDE_CODE_AUTO_COMPACT_WINDOW: undefined, HOME: hookHome, USERPROFILE: hookHome }
fs.writeFileSync(hookSettings, JSON.stringify({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '600000' } }))
r = hook(transcript('set-note', [rec(310000)]), NOENV)
check('hook: no env variable, W 600000 read from settings.json: 310k is the note', r.status === 0 && /Context: 310k tokens\./.test(r.stdout) && !/over the/.test(r.stdout), r.stdout + r.stderr)
r = hook(transcript('set-over', [rec(410000)]), NOENV)
check('hook: no env variable, settings.json W 600000: 410k orders the handoff', r.status === 0 && /over the 400k line/.test(r.stdout), r.stdout + r.stderr)
r = hook(transcript('env-beats-set', [rec(310000)]), { ...NOENV, CLAUDE_CODE_AUTO_COMPACT_WINDOW: '300000' })
check('hook: the env variable beats settings.json', r.status === 0 && /over the 200k line/.test(r.stdout), r.stdout + r.stderr)
r = hook(transcript('empty-env', [rec(310000)]), { ...NOENV, CLAUDE_CODE_AUTO_COMPACT_WINDOW: '' })
check('hook: an empty env variable falls through to settings.json', r.status === 0 && /Context: 310k tokens\./.test(r.stdout) && !/over the/.test(r.stdout), r.stdout + r.stderr)
r = hook(transcript('junk-env', [rec(310000)]), { ...NOENV, CLAUDE_CODE_AUTO_COMPACT_WINDOW: 'abc' })
check('hook: a non-numeric env variable falls through to settings.json', r.status === 0 && /Context: 310k tokens\./.test(r.stdout) && !/over the/.test(r.stdout), r.stdout + r.stderr)
r = hook(transcript('absurd-env', [rec(310000)]), { ...NOENV, CLAUDE_CODE_AUTO_COMPACT_WINDOW: '40000' })
check('hook: an absurd env variable (under 100000) falls through to settings.json', r.status === 0 && /Context: 310k tokens\./.test(r.stdout) && !/over the/.test(r.stdout), r.stdout + r.stderr)
fs.writeFileSync(hookSettings, JSON.stringify({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '9000' } }))
r = hook(transcript('absurd-set', [rec(260000)]), NOENV)
check('hook: an absurd settings value falls through to the default 500000 (note at 250k)', r.status === 0 && /Context: 260k tokens\./.test(r.stdout) && !/over the/.test(r.stdout), r.stdout + r.stderr)
fs.writeFileSync(hookSettings, '{ not json')
r = hook(transcript('broken-set', [rec(340000)]), NOENV)
check('hook: a broken settings.json falls to the default; the handoff line is 333k', r.status === 0 && /over the 333k line/.test(r.stdout), r.stdout + r.stderr)
fs.rmSync(hookSettings)
r = hook(transcript('no-set', [rec(240000)]), NOENV)
check('hook: nothing set anywhere, the default 500000: 240k is silent', r.status === 0 && r.stdout === '', r.stdout + r.stderr)

// a window above the ceiling (1,000,000) falls through exactly like one under the floor
fs.writeFileSync(hookSettings, JSON.stringify({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '600000' } }))
r = hook(transcript('huge-env', [rec(410000)]), { ...NOENV, CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1e300' })
check('hook: an env window of 1e300 falls through to settings.json (600000)', r.status === 0 && /over the 400k line/.test(r.stdout), r.stdout + r.stderr)
r = hook(transcript('ceiling-env', [rec(340000)]), { ...NOENV, CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1000000' })
check('hook: the ceiling itself (1000000) is accepted: 340k is under its 500k note line', r.status === 0 && r.stdout === '', r.stdout + r.stderr)
r = hook(transcript('over-ceiling-env', [rec(410000)]), { ...NOENV, CLAUDE_CODE_AUTO_COMPACT_WINDOW: '1000001' })
check('hook: 1000001 falls through to settings.json (600000)', r.status === 0 && /over the 400k line/.test(r.stdout), r.stdout + r.stderr)
fs.writeFileSync(hookSettings, JSON.stringify({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '5000000' } }))
r = hook(transcript('huge-set', [rec(340000)]), NOENV)
check('hook: a settings window of 5000000 gives the default lines (handoff 333k)', r.status === 0 && /over the 333k line/.test(r.stdout), r.stdout + r.stderr)

// an explicit line wins only when it is a number over 0
for (const bad of ['-5', '0', 'abc']) {
  r = hook(transcript('bad-handoff' + bad, [rec(260000)]), { LEAN_HANDOFF_AT: bad })
  check('hook: LEAN_HANDOFF_AT=' + bad + ' falls through to the derived line (200k)', r.status === 0 && /over the 200k line/.test(r.stdout), r.stdout + r.stderr)
  r = hook(transcript('bad-note' + bad, [rec(100000)]), { LEAN_NOTE_AT: bad })
  check('hook: LEAN_NOTE_AT=' + bad + ' falls through to the derived line (150k): 100k is silent', r.status === 0 && r.stdout === '', r.stdout + r.stderr)
}

// shapes of settings.json the hook must read soundly (310k and 410k at W 600000 are note / handoff)
let shapeN = 0
const settingsCase = (name, text, tokens, expect) => {
  fs.writeFileSync(hookSettings, text)
  r = hook(transcript('shape-' + ++shapeN, [rec(tokens)]), NOENV)
  check('hook: settings.json ' + name, r.status === 0 && expect.test(r.stdout), r.stdout + r.stderr)
}
const W6json = JSON.stringify({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '600000' } })
settingsCase('starting with a BOM is read', '﻿' + W6json, 410000, /over the 400k line/)
settingsCase('with the window as a JSON number', JSON.stringify({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: 600000 } }), 410000, /over the 400k line/)
settingsCase('with a float string "450000.7" is 450000 (handoff 300k)', JSON.stringify({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '450000.7' } }), 310000, /over the 300k line/)
for (const [n, v] of [['a string', '"x"'], ['an array', '[]'], ['null', 'null']]) settingsCase('with env as ' + n + ' gives the default (333k)', '{"env":' + v + '}', 340000, /over the 333k line/)
settingsCase('whose whole content is null gives the default (333k)', 'null', 340000, /over the 333k line/)
fs.rmSync(hookSettings)

// ---- 0.4.0: the waiver (W 300000: note 150k, handoff 200k, the 12% floor at 264k) ---------------
const waive = (args, env) => run(WAIVE, args, '', { LEAN_STATE_DIR: STATE, ...env })
const waived = /A waiver is recorded for this session/
const EMPTY_STATE = path.join(TMP, 'state-empty')
r = waive([], { CLAUDE_CODE_SESSION_ID: undefined, LEAN_STATE_DIR: EMPTY_STATE })
check('waive: with no session id it refuses, exit 1, writes nothing', r.status === 1 && /session id/i.test(r.stderr) && !fs.existsSync(EMPTY_STATE), r.stdout + r.stderr)
r = waive(['../evil'], {})
check('waive: an id that is a path is refused, nothing written outside the state folder', r.status === 1 && !fs.existsSync(path.join(TMP, 'evil.waive')), r.stdout + r.stderr)
r = waive([], { CLAUDE_CODE_SESSION_ID: 'sess-env' })
check('waive: the id from CLAUDE_CODE_SESSION_ID is recorded', r.status === 0 && fs.existsSync(path.join(STATE, 'sess-env.waive')), r.stdout + r.stderr)
r = waive(['sess-arg'], { CLAUDE_CODE_SESSION_ID: 'sess-env' })
check('waive: an argument beats the environment', r.status === 0 && fs.existsSync(path.join(STATE, 'sess-arg.waive')), r.stdout + r.stderr)
r = hook(transcript('wv-over', [rec(230000)]), {}, 'sess-env')
check('waiver: past the handoff line it says the user waived it, gives the size and the tokens left, and orders no stop', r.status === 0 && /Context: 230k tokens/.test(r.stdout) && waived.test(r.stdout) && /70k tokens left/.test(r.stdout) && !/NEW session/.test(r.stdout) && !/Do not start a new task/.test(r.stdout), r.stdout + r.stderr)
r = hook(transcript('wv-none', [rec(230000)]), {}, 'sess-other')
check('waiver: another session is not waived, the handoff is ordered', r.status === 0 && /NEW session/.test(r.stdout) && !waived.test(r.stdout), r.stdout + r.stderr)
r = hook(transcript('wv-264', [rec(264000)]), {}, 'sess-env')
check('waiver floor: exactly 12% of the window left (264k of 300k) is still waived', r.status === 0 && waived.test(r.stdout) && /36k tokens left/.test(r.stdout) && !/NEW session/.test(r.stdout), r.stdout + r.stderr)
r = hook(transcript('wv-265', [rec(265000)]), {}, 'sess-env')
check('waiver floor: under 12% left (265k of 300k) orders the handoff despite the waiver', r.status === 0 && /NEW session/.test(r.stdout) && /Context: 265k tokens/.test(r.stdout), r.stdout + r.stderr)
r = hook(transcript('wv-low', [rec(160000)]), {}, 'sess-env')
check('waiver: under the handoff line it changes nothing (the plain note)', r.status === 0 && /next task boundary/.test(r.stdout) && !waived.test(r.stdout), r.stdout + r.stderr)
r = hook(transcript('wv-w6', [rec(410000)]), { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '600000' }, 'sess-env')
check('waiver follows W: at 600000, 410k leaves 190k', r.status === 0 && waived.test(r.stdout) && /190k tokens left/.test(r.stdout), r.stdout + r.stderr)
// review fixes: the line names the window, claims no more than the file says, and a waiver that no longer holds hints nothing
const W825 = { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '825000' }
waive(['sess-825'], {})
r = hook(transcript('wv-825-ok', [rec(560000)]), W825, 'sess-825')
check('waiver line names the window it counts to: 265k tokens left before the 825k compaction window', r.status === 0 && /265k tokens left before the 825k compaction window/.test(r.stdout), r.stdout + r.stderr)
check('waiver line does not claim what the file cannot know: no "The user waived"', !/The user waived/.test(r.stdout), r.stdout)
r = hook(transcript('wv-825-floor', [rec(740000)]), W825, 'sess-825')
check('waiver floor (W 825000, 740k): says the waiver no longer holds and prints NO waive.mjs hint', r.status === 0 && /no longer holds/.test(r.stdout) && /NEW session/.test(r.stdout) && !/waive\.mjs/.test(r.stdout), r.stdout + r.stderr)
r = hook(transcript('wv-825-none', [rec(560000)]), W825, 'sess-825-unwaived')
check('no waiver (W 825000, 560k): the order still carries the exact waive command with this session id', r.status === 0 && /NEW session/.test(r.stdout) && /waive\.mjs" sess-825-unwaived/.test(r.stdout), r.stdout + r.stderr)
r = waive(['sess-print'], {})
check('waive: prints the session id it recorded and the file it wrote', r.status === 0 && /session sess-print/.test(r.stdout) && r.stdout.includes(path.join(STATE, 'sess-print.waive')), r.stdout + r.stderr)

// ---- 0.4.0: growth since the previous prompt (15,000 tokens) -------------------------------------
r = hook(transcript('gr-first', [rec(230000)]), {}, 'gr-a')
check('growth: a first prompt has no previous reading and shows no growth', r.status === 0 && /over the 200k line/.test(r.stdout) && !/Grew/.test(r.stdout), r.stdout + r.stderr)
r = hook(transcript('gr-b1', [rec(40000)]), {}, 'gr-b')
const g1 = r.stdout
r = hook(transcript('gr-b2', [rec(54999)]), {}, 'gr-b')
check('growth: 14,999 tokens since the previous prompt prints nothing', g1 === '' && r.status === 0 && r.stdout === '', g1 + '|' + r.stdout + r.stderr)
r = hook(transcript('gr-b3', [rec(69999)]), {}, 'gr-b')
check('growth: exactly 15,000 prints a line even below the note line', r.status === 0 && /Context: 70k tokens\./.test(r.stdout) && /Grew \+15k tokens since the previous prompt/.test(r.stdout), r.stdout + r.stderr)
r = hook(transcript('gr-b4', [rec(70000)]), {}, 'gr-b')
check('growth: the line is for the step just taken, not repeated (+1 prints nothing)', r.status === 0 && r.stdout === '', r.stdout + r.stderr)
hook(transcript('gr-c1', [rec(140000)]), {}, 'gr-c')
r = hook(transcript('gr-c2', [rec(170000)]), {}, 'gr-c')
check('growth: appended to the note line', r.status === 0 && /next task boundary/.test(r.stdout) && /Grew \+30k tokens since the previous prompt/.test(r.stdout), r.stdout + r.stderr)
hook(transcript('gr-d1', [rec(180000)]), {}, 'gr-d')
r = hook(transcript('gr-d2', [rec(230000)]), {}, 'gr-d')
check('growth: appended to the handoff order', r.status === 0 && /NEW session/.test(r.stdout) && /Grew \+50k tokens/.test(r.stdout), r.stdout + r.stderr)
waive([], { CLAUDE_CODE_SESSION_ID: 'gr-e' })
hook(transcript('gr-e1', [rec(190000)]), {}, 'gr-e')
r = hook(transcript('gr-e2', [rec(215000)]), {}, 'gr-e')
check('growth: appended to the waived line', r.status === 0 && waived.test(r.stdout) && /Grew \+25k tokens/.test(r.stdout), r.stdout + r.stderr)
hook(transcript('gr-f1', [rec(200000)]), {}, 'gr-f')
r = hook(transcript('gr-f2', [rec(100000)]), {}, 'gr-f')
check('growth: a smaller reading (after a compaction) shows no growth', r.status === 0 && !/Grew/.test(r.stdout), r.stdout + r.stderr)
r = run(HOOK, [], JSON.stringify({ transcript_path: transcript('gr-noid', [rec(230000)]) }), { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '300000', LEAN_STATE_DIR: STATE })
check('hook: no session id in the input still prints the order and writes no state', r.status === 0 && /NEW session/.test(r.stdout), r.stdout + r.stderr)
r = hook(transcript('gr-bad', [rec(230000)]), {}, '../escape')
check('hook: a session id that is a path never reaches the disk outside the state folder', r.status === 0 && /NEW session/.test(r.stdout) && !fs.existsSync(path.join(TMP, 'escape.last')), r.stdout + r.stderr)

// ---- 0.4.0: the card and the skills say it, with no fixed number ------------------------------------
const cardText = fs.readFileSync(path.join(HERE, 'user', 'CLAUDE.card.md'), 'utf8')
const ledgerText = fs.readFileSync(path.join(HERE, 'lean', 'skills', 'ledger', 'SKILL.md'), 'utf8')
check('card: carries no fixed token number and no placeholder', !/\d{2,3},\d{3}|\d{3,}k\b|\{\{/.test(cardText), cardText)
check('card: points at the printed line, hands off at a task boundary unless the user says to continue', /line the harness prints|context line/i.test(cardText) && /task boundary/.test(cardText) && /says to continue/i.test(cardText), cardText)
check('ledger skill: says in a sentence that a continue order is recorded with waive.mjs', /waive\.mjs/.test(ledgerText) && /continue/i.test(ledgerText), 'no waive.mjs in the ledger skill')
for (const [name, t] of [['card', cardText], ['ledger skill', ledgerText]])
  check(name + ': says to run the exact command the context line prints, only after the user says to continue, and names no bare plugin-dir path', /exact command/.test(t) && /context line/i.test(t) && /says to continue/i.test(t) && !/<(lean )?plugin dir>|<this plugin>/.test(t), t.slice(0, 600))
check('hook header and README: below the note line the hook prints only the growth note, not "nothing"', !/Below the first threshold it prints nothing, so/.test(fs.readFileSync(HOOK, 'utf8')) && /prints nothing, unless the context grew by 15,000/.test(fs.readFileSync(HOOK, 'utf8')) && !/Below that it prints nothing \|/.test(fs.readFileSync(path.join(HERE, 'README.md'), 'utf8')) && /except a growth note/.test(fs.readFileSync(path.join(HERE, 'README.md'), 'utf8')), 'stale "prints nothing" claim')
check('install.mjs: no dead {{HANDOFF_AT}} replace and no stale "handoff number on the card" comment', !/HANDOFF_AT/.test(fs.readFileSync(INSTALL, 'utf8')) && !/handoff number on the card/.test(fs.readFileSync(INSTALL, 'utf8')), 'stale text in install.mjs')
check('version: 0.4.0 in both manifests', plugin.version === '0.4.0' && marketLean && marketLean.version === '0.4.0', plugin.version + ' ' + (marketLean && marketLean.version))

// ---- the status line --------------------------------------------------------------------
r = run(STATUS, [], JSON.stringify({ model: { display_name: 'Opus 5.5' }, context_window: { used_percentage: 31.2, context_window_size: 1000000 }, rate_limits: { five_hour: { used_percentage: 12 }, seven_day: { used_percentage: 64.4 } } }))
check('status line: all fields', r.status === 0 && r.stdout === 'Opus 5.5 | ctx 312k (31%) | 5h 12% | week 64%', r.stdout + r.stderr)
r = run(STATUS, [], JSON.stringify({ context_window: { used_percentage: 5 } }))
check('status line: no limits, no size', r.status === 0 && r.stdout === 'ctx (5%)', r.stdout + r.stderr)
r = run(STATUS, [], '')
check('status line: empty stdin prints nothing', r.status === 0 && r.stdout === '', r.stdout + r.stderr)

// ---- the installer ----------------------------------------------------------------------
const home = path.join(TMP, 'home')
const claude = path.join(home, '.claude')
fs.mkdirSync(claude, { recursive: true })
const settingsFile = path.join(claude, 'settings.json')
fs.writeFileSync(settingsFile, JSON.stringify({ theme: 'dark', enabledPlugins: { 'a@b': true }, env: { KEEP: '1' } }, null, 2))
const inst = (...args) => run(INSTALL, ['--home', home, ...args])
const readSettings = () => JSON.parse(fs.readFileSync(settingsFile, 'utf8'))

r = inst()
check('install: the dry run writes nothing', r.status === 0 && /DRY RUN/.test(r.stdout) && !fs.existsSync(path.join(claude, 'agents')) && readSettings().statusLine === undefined, r.stdout + r.stderr)
r = inst('--apply')
let s = readSettings()
check('install: sets the two variables (window default 500000) and keeps the rest', r.status === 0 && s.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW === '500000' && s.env.CLAUDE_CODE_SUBAGENT_MODEL === 'sonnet' && s.env.KEEP === '1' && s.theme === 'dark' && s.enabledPlugins['a@b'] === true, r.stdout + JSON.stringify(s))
check('install: sets a status line that points at the copied script', s.statusLine && s.statusLine.type === 'command' && s.statusLine.command.includes('/.claude/lean/statusline.mjs') && fs.existsSync(path.join(claude, 'lean', 'statusline.mjs')), JSON.stringify(s.statusLine))
check('install: writes the three agents', ['scout', 'worker', 'reviewer'].every((a) => fs.existsSync(path.join(claude, 'agents', a + '.md'))), fs.readdirSync(claude).join(','))
let md = fs.readFileSync(path.join(claude, 'CLAUDE.md'), 'utf8')
check('install: adds one marked block to CLAUDE.md', md.split('lean:start').length === 2 && /Token discipline/.test(md), md.slice(0, 200))
check('install: backs the settings file up', fs.readdirSync(claude).some((f) => f.startsWith('settings.json.lean-backup-')), fs.readdirSync(claude).join(','))
const backups = () => fs.readdirSync(claude).filter((f) => f.startsWith('settings.json.lean-backup-')).length
const nBackups = backups()
r = inst('--apply')
md = fs.readFileSync(path.join(claude, 'CLAUDE.md'), 'utf8')
check('install: a second run changes nothing', r.status === 0 && /nothing to change/.test(r.stdout) && md.split('lean:start').length === 2 && backups() === nBackups, r.stdout)
fs.writeFileSync(path.join(claude, 'CLAUDE.md'), '# mine\n\nkeep this\n\n' + md)
fs.writeFileSync(path.join(claude, 'agents', 'scout.md'), 'my own scout\n')
r = inst('--apply', '--window', '250000')
s = readSettings()
check('install: --window changes the number; a changed agent is kept', r.status === 0 && s.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW === '250000' && fs.readFileSync(path.join(claude, 'agents', 'scout.md'), 'utf8') === 'my own scout\n' && /left as it is/.test(r.stdout), r.stdout)
r = inst('--remove', '--apply')
s = readSettings()
md = fs.readFileSync(path.join(claude, 'CLAUDE.md'), 'utf8')
check('remove: takes out what it added and nothing else', r.status === 0 && s.env.KEEP === '1' && s.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW === undefined && s.env.CLAUDE_CODE_SUBAGENT_MODEL === undefined && s.statusLine === undefined && s.theme === 'dark' && !/lean:start/.test(md) && /keep this/.test(md) && fs.existsSync(path.join(claude, 'agents', 'scout.md')) && !fs.existsSync(path.join(claude, 'agents', 'worker.md')), r.stdout + JSON.stringify(s) + md)
fs.writeFileSync(settingsFile, '{ not json')
r = inst('--apply')
check('install: a broken settings file stops it', r.status === 1 && /not valid JSON/.test(r.stderr) && fs.readFileSync(settingsFile, 'utf8') === '{ not json', r.stdout + r.stderr)
fs.writeFileSync(settingsFile, JSON.stringify({ statusLine: { type: 'command', command: 'mine' }, env: { CLAUDE_CODE_SUBAGENT_MODEL: 'haiku' } }))
r = inst('--apply')
s = readSettings()
check('install: an existing status line and agent model are kept', r.status === 0 && s.statusLine.command === 'mine' && s.env.CLAUDE_CODE_SUBAGENT_MODEL === 'haiku', JSON.stringify(s))

// ---- what a fresh-context review broke on 2026-10-11 ---------------------------------------
const boundary = JSON.stringify({ type: 'system', subtype: 'compact_boundary', timestamp: new Date().toISOString(), compactMetadata: { preTokens: 665000 } })
const summary = JSON.stringify({ type: 'user', isCompactSummary: true, message: { role: 'user', content: 'summary' } })
r = hook(transcript('compacted', [rec(665000), boundary, summary]))
check('hook: silent right after a compaction', r.status === 0 && r.stdout === '', r.stdout + r.stderr)
r = hook(transcript('after-compact', [rec(665000), boundary, summary, rec(170000)]))
check('hook: the first call after a compaction counts', r.status === 0 && /Context: 170k tokens\./.test(r.stdout), r.stdout + r.stderr)
const zero = JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), message: { model: 'claude-opus-5-5', usage: { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 } } })
r = hook(transcript('zero', [rec(300000), zero]))
check('hook: a zero record does not hide the real one', r.status === 0 && /Context: 300k tokens/.test(r.stdout), r.stdout + r.stderr)
const huge = JSON.stringify({ type: 'user', message: { role: 'user', content: 'x'.repeat(7 * 1024 * 1024) } })
r = hook(transcript('hugeline', [rec(210000), huge]))
check('hook: a 7 MB line after the record is read past', r.status === 0 && /over the 200k line/.test(r.stdout), r.stdout.slice(0, 200) + r.stderr)

const home2 = path.join(TMP, 'home2')
const claude2 = path.join(home2, '.claude')
fs.mkdirSync(claude2, { recursive: true })
const settings2 = path.join(claude2, 'settings.json')
const md2 = path.join(claude2, 'CLAUDE.md')
const inst2 = (...args) => run(INSTALL, ['--home', home2, ...args])
const read2 = () => JSON.parse(fs.readFileSync(settings2, 'utf8'))
fs.writeFileSync(settings2, JSON.stringify({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '450000', CLAUDE_CODE_SUBAGENT_MODEL: 'sonnet' } }))
r = inst2('--apply')
// Since 0.4.0 the card holds no number: the installer reports the handoff line it derives from W.
check("install: the user's own window is kept, and the handoff line derived from it is 300,000", r.status === 0 && read2().env.CLAUDE_CODE_AUTO_COMPACT_WINDOW === '450000' && /handoff line 300,000 tokens/.test(r.stdout), r.stdout + r.stderr)
r = inst2('--remove', '--apply')
let s2 = read2()
check("remove: the user's own values survive", r.status === 0 && s2.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW === '450000' && s2.env.CLAUDE_CODE_SUBAGENT_MODEL === 'sonnet' && s2.statusLine === undefined, r.stdout + JSON.stringify(s2))
inst2('--apply', '--window', '250000')
const mid = read2().env.CLAUDE_CODE_AUTO_COMPACT_WINDOW
r = inst2('--remove', '--apply')
s2 = read2()
check('remove: a named --window goes back to the old value', mid === '250000' && s2.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW === '450000' && s2.env.CLAUDE_CODE_SUBAGENT_MODEL === 'sonnet', mid + ' ' + JSON.stringify(s2) + r.stdout)
check('remove: nothing of ours is left behind', !fs.existsSync(path.join(claude2, 'lean', 'install-state.json')) && !fs.existsSync(path.join(claude2, 'agents', 'worker.md')) && !fs.existsSync(md2), fs.readdirSync(claude2).join(','))

const before2 = fs.readFileSync(settings2, 'utf8')
fs.writeFileSync(md2, 'top\n<!-- lean:start x -->\nUSER TEXT AFTER\n')
r = inst2('--apply')
check('install: a start marker with no end stops it, nothing written', r.status === 1 && /markers/.test(r.stderr) && fs.readFileSync(md2, 'utf8') === 'top\n<!-- lean:start x -->\nUSER TEXT AFTER\n' && fs.readFileSync(settings2, 'utf8') === before2, r.stdout + r.stderr)
fs.writeFileSync(md2, '<!-- lean:end -->\nmid\n<!-- lean:start x -->\n')
r = inst2('--apply')
check('install: markers out of order stop it', r.status === 1 && /markers/.test(r.stderr), r.stdout + r.stderr)
fs.writeFileSync(md2, '# mine\r\n\r\nkeep\r\n')
r = inst2('--apply')
const crlf = fs.readFileSync(md2, 'utf8')
check('install: a CRLF file keeps CRLF', r.status === 0 && /lean:start/.test(crlf) && !/[^\r]\n/.test(crlf), JSON.stringify(crlf.slice(0, 120)))
check('install: in a CRLF file the block is the card byte for byte with CRLF line ends, framed by one CRLF each side', blockInner(crlf) === '\r\n' + cardSrc.replace(/\r?\n/g, '\r\n') + '\r\n', JSON.stringify(blockInner(crlf)).slice(0, 300))
inst2('--remove', '--apply')
check('remove: the text around the block survives', /# mine/.test(fs.readFileSync(md2, 'utf8')) && !/lean:start/.test(fs.readFileSync(md2, 'utf8')), fs.readFileSync(md2, 'utf8'))
fs.rmSync(md2)

fs.writeFileSync(settings2, '{"env":"x"}')
r = inst2('--apply')
check('install: an env that is not an object stops it', r.status === 1 && fs.readFileSync(settings2, 'utf8') === '{"env":"x"}', r.stdout + r.stderr)
fs.writeFileSync(settings2, 'null')
r = inst2('--apply')
check('install: a settings file that is not an object stops it', r.status === 1 && fs.readFileSync(settings2, 'utf8') === 'null', r.stdout + r.stderr)
fs.writeFileSync(settings2, '﻿{\r\n  "theme": "dark"\r\n}\r\n')
r = inst2('--apply')
check('install: a settings file with a BOM and CRLF is read, and its keys survive the write', r.status === 0 && read2().theme === 'dark' && read2().env.CLAUDE_CODE_SUBAGENT_MODEL === 'sonnet', r.stdout + r.stderr)
r = run(INSTALL, ['--home', '--apply'])
check('install: --home without a value stops it', r.status === 1 && !fs.existsSync(path.join(process.cwd(), '--apply')), r.stdout + r.stderr)
r = inst2('--window', '50000')
check('install: a window under 100000 is refused', r.status === 1 && /100000/.test(r.stderr), r.stdout + r.stderr)
r = inst2('--frobnicate')
check('install: an unknown argument stops it', r.status === 1, r.stdout + r.stderr)
fs.writeFileSync(path.join(claude2, 'agents', 'scout.md'), 'mine\n')
r = inst2('--apply', '--force')
const agentFiles = fs.readdirSync(path.join(claude2, 'agents'))
check('install: --force keeps a backup of the agent it replaces', r.status === 0 && agentFiles.some((f) => f.startsWith('scout.md.lean-backup-')) && fs.readFileSync(path.join(claude2, 'agents', 'scout.md'), 'utf8') !== 'mine\n', agentFiles.join(',') + r.stdout)

// ---- the installer follows the window W (a temporary home, never the real one) ------------------
const home3 = path.join(TMP, 'home3')
const claude3 = path.join(home3, '.claude')
fs.mkdirSync(claude3, { recursive: true })
const settings3 = path.join(claude3, 'settings.json')
const md3 = path.join(claude3, 'CLAUDE.md')
const inst3 = (...args) => run(INSTALL, ['--home', home3, ...args])
const read3 = () => JSON.parse(fs.readFileSync(settings3, 'utf8'))
const orig3 = JSON.stringify({ theme: 'dark', env: { KEEP: '1' } }, null, 2) + '\n'
const origMd3 = '# mine\n\nkeep this\n'
fs.writeFileSync(settings3, orig3)
fs.writeFileSync(md3, origMd3)
r = inst3('--window', '600000')
check('install W 600000: the dry run shows the env change and a card that says 400,000', r.status === 0 && /DRY RUN/.test(r.stdout) && /CLAUDE_CODE_AUTO_COMPACT_WINDOW.*600000/.test(r.stdout) && /400,000/.test(r.stdout) && fs.readFileSync(settings3, 'utf8') === orig3 && fs.readFileSync(md3, 'utf8') === origMd3, r.stdout + r.stderr)
r = inst3('--window', '600000', '--apply')
md = fs.readFileSync(md3, 'utf8')
check('install W 600000: apply writes the window and the card (handoff line 400,000 reported, no placeholder)', r.status === 0 && read3().env.CLAUDE_CODE_AUTO_COMPACT_WINDOW === '600000' && /handoff line 400,000 tokens/.test(r.stdout) && !/\{\{/.test(md) && /lean:start/.test(md) && md.startsWith(origMd3), r.stdout + md)
// The block the installer WRITES must be user/CLAUDE.card.md itself, byte for byte. Framing the installer
// adds, stated here: one newline between the start marker and the card, and one before the end marker.
check('install: the block written into CLAUDE.md is user/CLAUDE.card.md byte for byte (LF), framed by one newline each side', blockInner(md) === '\n' + cardSrc.replace(/\r\n/g, '\n') + '\n', JSON.stringify(blockInner(md)).slice(0, 300))
r = inst3('--apply')
check('install: a second run with NO --window keeps 600000 and changes nothing', r.status === 0 && /nothing to change/.test(r.stdout) && read3().env.CLAUDE_CODE_AUTO_COMPACT_WINDOW === '600000' && fs.readFileSync(md3, 'utf8') === md, r.stdout + r.stderr)
r = inst3('--window', '300000', '--apply')
const md300 = fs.readFileSync(md3, 'utf8')
check('install: a new window changes the setting (300000); still one block, no number in it, text outside untouched', r.status === 0 && read3().env.CLAUDE_CODE_AUTO_COMPACT_WINDOW === '300000' && !/\d{2,3},\d{3}/.test(md300) && md300.split('lean:start').length === 2 && md300.startsWith(origMd3), r.stdout + md300)
r = inst3('--remove', '--apply')
check('remove (window): the temporary home is restored byte for byte', r.status === 0 && fs.readFileSync(settings3, 'utf8') === orig3 && fs.readFileSync(md3, 'utf8') === origMd3, r.stdout + fs.readFileSync(settings3, 'utf8'))
r = inst3('--apply')
check('install: with no window set anywhere, the default 500000 and a 333,000 handoff line', r.status === 0 && read3().env.CLAUDE_CODE_AUTO_COMPACT_WINDOW === '500000' && /handoff line 333,000 tokens/.test(r.stdout), r.stdout + r.stderr)
inst3('--remove', '--apply')
fs.writeFileSync(settings3, JSON.stringify({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: 'abc' } }))
r = inst3('--apply')
check('install: a junk window in settings is left alone; the handoff line follows the default (333,000)', r.status === 0 && read3().env.CLAUDE_CODE_AUTO_COMPACT_WINDOW === 'abc' && /handoff line 333,000 tokens/.test(r.stdout), r.stdout + r.stderr)

// the card and the hook read the SAME settings file and must name the same number
const home4 = path.join(TMP, 'home4')
fs.mkdirSync(path.join(home4, '.claude'), { recursive: true })
fs.writeFileSync(path.join(home4, '.claude', 'settings.json'), JSON.stringify({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '555555' } }))
r = run(INSTALL, ['--home', home4, '--apply'])
const cardN = Number((/handoff line ([\d,]+) tokens/.exec(r.stdout) || [])[1]?.replace(/,/g, ''))
r = hook(transcript('tie', [rec(380000)]), { CLAUDE_CODE_AUTO_COMPACT_WINDOW: undefined, HOME: home4, USERPROFILE: home4 })
const hookN = Number((/over the (\d+)k line/.exec(r.stdout) || [])[1]) * 1000
check('card and hook: the same settings file gives the same handoff number (370000)', cardN === hookN && cardN === 370000, 'card ' + cardN + ' hook ' + hookN + ' ' + r.stdout)

r = hook(transcript('under-floor-env', [rec(410000)]), { ...NOENV, CLAUDE_CODE_AUTO_COMPACT_WINDOW: '60000' })
check('hook: an env window of 60000 (under the documented 100000) falls through to the default (410k is over 333k)', r.status === 0 && /over the 333k line/.test(r.stdout), r.stdout + r.stderr)

// ---- 0.3.0: the agents upgrade, the backups never overwrite, the card is found without markers ----
// The agent source must change between two runs, so these use a COPY of the harness folder.
const copy = path.join(TMP, 'harness-copy')
fs.cpSync(HERE, copy, { recursive: true })
const copySrc = (name) => path.join(copy, 'user', 'agents', name)
const origSrc = {}
for (const n of ['scout.md', 'worker.md', 'reviewer.md']) origSrc[n] = fs.readFileSync(copySrc(n), 'utf8')
const home5 = path.join(TMP, 'home5')
const claude5 = path.join(home5, '.claude')
fs.mkdirSync(claude5, { recursive: true })
const inst5 = (...args) => run(path.join(copy, 'install.mjs'), ['--home', home5, ...args])
const agent5 = (n) => path.join(claude5, 'agents', n)
const text5 = (n) => (fs.existsSync(agent5(n)) ? fs.readFileSync(agent5(n), 'utf8') : null)
inst5('--apply')
fs.writeFileSync(copySrc('scout.md'), origSrc['scout.md'] + '\nA new line in the source.\n')
r = inst5('--apply')
check('agents: a file the installer wrote is updated when the source changed', r.status === 0 && text5('scout.md') === origSrc['scout.md'] + '\nA new line in the source.\n' && !/exists and differs/.test(r.stdout), r.stdout + r.stderr)
r = inst5('--remove', '--apply')
check('agents: --remove deletes an upgraded file the installer wrote', r.status === 0 && text5('scout.md') === null && text5('worker.md') === null && text5('reviewer.md') === null, r.stdout + fs.readdirSync(path.join(claude5, 'agents')).join(','))

// the owner edits an installed file, then the source changes: the edit is theirs
fs.rmSync(claude5, { recursive: true, force: true })
fs.mkdirSync(claude5, { recursive: true })
for (const n of Object.keys(origSrc)) fs.writeFileSync(copySrc(n), origSrc[n])
inst5('--apply')
fs.writeFileSync(agent5('worker.md'), origSrc['worker.md'] + '\nMY EDIT\n')
fs.writeFileSync(copySrc('worker.md'), origSrc['worker.md'] + '\nA new line in the source.\n')
fs.writeFileSync(copySrc('reviewer.md'), origSrc['reviewer.md'] + '\nA new line in the source.\n')
r = inst5('--apply')
check('agents: an installed file the owner edited is left, with a line saying so; an untouched one is updated', r.status === 0 && text5('worker.md') === origSrc['worker.md'] + '\nMY EDIT\n' && /worker\.md/.test(r.stdout) && /left as it is/.test(r.stdout) && text5('reviewer.md') === origSrc['reviewer.md'] + '\nA new line in the source.\n', r.stdout + r.stderr)
r = inst5('--remove', '--apply')
check('agents: --remove leaves the owner-edited file and deletes the untouched ones', r.status === 0 && text5('worker.md') === origSrc['worker.md'] + '\nMY EDIT\n' && text5('scout.md') === null && text5('reviewer.md') === null, r.stdout + r.stderr)

// a record written by 0.2.0 holds names only
fs.rmSync(claude5, { recursive: true, force: true })
fs.mkdirSync(path.join(claude5, 'agents'), { recursive: true })
fs.mkdirSync(path.join(claude5, 'lean'), { recursive: true })
for (const n of Object.keys(origSrc)) fs.writeFileSync(copySrc(n), origSrc[n])
fs.writeFileSync(agent5('scout.md'), origSrc['scout.md'])
fs.writeFileSync(agent5('worker.md'), 'worker the owner changed under 0.2.0\n')
fs.writeFileSync(path.join(claude5, 'lean', 'install-state.json'), JSON.stringify({ env: {}, statusLine: false, agents: ['scout.md', 'worker.md'], card: false }))
r = inst5('--apply', '--no-statusline')
check('agents: a 0.2.0 record: a file equal to the source stays ours, any other is left with a line', r.status === 0 && text5('scout.md') === origSrc['scout.md'] && text5('worker.md') === 'worker the owner changed under 0.2.0\n' && /worker\.md/.test(r.stdout) && /left as it is/.test(r.stdout), r.stdout + r.stderr)
fs.writeFileSync(copySrc('scout.md'), origSrc['scout.md'] + '\nA new line in the source.\n')
r = inst5('--apply', '--no-statusline')
check('agents: a file migrated from a 0.2.0 record is then updated like any other', r.status === 0 && text5('scout.md') === origSrc['scout.md'] + '\nA new line in the source.\n' && text5('worker.md') === 'worker the owner changed under 0.2.0\n', r.stdout + r.stderr)
r = inst5('--remove', '--apply')
check('agents: --remove after a 0.2.0 migration deletes ours and leaves the owner file', r.status === 0 && text5('scout.md') === null && text5('worker.md') === 'worker the owner changed under 0.2.0\n', r.stdout + r.stderr)

// a checkout with autocrlf makes the SOURCE CRLF while the installed copy is LF: still ours
const toCrlf = (t) => t.replace(/\r?\n/g, '\r\n')
fs.rmSync(claude5, { recursive: true, force: true })
fs.mkdirSync(path.join(claude5, 'agents'), { recursive: true })
fs.mkdirSync(path.join(claude5, 'lean'), { recursive: true })
for (const n of Object.keys(origSrc)) {
  fs.writeFileSync(copySrc(n), toCrlf(origSrc[n]))
  fs.writeFileSync(agent5(n), origSrc[n])
}
fs.writeFileSync(path.join(claude5, 'lean', 'install-state.json'), JSON.stringify({ env: {}, statusLine: false, agents: ['scout.md', 'worker.md', 'reviewer.md'], card: false }))
r = inst5('--apply', '--no-statusline')
check('agents: a 0.2.0 record, source CRLF, installed file LF: the file is ours, not "edited"', r.status === 0 && !/edited since|changed since|differs/.test(r.stdout) && text5('scout.md') === origSrc['scout.md'], r.stdout + r.stderr)
fs.writeFileSync(copySrc('scout.md'), toCrlf(origSrc['scout.md'] + '\nA new line in the source.\n'))
r = inst5('--apply', '--no-statusline')
check('agents: a file migrated across line endings is then updated', r.status === 0 && text5('scout.md').replace(/\r\n/g, '\n') === origSrc['scout.md'] + '\nA new line in the source.\n', r.stdout + r.stderr)
r = inst5('--remove', '--apply')
check('agents: --remove deletes files ours across line endings', r.status === 0 && Object.keys(origSrc).every((n) => text5(n) === null), r.stdout + r.stderr)
// a hash recorded today still matches after a checkout flips the source's line endings
fs.rmSync(claude5, { recursive: true, force: true })
fs.mkdirSync(claude5, { recursive: true })
for (const n of Object.keys(origSrc)) fs.writeFileSync(copySrc(n), origSrc[n])
inst5('--apply', '--no-statusline')
for (const n of Object.keys(origSrc)) fs.writeFileSync(copySrc(n), toCrlf(origSrc[n]))
r = inst5('--apply', '--no-statusline')
check('agents: a recorded hash survives the source flipping to CRLF (nothing to change)', r.status === 0 && /nothing to change/.test(r.stdout), r.stdout + r.stderr)
fs.writeFileSync(copySrc('worker.md'), toCrlf(origSrc['worker.md'] + '\nFirst change.\n'))
inst5('--apply', '--no-statusline')
fs.writeFileSync(copySrc('worker.md'), toCrlf(origSrc['worker.md'] + '\nSecond change.\n'))
r = inst5('--apply', '--no-statusline')
check('agents: two source changes in a row: the second --apply updates the file again', r.status === 0 && text5('worker.md').replace(/\r\n/g, '\n') === origSrc['worker.md'] + '\nSecond change.\n' && /update /.test(r.stdout) && !/edited since/.test(r.stdout), r.stdout + r.stderr)
inst5('--remove', '--apply')
for (const n of Object.keys(origSrc)) fs.writeFileSync(copySrc(n), origSrc[n])

// backups: an install and a remove inside one second must keep the ORIGINAL
const home6 = path.join(TMP, 'home6')
const claude6 = path.join(home6, '.claude')
fs.mkdirSync(claude6, { recursive: true })
const origSettings6 = JSON.stringify({ theme: 'light', env: { KEEP: 'original' } }, null, 2) + '\n'
const origMd6 = '# my rules\n\nkeep this\n'
fs.writeFileSync(path.join(claude6, 'settings.json'), origSettings6)
fs.writeFileSync(path.join(claude6, 'CLAUDE.md'), origMd6)
const inst6 = (...args) => run(INSTALL, ['--home', home6, ...args])
const files6 = (prefix) => fs.readdirSync(claude6).filter((f) => f.startsWith(prefix))
const contents6 = (prefix) => files6(prefix).map((f) => fs.readFileSync(path.join(claude6, f), 'utf8'))
inst6('--apply')
inst6('--remove', '--apply')
inst6('--apply')
inst6('--remove', '--apply')
check('backup: four quick runs leave four settings backups, and the original is one of them', files6('settings.json.lean-backup-').length === 4 && contents6('settings.json.lean-backup-').includes(origSettings6), files6('settings.json.lean-backup-').join(',') + ' ' + contents6('settings.json.lean-backup-').length)
check('backup: CLAUDE.md is backed up before each write that changes it, the original is kept', files6('CLAUDE.md.lean-backup-').length === 4 && contents6('CLAUDE.md.lean-backup-').includes(origMd6), files6('CLAUDE.md.lean-backup-').join(','))
const home7 = path.join(TMP, 'home7')
fs.mkdirSync(path.join(home7, '.claude'), { recursive: true })
r = run(INSTALL, ['--home', home7, '--apply'])
check('backup: a CLAUDE.md that did not exist has nothing to back up (and the run exits 0)', r.status === 0 && !fs.readdirSync(path.join(home7, '.claude')).some((f) => f.startsWith('CLAUDE.md.lean-backup-')), fs.readdirSync(path.join(home7, '.claude')).join(','))

// a window outside the range already in the settings: the line says it is ignored, not only "yours"
const home9 = path.join(TMP, 'home9')
fs.mkdirSync(path.join(home9, '.claude'), { recursive: true })
fs.writeFileSync(path.join(home9, '.claude', 'settings.json'), JSON.stringify({ env: { CLAUDE_CODE_AUTO_COMPACT_WINDOW: '80000' } }))
r = run(INSTALL, ['--home', home9, '--apply'])
check('install: a window of 80000 in the settings is reported as outside 100000 to 1000000 and ignored by the hook', r.status === 0 && /80000/.test(r.stdout) && /100000 to 1000000/.test(r.stdout) && /ignored by the hook/.test(r.stdout), r.stdout + r.stderr)

// a card the owner wrote by hand, with no markers
const home8 = path.join(TMP, 'home8')
const md8 = path.join(home8, '.claude', 'CLAUDE.md')
fs.mkdirSync(path.join(home8, '.claude'), { recursive: true })
const hand8 = '# mine\n\n## Token discipline (every project)\n\n- my own rule\n'
fs.writeFileSync(md8, hand8)
r = run(INSTALL, ['--home', home8, '--apply'])
check('card: a hand-written "Token discipline" section without markers gets no second copy, and one line says so', r.status === 0 && fs.readFileSync(md8, 'utf8') === hand8 && /without markers/.test(r.stdout) && r.stdout.split('\n').filter((l) => /without markers/.test(l)).length === 1, r.stdout + fs.readFileSync(md8, 'utf8'))
r = run(INSTALL, ['--home', home8, '--remove', '--apply'])
check('card: --remove leaves a hand-written section alone', r.status === 0 && fs.readFileSync(md8, 'utf8') === hand8, r.stdout + fs.readFileSync(md8, 'utf8'))

// no fixed claim of a line left in the text a user reads
const tail = (f) => fs.readFileSync(path.join(HERE, f), 'utf8')
check('docs: the card and the skills state no fixed 200,000 line', !/200,000/.test(tail('user/CLAUDE.card.md')) && !/200,000/.test(tail('lean/skills/usage-check/SKILL.md')), 'card or skill still says 200,000')

fs.rmSync(TMP, { recursive: true, force: true })
console.log(failed ? '\n' + failed + ' check(s) FAILED' : '\nall checks passed')
process.exit(failed ? 1 : 0)
