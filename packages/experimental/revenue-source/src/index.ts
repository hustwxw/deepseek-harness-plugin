/** Read-only source evidence tools for tracing revenue-system behavior. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  DEFAULT_SEARCH_OPTIONS,
  groupSourceMatches,
  resolveSourceRoots,
  searchSources,
  type SearchOptions,
  type SourceMatch,
  type SourceRoot,
} from './search.ts'

export const name = 'experimental-revenue-source'
export const inject = ['tools']

/** One source directory available to the evidence tools. */
export interface ConfiguredRoot {
  /** Stable label included in every evidence record. */
  label: string
  /** Absolute path, or a path relative to the calling workspace. */
  path: string
}

/** Read-only source search configuration. */
export interface Config {
  /** Explicit source roots; an empty list means the current workspace. */
  roots?: ConfiguredRoot[]
  /** Maximum source files visited by one call. */
  maxFiles?: number
  /** Maximum bytes read from one source file. */
  maxFileBytes?: number
  /** Maximum evidence records returned by one call. */
  maxResults?: number
  /** Directory basenames excluded from recursive traversal. */
  excludedDirectories?: string[]
}

export const Config: z<Config> = z.object({
  roots: z.array(z.object({
    label: z.string().min(1),
    path: z.string().min(1),
  })).default([]),
  maxFiles: z.number().step(1).min(1).default(DEFAULT_SEARCH_OPTIONS.maxFiles),
  maxFileBytes: z.number().step(1).min(1).default(DEFAULT_SEARCH_OPTIONS.maxFileBytes),
  maxResults: z.number().step(1).min(1).default(DEFAULT_SEARCH_OPTIONS.maxResults),
  excludedDirectories: z.array(z.string().min(1)).default([...DEFAULT_SEARCH_OPTIONS.excludedDirectories]),
})

const MATCH_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    root: { type: 'string' as const, required: true },
    path: { type: 'string' as const, required: true },
    line: { type: 'integer' as const, required: true },
    text: { type: 'string' as const, required: true },
  },
} as const

const SEARCH_OUTPUT = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    query: { type: 'string' as const, required: true },
    matches: { type: 'array' as const, required: true, items: MATCH_SCHEMA },
    scannedFiles: { type: 'integer' as const, required: true },
    truncated: { type: 'boolean' as const, required: true },
  },
} as const

const TRACE_OUTPUT = {
  type: 'object' as const,
  additionalProperties: false,
  properties: {
    query: { type: 'string' as const, required: true },
    groups: {
      type: 'array' as const,
      required: true,
      items: {
        type: 'object' as const,
        additionalProperties: false,
        properties: {
          kind: {
            type: 'string' as const,
            required: true,
            enum: ['frontend', 'controller', 'service', 'mapper', 'documentation', 'other'],
          },
          matches: { type: 'array' as const, required: true, items: MATCH_SCHEMA },
        },
      },
    },
    scannedFiles: { type: 'integer' as const, required: true },
    truncated: { type: 'boolean' as const, required: true },
  },
} as const

/** Register the source search and flow tracing tools. */
export function apply(ctx: Context, config: Config): void {
  const configured = config.roots ?? []
  const searchOptions: SearchOptions = {
    maxFiles: config.maxFiles ?? DEFAULT_SEARCH_OPTIONS.maxFiles,
    maxFileBytes: config.maxFileBytes ?? DEFAULT_SEARCH_OPTIONS.maxFileBytes,
    maxResults: config.maxResults ?? DEFAULT_SEARCH_OPTIONS.maxResults,
    excludedDirectories: config.excludedDirectories ?? DEFAULT_SEARCH_OPTIONS.excludedDirectories,
  }

  ctx.tools.register(defineTool({
    name: 'revenue_search',
    description: 'Search configured revenue-system source roots for a literal and return file:line evidence. Read-only; use this before making a business or code claim.',
    parameters: {
      query: { type: 'string', required: true, description: 'Literal text, symbol, route, API path, or business term to find.' },
      root: { type: 'string', description: 'Optional configured root label.' },
      maxResults: { type: 'integer', description: 'Optional result limit, capped by plugin configuration.' },
    },
    output: {
      schema: SEARCH_OUTPUT,
      render: (_args, value) => [{ type: 'text', text: renderSearch(value) }],
    },
    async execute(args, exec) {
      const result = await runSearch(
        configured,
        searchOptions,
        args.query,
        args.root,
        args.maxResults,
        exec.signal,
        exec.agent?.session.header.cwd,
      )
      return result
    },
    presentCall: args => ({ card: 'generic', title: `Search source: ${args.query}`, kind: 'search', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'revenue_trace',
    description: 'Search configured revenue-system source roots and group matching evidence into a probable frontend, Controller, Service, Mapper, and documentation flow. This is a candidate trace, not proof beyond the returned file:line records.',
    parameters: {
      query: { type: 'string', required: true, description: 'Business term, symbol, route, or API path to trace.' },
      root: { type: 'string', description: 'Optional configured root label.' },
      maxResults: { type: 'integer', description: 'Optional result limit, capped by plugin configuration.' },
    },
    output: {
      schema: TRACE_OUTPUT,
      render: (_args, value) => [{ type: 'text', text: renderTrace(value) }],
    },
    async execute(args, exec) {
      const result = await runSearch(
        configured,
        searchOptions,
        args.query,
        args.root,
        args.maxResults,
        exec.signal,
        exec.agent?.session.header.cwd,
      )
      return {
        query: result.query,
        groups: groupSourceMatches(result.matches),
        scannedFiles: result.scannedFiles,
        truncated: result.truncated,
      }
    },
    presentCall: args => ({ card: 'generic', title: `Trace source flow: ${args.query}`, kind: 'search', rawInput: args }),
  }))
}

async function runSearch(
  configured: readonly ConfiguredRoot[],
  options: SearchOptions,
  query: string,
  rootLabel: string | undefined,
  requestedMaxResults: number | undefined,
  signal: AbortSignal,
  workspace: string | undefined,
) {
  const cwd = workspace ?? process.cwd()
  const roots: SourceRoot[] = configured.length === 0
    ? [{ label: 'workspace', path: cwd }]
    : resolveSourceRoots(configured, cwd)
  const selected = rootLabel === undefined ? roots : roots.filter(root => root.label === rootLabel)
  if (selected.length === 0) throw new Error(`revenue-source: unknown root ${JSON.stringify(rootLabel)}`)
  const maxResults = requestedMaxResults === undefined
    ? options.maxResults
    : Math.min(options.maxResults, Math.max(1, Math.trunc(requestedMaxResults)))
  return searchSources(selected, query, { ...options, maxResults }, signal)
}

function renderSearch(value: { query: string; matches: SourceMatch[]; scannedFiles: number; truncated: boolean }): string {
  const lines = value.matches.map(match => `${match.root}: ${match.path}:${match.line}\n  ${match.text}`)
  return [
    `Search results for ${JSON.stringify(value.query)} (${value.matches.length} matches; ${value.scannedFiles} files scanned${value.truncated ? '; truncated' : ''})`,
    ...lines,
  ].join('\n')
}

function renderTrace(value: {
  query: string
  groups: Array<{ kind: string; matches: SourceMatch[] }>
  scannedFiles: number
  truncated: boolean
}): string {
  const lines = [`Candidate source flow for ${JSON.stringify(value.query)} (${value.scannedFiles} files scanned${value.truncated ? '; truncated' : ''})`]
  for (const group of value.groups) {
    lines.push(`\n[${group.kind}]`)
    for (const match of group.matches) lines.push(`${match.root}: ${match.path}:${match.line}\n  ${match.text}`)
  }
  return lines.join('\n')
}
