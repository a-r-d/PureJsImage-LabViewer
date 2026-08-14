import { readdir, rm } from 'node:fs/promises'
import path from 'node:path'

const packageRoot = process.cwd()
await rm(path.join(packageRoot, 'dist'), { force: true, recursive: true })

for (const entry of await readdir(packageRoot)) {
  if (entry.endsWith('.tsbuildinfo')) {
    await rm(path.join(packageRoot, entry), { force: true })
  }
}
