# Cookbook: build a source-evidence plugin

English | [中文](building-a-source-evidence-plugin.zh.md)

## Summary

This tutorial uses `@deepseek-ai/dsh-experimental-revenue-source` as a complete example of a read-only, model-facing source-search plugin. It explains how the package manifest, Cordis entry point, search engine, tests, launch overlays, TypeScript project files, lockfile, generated catalogs, and documentation work together. The example returns file and line evidence for revenue-system code and keeps heuristic flow grouping separate from proven call relationships. Use the file map when you start a plugin that needs a bounded local data source rather than a new agent-loop feature.

## Table of Contents

- [Case outcome](#case-outcome)
- [Step 1: define the package boundary](#step-1-define-the-package-boundary)
- [Step 2: register model-facing tools](#step-2-register-model-facing-tools)
- [Step 3: isolate the search engine](#step-3-isolate-the-search-engine)
- [Step 4: test evidence and grouping](#step-4-test-evidence-and-grouping)
- [Step 5: support source and built launchers](#step-5-support-source-and-built-launchers)
- [Step 6: register the workspace package](#step-6-register-the-workspace-package)
- [Step 7: document and validate the package](#step-7-document-and-validate-the-package)
- [File-by-file source map](#file-by-file-source-map)
- [Failure and recovery](#failure-and-recovery)
- [Further Exploration](#further-exploration)
- [Dev Note](#dev-note)

-----

<a id="case-outcome"></a>
## Case outcome

The example adds two visible tools without changing `agent-loop`: `revenue_search` performs bounded literal search, and `revenue_trace` presents the same evidence in a probable frontend-to-backend order. The tools read configured roots, skip common generated or dependency directories, return one-based line numbers, and mark capped results as truncated. The package is mounted through a Cordis patch, so the same implementation can run from TypeScript source during development and from `lib/` after a Host build.

### Starting point

The reader should know TypeScript, Cordis plugin registration, `defineTool`, and the repository rule that model-visible behavior belongs on documented extension points. Read [Adding a tool](adding-a-tool.md) for the general tool contract and [Adding a workspace package](adding-a-package.md) for the package checklist before copying this example.

### Observable result

After mounting the source patch and configuring the revenue roots, a request such as the following exposes structured `file:line` evidence to the model:

```text
请使用 revenue_trace 追踪 checkInterPriceDeviation，并给出前端、Controller、Service、Mapper 的文件路径和行号。
```

The plugin does not prove a call graph. It gives the model stable evidence and an explicit limitation so the model can read the returned files before making a claim.

-----

<a id="step-1-define-the-package-boundary"></a>
## Step 1: define the package boundary

Keep a single-purpose capability in one package when its service definition, implementation, and consumer do not need independent release lifecycles. This example is a Host-side Cordis plugin, not a new capability seam: it consumes `tools`, registers two tools, and owns the local search algorithm.

### Package manifest

[`packages/experimental/revenue-source/package.json`](../../packages/experimental/revenue-source/package.json) declares an ESM workspace package with the repository version, `lib/index.js` runtime output, `lib/types/index.d.ts` declarations, `@deepseek-ai/cordis` and `@deepseek-ai/dsh-tools` peer/dev dependencies, and `@deepseek-ai/schemastery` as a runtime dependency. The `dsh.bundle.patch` entry points the package's built patch at the plugin, while `private: true` keeps this personal experimental package out of publication.

The manifest is the package identity used by workspace installation, package inventory, build discovery, and documentation checks. A plugin can load successfully while still failing request-extension preparation if its active Loader entry does not resolve to a manifest; the launch overlays in Step 5 prevent that mismatch.

### TypeScript project

[`packages/experimental/revenue-source/tsconfig.json`](../../packages/experimental/revenue-source/tsconfig.json) sets `src` as the source root, emits declarations under `lib/types`, and references the Cordis, Schemastery, and `dsh-tools` projects. The references make the package participate in the Host solution and let the compiler use source-plane types instead of inventing package-local copies.

-----

<a id="step-2-register-model-facing-tools"></a>
## Step 2: register model-facing tools

[`packages/experimental/revenue-source/src/index.ts`](../../packages/experimental/revenue-source/src/index.ts) is the Cordis entry point. It declares `name`, injects `tools`, validates deployment configuration with Schemastery, defines the canonical JSON output schemas, and registers both tools through `ctx.tools.register(defineTool(...))`.

`revenue_search` accepts a required literal query, an optional configured root label, and an optional result cap. Its canonical output contains the normalized query, root label, absolute path, one-based line number, compact source line, scanned-file count, and truncation flag. `revenue_trace` reuses the same execution path and replaces the flat match list with ordered `frontend`, `controller`, `service`, `mapper`, `documentation`, and `other` groups.

The `execute` functions return structured values, while `output.render` creates concise model-facing text. `presentCall` only supplies a pure generic search card. This split preserves a programmatic result for PTC and replay while keeping UI formatting out of the search algorithm.

The plugin converts an empty configured-root list into the calling workspace. Explicit roots may be absolute or workspace-relative, and a requested unknown label fails rather than silently searching a different directory. The configuration caps file visits, file bytes, retained matches, and excluded directory names without hardcoding a deployment-specific source path.

-----

<a id="step-3-isolate-the-search-engine"></a>
## Step 3: isolate the search engine

[`packages/experimental/revenue-source/src/search.ts`](../../packages/experimental/revenue-source/src/search.ts) owns filesystem traversal and evidence transformation so the Cordis entry point only adapts configuration and tool contracts. This separation lets unit tests exercise search behavior without booting the agent harness.

The searcher sorts directory entries before traversal, restricts files to source and documentation extensions, compares text case-insensitively as a literal, compacts long matching lines, and records one-based line numbers. It skips configured directory basenames such as `.git`, `node_modules`, `dist`, and `build`. It stops at the file, byte, or result limit and reports `truncated: true` instead of presenting a capped result as complete.

`resolveSourceRoots` resolves relative paths against the calling workspace. `classifySourceMatch` only inspects the path, and `groupSourceMatches` applies a stable group order. Names such as `Controller`, `Service`, `Mapper`, `repository`, `dao`, and frontend-like source paths produce navigation hints; they do not establish a runtime relationship between files.

The search loop checks `AbortSignal` before directory and file work. That lets the tool registry cancel a long walk when the caller disconnects or the model turn settles. The function does not write files, spawn processes, call a network service, or silently fall back after a configured root error.

-----

<a id="step-4-test-evidence-and-grouping"></a>
## Step 4: test evidence and grouping

[`packages/experimental/revenue-source/tests/search.spec.ts`](../../packages/experimental/revenue-source/tests/search.spec.ts) tests the behavior that a future refactor could accidentally weaken. The fixture proves that a matching source line returns its root, absolute path, line number, and compact text while an excluded `node_modules` match stays invisible. A second test fixes the probable-flow group order, and a third test fixes relative-root resolution.

The tests use temporary directories and remove them in `afterEach`. They exercise the pure search module rather than a real revenue repository, so the suite remains deterministic and does not depend on local business-code availability. Add a package-level integration test if a future version changes Cordis registration, model-visible schema, or patch loading.

Run the focused suite from the repository root:

```powershell
node_modules\\.bin\\vitest.cmd run packages/experimental/revenue-source/tests/search.spec.ts
```

-----

<a id="step-5-support-source-and-built-launchers"></a>
## Step 5: support source and built launchers

The two patch files solve different launch contracts. [`cordis.source.patch.yml`](../../packages/experimental/revenue-source/cordis.source.patch.yml) inserts `./src/index.ts` for the `tsx` source launcher. [`cordis.patch.yml`](../../packages/experimental/revenue-source/cordis.patch.yml) inserts `./lib/index.js` for a plain-Node built launcher.

Relative file entries matter because the package-inventory extension resolves the nearest `package.json` for a file entry. A bare package name can be loaded through a TypeScript path alias and still fail later when request-extension preparation tries to identify the active package. The source and built overlays keep Loader execution and package identity resolution on the same filesystem path.

Use the source path while editing:

```powershell
pnpm dsh web --patch packages/experimental/revenue-source/cordis.source.patch.yml
```

Use the built path after the Host build:

```powershell
pnpm run build:lib:host
node apps/cli/lib/bin.js web --patch packages/experimental/revenue-source/cordis.patch.yml
```

Both patches accept the same package configuration. Configure the local revenue roots inside the matching inserted entry:

```yaml
- insert:
    - id: revenue-source
      name: './src/index.ts'
      config:
        roots:
          - label: revenue-frontend
            path: 'F:/B/B1'
          - label: revenue-backend
            path: 'F:/AI/收益知识库/03 后台代码/sfm_web'
```

Change the entry to `./lib/index.js` in the built patch. Do not use the built patch with the source launcher.

-----

<a id="step-6-register-the-workspace-package"></a>
## Step 6: register the workspace package

[`tsconfig.base.json`](../../tsconfig.base.json) adds the package's source alias, and [`tsconfig.host.json`](../../tsconfig.host.json) adds the package project reference to the Host aggregate. These edits make source imports and the Host build see the package; they do not replace the Cordis patch that mounts it at runtime.

[`pnpm-lock.yaml`](../../pnpm-lock.yaml) adds one workspace importer for the package and its workspace dependencies. Keep this change limited to the new importer so an offline frozen install does not silently upgrade unrelated ranges.

The package directory is already covered by the repository workspace glob. The package-specific project reference is still required because TypeScript solution builds use explicit aggregate membership.

-----

<a id="step-7-document-and-validate-the-package"></a>
## Step 7: document and validate the package

The [package README pair](../../packages/experimental/revenue-source/README.md) and its sidecar explain configuration, source/built launch commands, tool semantics, model-visible behavior, and limitations. The README says that path classification is a heuristic and that the plugin is read-only; it does not promise semantic call-graph recovery.

The [generated configuration catalog pair](../config-catalog.md) comes from the package's `Config` declaration. [`docs/config-catalog.i18n.yaml`](../config-catalog.i18n.yaml) records the confirmed bilingual pair. Regenerate these files from source; do not hand-edit the generated catalog.

[`website/docs.ts`](../../website/docs.ts) adds the paired cookbook page to the English and Chinese documentation navigation. The website projection remains derived, so do not edit `website/.generated/`.

The implementation rationale belongs in [`2026-09-12-revenue-source-plugin.md`](../../.agents/notes/implemented/feature/2026-09-12-revenue-source-plugin.md). The Agent Note records the current decision and rejected alternatives; this cookbook remains the practical file-by-file guide.

Run the focused package and documentation checks after editing:

```powershell
node_modules\\.bin\\tsc.cmd -b packages/experimental/revenue-source/tsconfig.json --pretty false
node_modules\\.bin\\tsc.cmd -b tsconfig.host.json --pretty false
node_modules\\.bin\\tsx.cmd scripts/gen-config-catalog.ts --check
node_modules\\.bin\\tsx.cmd scripts/verify-translation-pairing.ts --write docs/cookbook/building-a-source-evidence-plugin.md
node_modules\\.bin\\tsx.cmd scripts/verify-translation-pairing.ts
git diff --check
```

The source and built patch can be checked without a model key by dumping the composed profile. A successful dump must show the plugin as a file URL under the requested patch.

-----

<a id="file-by-file-source-map"></a>
## File-by-file source map

The table covers every tracked or authored file in this plugin change. Generated catalog files and the lockfile are included because they are part of the package's repository contract; ignored `lib/` output and package-local `node_modules/` remain build artifacts and are not source files.

| File | Why it exists | What it owns |
|---|---|---|
| [`package.json`](../../packages/experimental/revenue-source/package.json) | Gives the workspace and Loader a valid package identity. | ESM metadata, dependencies, exports, build artifact, and bundle patch declaration. |
| [`tsconfig.json`](../../packages/experimental/revenue-source/tsconfig.json) | Makes the package an explicit TypeScript project. | Source root, declaration output, and project references. |
| [`src/index.ts`](../../packages/experimental/revenue-source/src/index.ts) | Connects the capability to Cordis and `dsh-tools`. | Config validation, tool schemas, execution, rendering, and root selection. |
| [`src/search.ts`](../../packages/experimental/revenue-source/src/search.ts) | Keeps filesystem behavior independent of plugin wiring. | Traversal, filtering, limits, cancellation, evidence records, and heuristic grouping. |
| [`tests/search.spec.ts`](../../packages/experimental/revenue-source/tests/search.spec.ts) | Protects the search behavior with deterministic fixtures. | File:line evidence, exclusions, group order, and relative-root behavior. |
| [`cordis.source.patch.yml`](../../packages/experimental/revenue-source/cordis.source.patch.yml) | Loads source during `tsx` development. | Relative `./src/index.ts` Loader entry. |
| [`cordis.patch.yml`](../../packages/experimental/revenue-source/cordis.patch.yml) | Loads the built plugin under plain Node. | Relative `./lib/index.js` Loader entry. |
| [`tsconfig.base.json`](../../tsconfig.base.json) | Lets source-plane consumers resolve the package name. | Source alias for the new package. |
| [`tsconfig.host.json`](../../tsconfig.host.json) | Includes the package in the Host solution build. | Explicit project reference. |
| [`pnpm-lock.yaml`](../../pnpm-lock.yaml) | Makes frozen workspace installation reproducible. | The package's workspace importer and workspace dependency links. |
| [Package README pair](../../packages/experimental/revenue-source/README.md) | Gives package consumers the contract and limitations. | Mounting, configuration, model experience, and supported use. |
| [Configuration catalog pair](../config-catalog.md) | Gives the generated configuration reference a source entry. | The extracted `Config` declaration and source link. |
| [`website/docs.ts`](../../website/docs.ts) | Makes this development case discoverable. | Cookbook navigation and website projection mapping. |
| [Agent Note](../../.agents/notes/implemented/feature/2026-09-12-revenue-source-plugin.md) and pair | Preserves the decision rationale separately from procedure. | The chosen package topology, read-only scope, and alternatives. |

-----

<a id="failure-and-recovery"></a>
## Failure and recovery

If a real model request fails with `DeepSeek request extension preparation failed` and `REQUEST_EXTENSION`, inspect the patch entry before changing tool code. The usual cause for this example is a bare package name in a source patch: TypeScript can resolve the source alias, but package inventory cannot find the active package manifest through Node package search paths. Switch to `cordis.source.patch.yml` for `pnpm dsh` or to `cordis.patch.yml` after the Host build, then confirm the composed profile with `--dump-config`.

If the tool returns no matches, check the configured root labels and paths. An empty `roots` list searches only the calling workspace, which is the harness repository when you launch from this checkout. If the result says `truncated: true`, narrow the roots or query a more specific symbol before drawing a conclusion.

-----

<a id="further-exploration"></a>
## Further Exploration

- [Adding a tool](adding-a-tool.md) — general schemas, execution, cancellation, and presentation contracts.
- [Adding a workspace package](adding-a-package.md) — package metadata, TypeScript references, README gates, and verification.
- [Extension patterns](extension-cookbook.md) — Cordis effects, hooks, and extension-point composition.
- [DeepSeek Harness architecture](../architecture.md) — package composition and documented extension points.

-----

<a id="dev-note"></a>
## Dev Note

None.
