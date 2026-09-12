import { readdir, readFile } from 'node:fs/promises'
import { extname, isAbsolute, resolve } from 'node:path'

/** One configured source root visible to the read-only searcher. */
export interface SourceRoot {
  readonly label: string
  readonly path: string
}

/** Bounds and exclusions applied to one source search. */
export interface SearchOptions {
  readonly maxFiles: number
  readonly maxFileBytes: number
  readonly maxResults: number
  readonly excludedDirectories: readonly string[]
}

/** One source line that contains the requested literal. */
export interface SourceMatch {
  readonly root: string
  readonly path: string
  readonly line: number
  readonly text: string
}

/** Search result with explicit scan and truncation facts. */
export interface SourceSearchResult {
  readonly query: string
  readonly matches: SourceMatch[]
  readonly scannedFiles: number
  readonly truncated: boolean
}

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.java', '.xml', '.sql', '.md', '.yaml', '.yml', '.json',
])

/**
 * Resolve configured roots while preserving their user-facing labels.
 * @param roots - Configured source roots.
 * @param cwd - Calling workspace used for relative paths.
 * @returns Resolved source roots with stable labels.
 */
export function resolveSourceRoots(roots: readonly SourceRoot[], cwd: string): SourceRoot[] {
  return roots.map(root => ({
    label: root.label,
    path: isAbsolute(root.path) ? resolve(root.path) : resolve(cwd, root.path),
  }))
}

/**
 * Search configured source roots for a case-insensitive literal.
 * @param roots - Source roots to visit in order.
 * @param query - Literal text to find.
 * @param options - Traversal and result bounds.
 * @param signal - Cancellation signal for the walk.
 * @returns Search evidence and explicit scan-limit status.
 */
export async function searchSources(
  roots: readonly SourceRoot[],
  query: string,
  options: SearchOptions,
  signal: AbortSignal,
): Promise<SourceSearchResult> {
  const normalizedQuery = query.trim()
  if (normalizedQuery.length === 0) throw new Error('revenue-source: query must not be empty')
  const needle = normalizedQuery.toLocaleLowerCase()
  const matches: SourceMatch[] = []
  let scannedFiles = 0
  let truncated = false

  const visit = async (root: SourceRoot, directory: string): Promise<void> => {
    throwIfAborted(signal)
    if (scannedFiles >= options.maxFiles || matches.length >= options.maxResults) {
      truncated = true
      return
    }
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      throwIfAborted(signal)
      if (scannedFiles >= options.maxFiles || matches.length >= options.maxResults) {
        truncated = true
        return
      }
      if (entry.isDirectory()) {
        if (!options.excludedDirectories.includes(entry.name)) {
          await visit(root, resolve(directory, entry.name))
        }
        continue
      }
      if (!entry.isFile() || !SOURCE_EXTENSIONS.has(extname(entry.name).toLocaleLowerCase())) continue
      const path = resolve(directory, entry.name)
      const content = await readFile(path)
      scannedFiles++
      if (content.byteLength > options.maxFileBytes) continue
      const text = content.toString('utf8')
      const lines = text.split(/\r?\n/)
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index]
        if (line !== undefined && line.toLocaleLowerCase().includes(needle)) {
          matches.push({
            root: root.label,
            path,
            line: index + 1,
            text: compactLine(line),
          })
          if (matches.length >= options.maxResults) {
            truncated = true
            return
          }
        }
      }
    }
  }

  for (const root of roots) {
    await visit(root, root.path)
  }
  return { query: normalizedQuery, matches, scannedFiles, truncated }
}

/**
 * Classify a match for a first-pass frontend-to-backend flow view.
 * @param match - Evidence record whose path supplies the hints.
 * @returns The probable source category.
 */
export function classifySourceMatch(match: SourceMatch): 'frontend' | 'controller' | 'service' | 'mapper' | 'documentation' | 'other' {
  const path = match.path.toLocaleLowerCase()
  if (path.endsWith('.md') || path.endsWith('.yaml') || path.endsWith('.yml')) return 'documentation'
  if (/(controller|resource|action)/.test(path)) return 'controller'
  if (/(service|manager|handler)/.test(path)) return 'service'
  if (/(mapper|repository|dao|\.xml$|\.sql$)/.test(path)) return 'mapper'
  if (/\.(tsx?|jsx?)$/.test(path) && /(src|frontend|web|ui|page|component)/.test(path)) return 'frontend'
  return 'other'
}

/**
 * Group matches in a stable evidence order for model-facing flow tracing.
 * @param matches - Evidence records to classify.
 * @returns Non-empty groups in frontend-to-backend display order.
 */
export function groupSourceMatches(matches: readonly SourceMatch[]): Array<{
  readonly kind: ReturnType<typeof classifySourceMatch>
  readonly matches: SourceMatch[]
}> {
  const order: ReturnType<typeof classifySourceMatch>[] = ['frontend', 'controller', 'service', 'mapper', 'documentation', 'other']
  const groups = new Map<ReturnType<typeof classifySourceMatch>, SourceMatch[]>()
  for (const match of matches) {
    const kind = classifySourceMatch(match)
    const group = groups.get(kind) ?? []
    group.push(match)
    groups.set(kind, group)
  }
  return order
    .filter(kind => groups.has(kind))
    .map(kind => ({ kind, matches: groups.get(kind) as SourceMatch[] }))
}

function compactLine(line: string): string {
  const compact = line.trim().replace(/\s+/g, ' ')
  return compact.length > 240 ? `${compact.slice(0, 237)}...` : compact
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  const error = new Error('revenue-source: search aborted')
  error.name = 'AbortError'
  throw error
}

/** Default bounds and excluded directories for one search call. */
export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  maxFiles: 10_000,
  maxFileBytes: 2 * 1024 * 1024,
  maxResults: 80,
  excludedDirectories: [
    '.git', '.dsh', 'node_modules', 'target', 'dist', 'build', 'coverage',
  ],
}
