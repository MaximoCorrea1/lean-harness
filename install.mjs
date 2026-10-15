// Installs the USER-SCOPE half of the lean harness: the part a plugin cannot ship.
//
//   node harness/install.mjs                   shows what it would change, writes nothing
//   node harness/install.mjs --apply           writes it (settings.json and CLAUDE.md are each backed up
//                                              first, to <file>.lean-backup-<stamp>, never over an older one)
//   node harness/install.mjs --remove --apply  undoes what an earlier --apply did
//
// Options: --home <dir> (default: your home), --window <tokens> (100000 to 1000000), --no-statusline,
//          --force (replace values and agent files that are yours).
//
// THE ONE KNOB is the compaction window W. --window sets it; without --window the valid number
// already in your settings is kept, and with none the default is 500000. The hook's two lines
// (note W / 2, handoff W * 2 / 3) are derived from W (harness/lean/hooks/lines.mjs); the card holds
// no number, so it never changes with W. Change W later: --window <N> --apply, then the plugin update.
//
// What it sets, for EVERY project on this machine:
//   ~/.claude/settings.json   env.CLAUDE_CODE_AUTO_COMPACT_WINDOW   (compact at that size)
//                             env.CLAUDE_CODE_SUBAGENT_MODEL=sonnet  (agents with no model of their own)
//                             statusLine (only when none is set)
//   ~/.claude/agents/         scout.md, worker.md, reviewer.md. Written when absent; a file this script
//                             wrote is updated when the source changes (its content hash is recorded);
//                             a file you edited or wrote is left, unless --force
//   ~/.claude/CLAUDE.md       one marked block of five lines (the card, copied as it is). A "Token
//                             discipline" section you wrote without the markers is left as it is
//   ~/.claude/lean/           statusline.mjs (only when the status line is ours), install-state.json
//
// It reads everything and checks it BEFORE the first write: a settings file that is not a JSON
// object, an `env` that is not an object or damaged block markers stop it with nothing written.
// A value you set yourself is left alone unless you pass --force or name it (--window).
// install-state.json records what was there before, so --remove puts it back and touches
// nothing you changed since. It never touches enabledPlugins, permissions or hooks.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// The window W and the two lines derived from it live in ONE file, shared with the hook.
import { DEFAULT_WINDOW, KEY_WINDOW, MAX_WINDOW, MIN_WINDOW, claudeDir, linesFor, validWindow } from './lean/hooks/lines.mjs'

const stop = (msg) => {
  console.error('STOP: ' + msg + ' Nothing was changed.')
  process.exit(1)
}
const FLAGS = new Set(['--apply', '--remove', '--force', '--no-statusline'])
const VALUED = new Set(['--home', '--window'])
const opt = {}
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (FLAGS.has(a)) opt[a] = true
  else if (VALUED.has(a)) {
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) stop(a + ' needs a value.')
    opt[a] = v
    i++
  } else stop('unknown argument ' + a + '.')
}
const APPLY = !!opt['--apply']
const REMOVE = !!opt['--remove']
const FORCE = !!opt['--force']
const NO_STATUS = !!opt['--no-statusline']
const WINDOW_NAMED = opt['--window'] !== undefined
const windowNum = Number(opt['--window'])
if (WINDOW_NAMED && (!Number.isInteger(windowNum) || windowNum < MIN_WINDOW || windowNum > MAX_WINDOW)) stop('--window takes a whole number of tokens from ' + MIN_WINDOW + ' to ' + MAX_WINDOW + '.')
const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(HERE, 'user')
const CLAUDE = claudeDir(opt['--home'])
const SETTINGS = path.join(CLAUDE, 'settings.json')
const CARD_FILE = path.join(CLAUDE, 'CLAUDE.md')
const LEAN_DIR = path.join(CLAUDE, 'lean')
const AGENTS_DIR = path.join(CLAUDE, 'agents')
const STATE_FILE = path.join(LEAN_DIR, 'install-state.json')
const STATUS_TARGET = path.join(LEAN_DIR, 'statusline.mjs')
// Forward slashes work in Git Bash and in PowerShell alike.
const STATUS_COMMAND = 'node "' + STATUS_TARGET.split(path.sep).join('/') + '"'
const START_KEY = '<!-- lean:start'
const START = START_KEY + ' (written by harness/install.mjs; edit the source, not this block) -->'
const END = '<!-- lean:end -->'
const AGENTS = ['scout.md', 'worker.md', 'reviewer.md']
const KEY_MODEL = 'CLAUDE_CODE_SUBAGENT_MODEL'

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)
const plan = []
const ops = []
const say = (s) => plan.push(s)
const doWrite = (f, text) =>
  ops.push(() => {
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.writeFileSync(f, text)
  })
const doRemove = (f) => ops.push(() => fs.rmSync(f, { force: true }))
// A backup never overwrites one: the copy is exclusive, and a taken name gets a counter.
const doBackup = (f) =>
  ops.push(() => {
    for (let n = 0; ; n++) {
      try {
        return fs.copyFileSync(f, f + '.lean-backup-' + stamp() + (n ? '-' + n : ''), fs.constants.COPYFILE_EXCL)
      } catch (e) {
        if (e.code !== 'EEXIST') throw e
      }
    }
  })
// Line endings are not content: a checkout with autocrlf turns the SOURCE into CRLF while the
// installed copy stays LF. Every comparison and every hash of an agent file goes through norm().
const norm = (text) => text.replace(/\r\n/g, '\n')
const sha = (text) => crypto.createHash('sha256').update(norm(text)).digest('hex')
const readText = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null)

// ---- read and check everything first ---------------------------------------------------
let settings = {}
const settingsText = readText(SETTINGS)
if (settingsText !== null && settingsText.replace(/^﻿/, '').trim()) {
  try {
    settings = JSON.parse(settingsText.replace(/^﻿/, ''))
  } catch (e) {
    stop(SETTINGS + ' is not valid JSON (' + e.message + ').')
  }
}
if (!isObj(settings)) stop(SETTINGS + ' does not hold a JSON object.')
if (settings.env !== undefined && !isObj(settings.env)) stop('"env" in ' + SETTINGS + ' is not an object.')
if (settings.statusLine !== undefined && !isObj(settings.statusLine)) stop('"statusLine" in ' + SETTINGS + ' is not an object.')

// state.agents maps a file name to the sha256 of the content this script last wrote there.
// A record written by 0.2.0 is a list of names: each becomes a name with a null hash (written by
// us, content not recorded).
let state = { env: {}, statusLine: false, agents: {}, card: false }
const stateText = readText(STATE_FILE)
if (stateText !== null) {
  try {
    const s = JSON.parse(stateText)
    if (isObj(s)) {
      const agents = {}
      if (Array.isArray(s.agents)) for (const n of s.agents) agents[n] = null
      else if (isObj(s.agents)) for (const [n, h] of Object.entries(s.agents)) agents[n] = typeof h === 'string' ? h : null
      state = { env: isObj(s.env) ? s.env : {}, statusLine: s.statusLine === true, agents, card: s.card === true }
    }
  } catch (e) {
    stop(STATE_FILE + ' is not valid JSON.')
  }
}
const stateBefore = JSON.stringify(state)

const curMd = readText(CARD_FILE) ?? ''
const count = (text, mark) => text.split(mark).length - 1
const nStart = count(curMd, START_KEY)
const nEnd = count(curMd, END)
const a = curMd.indexOf(START_KEY)
const b = curMd.indexOf(END)
const blockPresent = nStart === 1 && nEnd === 1 && a < b
if (!blockPresent && (nStart !== 0 || nEnd !== 0)) stop('the lean block markers in ' + CARD_FILE + ' are damaged (' + nStart + ' start, ' + nEnd + ' end, or out of order). Repair the file by hand.')

// ---- settings --------------------------------------------------------------------------
const settingsBefore = JSON.stringify(settings)
const env = { ...(settings.env || {}) }
// W: the one number the whole harness follows. Named with --window, else the valid number
// already in the settings (a value you set is never reset), else the default.
const WINDOW = String(WINDOW_NAMED ? windowNum : (validWindow(env[KEY_WINDOW]) ?? DEFAULT_WINDOW))
function setEnv(key, want, named) {
  const cur = env[key]
  if (cur === want) return
  const ours = state.env[key] !== undefined && state.env[key].set === cur
  if (cur !== undefined && !ours && !FORCE && !named) {
    const outside = key === KEY_WINDOW && validWindow(cur) === null
    say('settings: env.' + key + ' is already "' + cur + '" (yours): left as it is' + (outside ? '; it is outside ' + MIN_WINDOW + ' to ' + MAX_WINDOW + ' and is ignored by the hook, which uses ' + DEFAULT_WINDOW : '') + '. --force sets ' + want)
    return
  }
  say('settings: env.' + key + ' ' + (cur === undefined ? '(unset)' : '"' + cur + '"') + ' -> ' + want)
  state.env[key] = { before: ours ? state.env[key].before : cur === undefined ? null : cur, set: want }
  env[key] = want
}
function unsetEnv(key) {
  const rec = state.env[key]
  if (rec === undefined) return
  if (env[key] !== rec.set) say('settings: env.' + key + ' was changed since the install: left as it is')
  else if (rec.before === null) {
    say('settings: remove env.' + key)
    delete env[key]
  } else {
    say('settings: env.' + key + ' back to "' + rec.before + '"')
    env[key] = rec.before
  }
  delete state.env[key]
}
if (REMOVE) {
  if (stateText === null) say('no install record (' + STATE_FILE + '): the settings are left as they are')
  unsetEnv(KEY_WINDOW)
  unsetEnv(KEY_MODEL)
  if (state.statusLine) {
    if (settings.statusLine && settings.statusLine.command === STATUS_COMMAND) {
      say('settings: remove the status line this script set')
      delete settings.statusLine
    }
    state.statusLine = false
  }
} else {
  setEnv(KEY_WINDOW, WINDOW, WINDOW_NAMED)
  setEnv(KEY_MODEL, 'sonnet', false)
  if (!NO_STATUS) {
    if (settings.statusLine === undefined) {
      say('settings: statusLine (unset) -> ' + STATUS_COMMAND)
      settings.statusLine = { type: 'command', command: STATUS_COMMAND }
      state.statusLine = true
    } else if (settings.statusLine.command !== STATUS_COMMAND) say('settings: a status line is already set (yours): left as it is')
  }
}
if (Object.keys(env).length) settings.env = env
else delete settings.env
if (JSON.stringify(settings) !== settingsBefore) {
  if (settingsText !== null) doBackup(SETTINGS)
  doWrite(SETTINGS, JSON.stringify(settings, null, 2) + '\n')
}

// ---- the status line script: only when the status line is ours ---------------------------
const statusSrc = fs.readFileSync(path.join(SRC, 'statusline.mjs'), 'utf8')
const statusCur = readText(STATUS_TARGET)
const statusOurs = isObj(settings.statusLine) && settings.statusLine.command === STATUS_COMMAND
if (statusOurs && statusCur !== statusSrc) {
  say((statusCur === null ? 'write ' : 'update ') + STATUS_TARGET)
  doWrite(STATUS_TARGET, statusSrc)
} else if (!statusOurs && statusCur === statusSrc && REMOVE) {
  say('remove ' + STATUS_TARGET)
  doRemove(STATUS_TARGET)
}

// ---- the agents ----------------------------------------------------------------------
for (const name of AGENTS) {
  const target = path.join(AGENTS_DIR, name)
  const src = fs.readFileSync(path.join(SRC, 'agents', name), 'utf8')
  const cur = readText(target)
  const recorded = Object.hasOwn(state.agents, name) // we wrote this file at some point
  // OURS: the content is what the source says now, or what we recorded writing (a 0.2.0 record has no hash).
  const same = cur !== null && norm(cur) === norm(src)
  const ours = cur !== null && (same || (typeof state.agents[name] === 'string' && sha(cur) === state.agents[name]))
  if (REMOVE) {
    if (!recorded) continue
    if (cur === null) {
      // already gone
    } else if (ours) {
      say('remove ' + target)
      doRemove(target)
    } else say(target + ' was changed since the install (yours): left as it is')
    delete state.agents[name]
    continue
  }
  if (same) {
    if (recorded && state.agents[name] !== sha(src)) {
      say(target + ' already matches the source: recorded so that a later source change updates it')
      state.agents[name] = sha(src)
    }
    continue
  }
  if (cur === null) {
    say('write ' + target)
    doWrite(target, src)
    state.agents[name] = sha(src)
  } else if (recorded && ours) {
    say('update ' + target + ' (the source changed; the file is the one this script wrote)')
    doWrite(target, src)
    state.agents[name] = sha(src)
  } else if (FORCE) {
    say('replace ' + target + ' (--force; the old file is kept beside it as a backup)')
    doBackup(target)
    doWrite(target, src)
    state.agents[name] = sha(src)
  } else say(target + ' ' + (recorded ? 'was edited since the install' : 'exists and differs') + ' (yours): left as it is. --force replaces it and keeps a backup')
}

// ---- the block in the user CLAUDE.md -----------------------------------------------------
const eol = curMd.includes('\r\n') ? '\r\n' : '\n'
// The card holds no number: it is copied as it is, only its line endings follow the file's.
// handoffLine is for the message below: the line the hook will print for this W (a settings
// value that is not a usable number leaves the default in force).
const handoffLine = linesFor(validWindow(env[KEY_WINDOW]) ?? DEFAULT_WINDOW).handoff
const card = fs.readFileSync(path.join(SRC, 'CLAUDE.card.md'), 'utf8').trim().split(/\r?\n/).join(eol)
const block = START + eol + card + eol + END
let nextMd = curMd
// A "Token discipline" heading the owner wrote OUTSIDE the markers: a card without markers.
const outsideBlock = blockPresent ? curMd.slice(0, a) + curMd.slice(b + END.length) : curMd
const handCard = !blockPresent && /^#{1,6}[ \t]+Token discipline\b/im.test(outsideBlock)
if (REMOVE) {
  if (blockPresent) nextMd = (curMd.slice(0, a).replace(/(\r?\n)+$/, eol) + curMd.slice(b + END.length).replace(/^(\r?\n)+/, '')).replace(/^\s+$/, '')
  state.card = false
} else if (handCard) {
  say(CARD_FILE + ' already has a "Token discipline" section without markers: left as it is, no block added')
  state.card = false
} else {
  nextMd = blockPresent ? curMd.slice(0, a) + block + curMd.slice(b + END.length) : (curMd.trim() ? curMd.replace(/(\r?\n)*$/, eol + eol) : '') + block + eol
  state.card = true
}
if (nextMd !== curMd) {
  say((REMOVE ? 'remove the lean block from ' : blockPresent ? 'update the lean block in ' : 'add the lean block to ') + CARD_FILE + (REMOVE ? '' : ' (handoff line ' + handoffLine.toLocaleString('en-US') + ' tokens)'))
  if (curMd !== '') doBackup(CARD_FILE)
  if (nextMd === '') doRemove(CARD_FILE)
  else doWrite(CARD_FILE, nextMd)
}

// ---- the install record, then the writes ---------------------------------------------------
const stateEmpty = !Object.keys(state.env).length && !state.statusLine && !Object.keys(state.agents).length && !state.card
if (stateEmpty) {
  if (stateText !== null) doRemove(STATE_FILE)
} else if (JSON.stringify(state) !== stateBefore || stateText === null) doWrite(STATE_FILE, JSON.stringify(state, null, 2) + '\n')

if (APPLY) for (const op of ops) op()
console.log((APPLY ? 'APPLIED' : 'DRY RUN (nothing written; add --apply)') + ' for ' + CLAUDE)
console.log(plan.length ? plan.map((s) => '  ' + s).join('\n') : '  nothing to change')
if (!REMOVE) console.log('The compaction window reaches a running session; the card, the agents and the hook need a NEW one. The plugin half (the context line, two skills) is installed separately: see harness/README.md.')
