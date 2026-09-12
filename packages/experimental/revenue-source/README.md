---
description: "A private profile bundle that adds bounded read-only source evidence search and probable frontend-to-backend flow tracing for revenue-system workspaces."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-revenue-source

English | [中文](README.zh.md)

## Summary

This private bundle adds two read-only model-facing tools to a profile: `revenue_search` returns literal matches with source paths and line numbers, and `revenue_trace` groups those matches into a probable frontend, Controller, Service, Mapper, and documentation flow. Use the source patch during development and the built patch after the Host build. Configure roots when the target source is outside the calling workspace. The package provides evidence and navigation hints, not semantic call-graph recovery.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

This package is private to the current checkout, so use a patch overlay rather than a published-package install command. During source development use `cordis.source.patch.yml`; after the Host build use `cordis.patch.yml`:

```powershell
node --import tsx/esm apps/cli/src/bin.ts web --patch packages/experimental/revenue-source/cordis.source.patch.yml
node apps/cli/lib/bin.js web --patch packages/experimental/revenue-source/cordis.patch.yml
```

```yaml
- name: '@deepseek-ai/dsh-experimental-revenue-source'
  config:
    roots:
      - label: revenue-kb
        path: 'F:/AI/收益知识库'
      - label: b1
        path: 'F:/B/B1'
```

When `roots` is empty, the current agent workspace is searched. A root path may be absolute or relative to the calling workspace. The plugin never writes files, starts processes, or sends network requests.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The bundle inserts one relative Loader entry. The source patch points to `./src/index.ts`, and the built patch points to `./lib/index.js`; both entries preserve package-inventory resolution through the nearest `package.json`. The entry plugin validates config and registers the tools, while `src/search.ts` owns filesystem traversal, bounds, cancellation, and heuristic grouping.

### Source map

| File | Role |
|---|---|
| [`cordis.source.patch.yml`](cordis.source.patch.yml) | Source-mode Loader entry for the `tsx` launcher |
| [`cordis.patch.yml`](cordis.patch.yml) | Built-mode Loader entry for plain Node |
| [`src/index.ts`](src/index.ts) | Config and model-facing tool registration |
| [`src/search.ts`](src/search.ts) | Read-only search, evidence records, and path classification |
| [`tests/search.spec.ts`](tests/search.spec.ts) | File:line, exclusion, grouping, and root-resolution tests |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Adding a source-evidence plugin](../../../docs/cookbook/building-a-source-evidence-plugin.md) — the complete package-development case.
- [Adding a tool](../../../docs/cookbook/adding-a-tool.md) — schema, execution, cancellation, and presentation contracts.
- [Adding a workspace package](../../../docs/cookbook/adding-a-package.md) — package metadata and verification.

-----

<a id="model-experience"></a>
## Model Experience

### Search and trace tools

#### What the model sees

The `revenue_search` and `revenue_trace` schemas are model-visible when this bundle is mounted and the tools are visible to the calling agent. Each call returns bounded evidence records or ordered heuristic groups.

#### Token effect

Tool descriptions add a small fixed prompt cost. Search results add only the bounded records returned by each call.

#### KV Cache effect

The tool descriptions remain prefix-stable. Each result is independent call output and does not rewrite earlier prompt content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Literal search only** — the package does not parse TypeScript, Java, XML, SQL, route registries, or call graphs.
- **Path classification is heuristic** — `revenue_trace` groups evidence by filenames and paths; it cannot prove that two matching symbols are connected.
- **No source index** — each call walks the configured roots again, so large repositories need tighter roots and bounds.
- **Private workspace package** — the current checkout uses patch overlays; a published install path requires a future publication decision.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The package is intentionally a single tool plugin plus Bundle patch. An indexed provider can replace the search implementation while preserving the model-facing result fields.

</details>
