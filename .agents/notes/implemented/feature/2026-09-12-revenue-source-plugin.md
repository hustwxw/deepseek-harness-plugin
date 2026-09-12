# Agent Note: Revenue source evidence uses a bounded read-only Host plugin

Status: implemented

English | [中文](2026-09-12-revenue-source-plugin.zh.md)

## Problem

Revenue-system investigations need file and line evidence across a frontend workspace and one or more Java backend roots. A generic filesystem search can find text, but it does not provide a stable tool name, configured root labels, bounded evidence records, or a first-pass frontend-to-backend view that the model can request directly.

## Decision

`@deepseek-ai/dsh-experimental-revenue-source` is one private Host-side Cordis plugin. It consumes `tools`, registers `revenue_search` and `revenue_trace`, and keeps filesystem traversal in a separate module. `revenue_search` returns literal file:line evidence. `revenue_trace` reuses that evidence and groups matches by path-derived frontend, Controller, Service, Mapper, documentation, or other categories.

The plugin accepts configured labeled roots and bounded traversal settings. An empty root list means the calling workspace. The implementation is read-only, checks cancellation, skips common dependency and build directories, and marks capped results as truncated. Path classification is navigation guidance and does not prove a call relationship.

The package has separate source and built Cordis patch files. The source patch loads `./src/index.ts` through the `tsx` launcher. The built patch loads `./lib/index.js` through plain Node. Relative file entries let package inventory resolve the nearest package manifest, so Loader execution and request-extension package identity use the same path.

The package participates in the Host TypeScript aggregate, has a frozen-install workspace importer, and owns a paired package README. The generated configuration catalog remains derived from the `Config` declaration, and the cookbook owns the file-by-file development procedure.

## Consequences

The model can request one domain-specific search tool and receive stable evidence fields without changing `agent-loop`. Deployments must configure roots when the target source is outside the calling workspace. A broad query can stop at the configured limits, so callers must inspect `truncated` before treating the result as complete. Semantic call-graph recovery remains outside this package.

The relative source and built patches add two launch files to maintain, but they prevent a source-only TypeScript alias from passing Loader startup and failing later during request-extension preparation. The package keeps the search engine testable without a Cordis boot and keeps UI presentation separate from the canonical tool result.

## Alternatives considered

**Generic filesystem search only.** Rejected because the model would need to select paths and search parameters for every revenue investigation, and the result would not carry a stable domain-specific evidence contract.

**A semantic index or call-graph analyzer.** Rejected for this package because JavaScript, TypeScript, Java, XML, SQL, and generated frontend code require different parsers and build context. Literal evidence is useful immediately and leaves semantic confirmation to source reading.

**A bare package name in the source patch.** Rejected because a TypeScript path alias can load the module while package inventory still cannot resolve its owning manifest through Node package search paths. File-relative entries make the package identity resolution explicit.

**Changing `agent-loop` to add a special revenue search phase.** Rejected because the behavior is a model-facing tool capability and the repository extension rules place new tool behavior in plugins, not in the loop.

## Testing

The package test suite covers file:line evidence, excluded directories, stable group order, and relative-root resolution. The source and built patches load through profile composition dumps. The package TypeScript project and Host aggregate compile, the generated configuration catalog is fresh, the bilingual pairs are consistent, and `git diff --check` passes for the authored change.
