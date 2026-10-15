// Records that the user waived the handoff line for ONE session. The hook (context-line.mjs) then
// prints the context size and the tokens left before the compaction window, in place of the order
// to stop, and orders the handoff again once less than 12% of the window is left.
//
//   node waive.mjs [session-id]      the id defaults to CLAUDE_CODE_SESSION_ID
//
// The file is `<claude dir>/lean/sessions/<id>.waive` (LEAN_STATE_DIR moves the folder).
// Exits 1 and writes nothing when there is no usable id. Never touches anything but that file.
import fs from 'node:fs'
import path from 'node:path'
import { safeId, stateDir } from './lines.mjs'

try {
  const given = process.argv[2] ?? process.env.CLAUDE_CODE_SESSION_ID
  const id = safeId(given)
  if (!id) {
    console.error('waive: no usable session id. Give one as the argument, or set CLAUDE_CODE_SESSION_ID. Nothing was written.')
    process.exit(1)
  }
  const dir = stateDir(process.env)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, id + '.waive')
  fs.writeFileSync(file, new Date().toISOString() + '\n')
  console.log('waived the handoff line for session ' + id + ' (' + file + '). The hook now shows the tokens left before the compaction window, and orders a handoff again under 12% of it.')
} catch (e) {
  console.error('waive: ' + String(e && e.message))
  process.exit(1)
}
