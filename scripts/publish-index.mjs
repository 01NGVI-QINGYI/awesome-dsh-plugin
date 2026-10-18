/**
 * Publish `index.json` to npm as the `dsh-plugin-catalog-index` package.
 *
 * Same reason as the catalog itself (scripts/publish-catalog.mjs): the
 * canonical copy is served by GitHub Pages, which is GitHub, and from
 * mainland China it is slow enough that a 3 MB document does not arrive
 * inside the host's fetch timeout. Measured 2026-10-18: 3.1 MB in 22.7 s
 * (≈140 KB/s) from a mainland connection, against dsh 0.2.1's fixed
 * `fetchTimeoutMs` of 15 s — the Discover dialog reports "The operation was
 * aborted due to timeout" and the source never loads. Published to npm, the
 * same file is served by jsDelivr with a direct 200 (no redirect — the host
 * fetches with `redirect: "error"`), at CDN speed.
 *
 * Its own package rather than a file inside `dsh-plugin-catalog`: that
 * package is the market's fallback for EVERY user in China, and the index is
 * read only by someone browsing Discover. Attaching it would add 3 MB to
 * every consumer's daily catalog download for a file most never request.
 *
 * Everything is assembled in a temp directory, so this writes nothing into
 * the repository and the invariant at the top of build-site.yml holds
 * literally rather than approximately.
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PKG = 'dsh-plugin-catalog-index'
const BUILT = 'docs/index.json'
const REGISTRY = 'https://registry.npmjs.org'

/** Content hash, so an unchanged index does not earn a version of its own. */
function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/**
 * The hash carried by the newest published version, or null.
 *
 * Read from the packument rather than by downloading the tarball: the field
 * is a few bytes of metadata, and this runs on every build.
 */
async function publishedHash() {
  try {
    const res = await fetch(`${REGISTRY}/${PKG}/latest`)
    if (!res.ok) return null
    const meta = await res.json()
    return typeof meta.indexSha === 'string' ? meta.indexSha : null
  } catch {
    // A registry that cannot be reached has not said the index is unchanged.
    // Publishing a duplicate version is a smaller mistake than silently
    // skipping a real update, and npm refuses duplicates anyway.
    return null
  }
}

/**
 * A date-based version, monotonic and legible. Same shape as the catalog's.
 *
 * `YYYY.MDD.RUN` — the run number distinguishes several publishes in one
 * day, and the date part sorts correctly within and across years (105 for
 * Jan 5 is below 1231 for Dec 31). The month is not zero-padded because
 * semver forbids leading zeroes in numeric identifiers.
 */
export function indexVersion(now, run) {
  const mmdd = (now.getUTCMonth() + 1) * 100 + now.getUTCDate()
  return `${now.getUTCFullYear()}.${mmdd}.${run}`
}

/** The README the package page shows. Short, because it is shipped to readers. */
function readme(version, plugins, bytes) {
  return `# dsh-plugin-catalog-index

The DeepSeek Harness **plugin market index** (format 1) — the same
\`index.json\` served at <https://awesome-dsh-plugin.com/index.json>, published
to npm so it can be fetched through a CDN.

Add it in dsh 0.2.1+ under **Plugins → Discover → Index sources**:

\`\`\`
https://cdn.jsdelivr.net/npm/${PKG}@latest/index.json
\`\`\`

That address is the fastest of the two from networks where GitHub Pages is
slow; the canonical copy stays at awesome-dsh-plugin.com.

- **Plugins:** ${plugins}
- **Size:** ${(bytes / 1024 / 1024).toFixed(1)} MB (format 1, the document a DSH host reads)
- **Version:** \`${version}\` (published only when the index changes)
- **Source:** <https://github.com/awesome-dsh-plugin/awesome-dsh-plugin>
- **License:** CC0-1.0

Published automatically; do not open pull requests here.
`
}

const built = fs.readFileSync(BUILT)
const hash = sha256(built)
if (hash === await publishedHash()) {
  console.log(`index unchanged (${hash.slice(0, 12)}) — nothing to publish`)
  process.exit(0)
}

const plugins = JSON.parse(built.toString()).plugins.length
const version = indexVersion(new Date(), process.env.GITHUB_RUN_NUMBER ?? '0')
const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-index-'))
fs.writeFileSync(path.join(stage, 'index.json'), built)
fs.writeFileSync(path.join(stage, 'README.md'), readme(version, plugins, built.length))
fs.copyFileSync('LICENSE', path.join(stage, 'LICENSE'))
fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({
  name: PKG,
  version,
  description: `The DeepSeek Harness plugin market index (${plugins} plugins) · DeepSeek Harness 插件市场索引`,
  homepage: 'https://awesome-dsh-plugin.com',
  repository: {
    type: 'git',
    url: 'git+https://github.com/awesome-dsh-plugin/awesome-dsh-plugin.git',
  },
  license: 'CC0-1.0',
  keywords: ['dsh', 'dsh-plugin', 'deepseek-harness', 'deepseek', 'market-index'],
  // The validator a consumer reads back on its next check, and what stops
  // this script republishing an identical index tomorrow.
  indexSha: hash,
  exports: { './index.json': './index.json' },
  files: ['index.json'],
}, null, 2) + '\n')

console.log(`publishing ${PKG}@${version} — ${plugins} plugins, ${(built.length / 1024 / 1024).toFixed(1)} MB, sha ${hash.slice(0, 12)}`)
// `DRY_RUN=1` runs everything up to and including npm's own packing checks
// without publishing, so the whole path can be exercised by hand.
const args = ['publish', '--access', 'public']
if (process.env.DRY_RUN === '1') args.push('--dry-run')
execFileSync('npm', args, { stdio: 'inherit', cwd: stage })
