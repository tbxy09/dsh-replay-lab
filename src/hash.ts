import { createHash } from 'node:crypto'
import { lstat, readdir, readFile, readlink } from 'node:fs/promises'
import { join, relative } from 'node:path'

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/** 递归哈希一个目录，产出稳定的 workspace fixture hash。 */
export async function hashDirectory(root: string): Promise<string> {
  const entries: Array<{ path: string; kind: 'file' | 'symlink'; hash: string; size: number }> = []
  const visit = async (directory: string): Promise<void> => {
    for (const name of (await readdir(directory)).sort()) {
      const target = join(directory, name)
      const info = await lstat(target)
      if (info.isDirectory()) await visit(target)
      else if (info.isFile()) {
        const body = await readFile(target)
        entries.push({ path: relative(root, target).replaceAll('\\', '/'), kind: 'file', hash: sha256(body), size: body.length })
      } else if (info.isSymbolicLink()) {
        const link = await readlink(target)
        entries.push({ path: relative(root, target).replaceAll('\\', '/'), kind: 'symlink', hash: sha256(link), size: Buffer.byteLength(link) })
      }
    }
  }
  await visit(root)
  return sha256(canonicalJson(entries))
}
