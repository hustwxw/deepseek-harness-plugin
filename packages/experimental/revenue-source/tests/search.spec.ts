import { mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { apply, inject, name } from '../src/index.ts'
import {
  DEFAULT_SEARCH_OPTIONS,
  groupSourceMatches,
  resolveSourceRoots,
  searchSources,
} from '../src/search.ts'

vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')
  return { ...actual, readdir: vi.fn(actual.readdir) }
})

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('revenue source search', () => {
  it('returns file and line evidence and skips excluded directories', async () => {
    const root = await makeRoot()
    await mkdir(join(root, 'node_modules'), { recursive: true })
    await writeFile(join(root, 'main.ts'), 'const route = "/priceDeviation/check"\n')
    await writeFile(join(root, 'node_modules', 'ignored.ts'), 'const route = "/priceDeviation/check"\n')

    const result = await searchSources(
      [{ label: 'test', path: root }],
      '/priceDeviation/check',
      DEFAULT_SEARCH_OPTIONS,
      new AbortController().signal,
    )

    expect(result.matches).toEqual([{
      root: 'test',
      path: join(root, 'main.ts'),
      line: 1,
      text: 'const route = "/priceDeviation/check"',
    }])
    expect(result.truncated).toBe(false)
  })

  it('groups evidence into a stable probable flow order', () => {
    const matches = [
      { root: 'r', path: 'src/PriceController.java', line: 2, text: 'checkPrice()' },
      { root: 'r', path: 'src/priceService.java', line: 3, text: 'checkPrice()' },
      { root: 'r', path: 'src/priceMapper.xml', line: 4, text: 'checkPrice' },
      { root: 'r', path: 'src/pages/Price.tsx', line: 5, text: 'checkPrice' },
    ]

    expect(groupSourceMatches(matches).map(group => group.kind)).toEqual([
      'frontend', 'controller', 'service', 'mapper',
    ])
  })

  it('resolves relative roots against the workspace', () => {
    expect(resolveSourceRoots([{ label: 'src', path: './src' }], 'C:/workspace'))
      .toEqual([{ label: 'src', path: resolve('C:/workspace', 'src') }])
  })

  it('covers bounded traversal, unsupported entries, long lines, and cancellation', async () => {
    const root = await makeRoot()
    await mkdir(join(root, 'nested'), { recursive: true })
    await writeFile(join(root, 'nested', 'source.ts'), '  needle    with    spaces  \n')
    await writeFile(join(root, 'ignored.txt'), 'needle\n')
    await writeFile(join(root, 'large.ts'), 'needle'.repeat(20))
    const actualEntries = await readdir(root, { withFileTypes: true })
    vi.mocked(readdir).mockResolvedValueOnce([
      { name: 'linked-entry', isDirectory: () => false, isFile: () => false },
      ...actualEntries,
    ] as unknown as Awaited<ReturnType<typeof readdir>>)

    const result = await searchSources(
      [{ label: 'test', path: root }],
      ' NEEDLE ',
      { maxFiles: 10, maxFileBytes: 100, maxResults: 10, excludedDirectories: [] },
      new AbortController().signal,
    )

    expect(result.matches).toEqual([{
      root: 'test',
      path: join(root, 'nested', 'source.ts'),
      line: 1,
      text: 'needle with spaces',
    }])
    expect(result.scannedFiles).toBe(2)
    expect(resolveSourceRoots([{ label: 'absolute', path: root }], 'C:/workspace'))
      .toEqual([{ label: 'absolute', path: resolve(root) }])
  })

  it('reports empty queries, zero limits, result caps, and oversized lines', async () => {
    const root = await makeRoot()
    await writeFile(join(root, 'matches.ts'), `${'x'.repeat(250)}needle\nneedle\n`)
    await writeFile(join(root, 'second.ts'), 'needle\n')

    await expect(searchSources(
      [{ label: 'test', path: root }],
      '   ',
      DEFAULT_SEARCH_OPTIONS,
      new AbortController().signal,
    )).rejects.toThrow('query must not be empty')

    await expect(searchSources(
      [{ label: 'test', path: root }],
      'needle',
      { ...DEFAULT_SEARCH_OPTIONS, maxFiles: 0 },
      new AbortController().signal,
    )).resolves.toMatchObject({ matches: [], scannedFiles: 0, truncated: true })

    await expect(searchSources(
      [{ label: 'test', path: root }],
      'needle',
      { ...DEFAULT_SEARCH_OPTIONS, maxResults: 0 },
      new AbortController().signal,
    )).resolves.toMatchObject({ matches: [], scannedFiles: 0, truncated: true })

    const capped = await searchSources(
      [{ label: 'test', path: root }],
      'needle',
      { ...DEFAULT_SEARCH_OPTIONS, maxResults: 1 },
      new AbortController().signal,
    )
    expect(capped.matches).toHaveLength(1)
    expect(capped.matches[0]?.text.endsWith('...')).toBe(true)
    expect(capped.truncated).toBe(true)
  })

  it('stops when a file limit is reached and when the signal aborts during iteration', async () => {
    const root = await makeRoot()
    await writeFile(join(root, 'a.ts'), 'no match\n')
    await writeFile(join(root, 'b.ts'), 'still no match\n')

    await expect(searchSources(
      [{ label: 'test', path: root }],
      'needle',
      { ...DEFAULT_SEARCH_OPTIONS, maxFiles: 1 },
      new AbortController().signal,
    )).resolves.toMatchObject({ matches: [], scannedFiles: 1, truncated: true })

    let checks = 0
    const signal = {
      get aborted(): boolean {
        checks++
        return checks >= 3
      },
    } as AbortSignal
    await expect(searchSources(
      [{ label: 'test', path: root }],
      'needle',
      DEFAULT_SEARCH_OPTIONS,
      signal,
    )).rejects.toMatchObject({ name: 'AbortError', message: 'revenue-source: search aborted' })

    const alreadyAborted = new AbortController()
    alreadyAborted.abort()
    await expect(searchSources(
      [{ label: 'test', path: root }],
      'needle',
      DEFAULT_SEARCH_OPTIONS,
      alreadyAborted.signal,
    )).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('classifies every evidence category and keeps duplicate groups together', () => {
    const matches = [
      { root: 'r', path: 'src/PricePage.tsx', line: 1, text: 'x' },
      { root: 'r', path: 'src/OtherPage.tsx', line: 2, text: 'x' },
      { root: 'r', path: 'src/PriceController.java', line: 3, text: 'x' },
      { root: 'r', path: 'src/priceService.java', line: 4, text: 'x' },
      { root: 'r', path: 'src/priceMapper.xml', line: 5, text: 'x' },
      { root: 'r', path: 'docs/architecture.md', line: 6, text: 'x' },
      { root: 'r', path: 'lib/generated.txt', line: 7, text: 'x' },
    ]

    expect(groupSourceMatches(matches).map(group => [group.kind, group.matches.length])).toEqual([
      ['frontend', 2],
      ['controller', 1],
      ['service', 1],
      ['mapper', 1],
      ['documentation', 1],
      ['other', 1],
    ])
  })

  it('registers and runs both source evidence tools', async () => {
    const root = await makeRoot()
    await mkdir(join(root, 'src'), { recursive: true })
    await writeFile(join(root, 'src', 'PricePage.tsx'), 'needle\n')
    await writeFile(join(root, 'src', 'PriceController.java'), 'needle\n')
    await writeFile(join(root, 'priceService.java'), 'needle\n')
    await writeFile(join(root, 'priceMapper.xml'), 'needle\n')
    await writeFile(join(root, 'README.md'), 'needle\n')

    const defaults = registerTools({})
    expect(defaults.map(tool => tool.name)).toEqual(['revenue_search', 'revenue_trace'])
    expect(name).toBe('experimental-revenue-source')
    expect(inject).toEqual(['tools'])

    const configured = registerTools({
      roots: [{ label: 'test', path: root }],
      maxFiles: 20,
      maxFileBytes: 1024,
      maxResults: 10,
      excludedDirectories: [],
    })
    const search = getTool(configured, 'revenue_search')
    const trace = getTool(configured, 'revenue_trace')
    expect(search.presentCall?.({ query: 'needle' })).toEqual({
      card: 'generic', title: 'Search source: needle', kind: 'search', rawInput: { query: 'needle' },
    })
    expect(trace.presentCall?.({ query: 'needle' })).toEqual({
      card: 'generic', title: 'Trace source flow: needle', kind: 'search', rawInput: { query: 'needle' },
    })

    const searchResult = await search.execute(
      { query: ' needle ', root: 'test', maxResults: 5 },
      makeExecution('revenue_search', { query: ' needle ', root: 'test', maxResults: 5 }),
    )
    expect(search.output.render({}, searchResult as never)[0]).toMatchObject({ type: 'text' })

    const traceResult = await trace.execute(
      { query: 'needle' },
      makeExecution('revenue_trace', { query: 'needle' }),
    )
    expect(trace.output.render({}, traceResult as never)[0]).toMatchObject({ type: 'text' })
    expect(traceResult).toMatchObject({ query: 'needle', truncated: false })

    expect(search.output.render({}, {
      query: 'empty', matches: [], scannedFiles: 0, truncated: true,
    })[0]).toMatchObject({ type: 'text' })
    expect(search.output.render({}, {
      query: 'complete', matches: [], scannedFiles: 0, truncated: false,
    })[0]).toMatchObject({ type: 'text' })
    expect(trace.output.render({}, {
      query: 'empty', groups: [], scannedFiles: 0, truncated: false,
    })[0]).toMatchObject({ type: 'text' })
    expect(trace.output.render({}, {
      query: 'truncated', groups: [], scannedFiles: 0, truncated: true,
    })[0]).toMatchObject({ type: 'text' })

    await expect(search.execute(
      { query: 'needle', root: 'missing' },
      makeExecution('revenue_search', { query: 'needle', root: 'missing' }),
    )).rejects.toThrow('unknown root')

    const workspaceTools = registerTools({
      maxFiles: 20,
      maxFileBytes: 1024,
      maxResults: 10,
      excludedDirectories: [],
    })
    const workspaceSearch = getTool(workspaceTools, 'revenue_search')
    await expect(workspaceSearch.execute(
      { query: 'needle' },
      makeExecution('revenue_search', { query: 'needle' }, { session: { header: { cwd: root } } }),
    )).resolves.toMatchObject({ query: 'needle' })
  })
})

function registerTools(config: Parameters<typeof apply>[1]): ToolDefinition[] {
  const definitions: ToolDefinition[] = []
  const context = {
    tools: {
      register(definition: ToolDefinition): () => void {
        definitions.push(definition)
        return () => undefined
      },
    },
  } as unknown as Context
  apply(context, config)
  return definitions
}

function getTool(definitions: readonly ToolDefinition[], toolName: string): ToolDefinition {
  const definition = definitions.find(tool => tool.name === toolName)
  if (definition === undefined) throw new Error(`missing test tool ${toolName}`)
  return definition
}

function makeExecution(name: string, args: unknown, agent?: unknown): ToolRunContext {
  return {
    callId: 'revenue-test' as ToolRunContext['callId'],
    rootCallId: 'revenue-test' as ToolRunContext['rootCallId'],
    token: Symbol('revenue-test') as ToolRunContext['token'],
    name,
    arguments: args,
    signal: new AbortController().signal,
    ...(agent === undefined ? {} : { agent }),
    deferContext: () => undefined,
    concludeTurn: () => undefined,
  } as unknown as ToolRunContext
}

async function makeRoot(): Promise<string> {
  const root = join(process.cwd(), '.tmp-revenue-source-test')
  await rm(root, { recursive: true, force: true })
  await mkdir(root, { recursive: true })
  tempRoots.push(root)
  return root
}
