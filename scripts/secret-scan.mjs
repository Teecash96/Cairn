import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)

// These patterns identify credential-shaped values without echoing their
// contents. Public Nimiq receiving addresses are intentionally not matched.
const patterns = [
  /AIza[0-9A-Za-z_-]{20,}/,
  /sk-ant-[0-9A-Za-z_-]{20,}/,
  /(?:^|[^A-Za-z0-9])sk-[0-9A-Za-z_-]{20,}/,
  /(?:^|[^A-Za-z0-9])(?:ghp|github_pat|xox[abprs])_[0-9A-Za-z-]{20,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /(?:API_KEY|SECRET|TOKEN)\s*[:=]\s*["'](?!replace-with|your-|example|change-me|changeme)[^"']{20,}["']/i,
]

let currentHits = 0
for (const path of tracked) {
  try {
    const text = readFileSync(path, 'utf8')
    if (patterns.some((pattern) => pattern.test(text))) currentHits += 1
  } catch {
    // Binary files and files removed between git ls-files and this read are not
    // credential sources for the purposes of this check.
  }
}

const historyHits = patterns.reduce((count, pattern) => {
  try {
    const result = execFileSync('git', ['log', '--all', '--format=%H', '-G', pattern.source], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return count + (result.trim() ? 1 : 0)
  } catch {
    return count
  }
}, 0)

if (currentHits || historyHits) {
  console.error(`Credential-shaped content found in ${currentHits} tracked file(s) and ${historyHits} history pattern(s).`)
  process.exitCode = 1
} else {
  console.log('No credential-shaped values found in tracked files or Git history.')
}
