# 实操手册：构建源码证据插件

[English](building-a-source-evidence-plugin.md) | 中文

## 概述

本手册以 `@deepseek-ai/dsh-experimental-revenue-source` 为完整案例，说明如何构建一个只读、面向模型的源码搜索插件。文档解释包清单、Cordis 入口、搜索引擎、测试、启动 overlay、TypeScript 项目文件、锁文件、生成目录和文档如何协同工作。案例为收益系统代码返回文件与行号证据，并将启发式链路分组与已证实的调用关系分开。开发需要受限本地数据源而不是新的 agent-loop 能力时，可以参考文件说明表。

## 内容导航

- [案例结果](#case-outcome)
- [步骤 1：定义包边界](#step-1-define-the-package-boundary)
- [步骤 2：注册面向模型的工具](#step-2-register-model-facing-tools)
- [步骤 3：隔离搜索引擎](#step-3-isolate-the-search-engine)
- [步骤 4：测试证据与分组](#step-4-test-evidence-and-grouping)
- [步骤 5：支持源码和构建启动器](#step-5-support-source-and-built-launchers)
- [步骤 6：注册 workspace 包](#step-6-register-the-workspace-package)
- [步骤 7：编写文档并验证包](#step-7-document-and-validate-the-package)
- [逐文件源码说明表](#file-by-file-source-map)
- [失败与恢复](#failure-and-recovery)
- [进一步阅读](#further-exploration)
- [开发备注](#dev-note)

-----

<a id="case-outcome"></a>
## 案例结果

这个案例在不修改 `agent-loop` 的情况下增加两个可见工具：`revenue_search` 执行有上限的字面搜索，`revenue_trace` 按可能的前端到后台顺序展示同一批证据。工具读取配置的根目录，跳过常见的生成目录或依赖目录，返回从 1 开始的行号，并在达到上限时标记结果已截断。包通过 Cordis patch 挂载，因此开发时可以运行 TypeScript 源码，完成 Host 构建后也可以运行 `lib/` 中的产物。

### 使用前提

读者应了解 TypeScript、Cordis 插件注册、`defineTool`，以及“面向模型的行为必须使用已记录扩展点”的仓库规则。复制这个案例前，请先阅读[添加工具](adding-a-tool.zh.md)了解通用工具约定，并阅读[添加 workspace 包](adding-a-package.zh.md)了解包清单。

### 可观察结果

挂载源码 patch 并配置收益代码根目录后，下面的请求会向模型提供结构化的 `file:line` 证据：

```text
请使用 revenue_trace 追踪 checkInterPriceDeviation，并给出前端、Controller、Service、Mapper 的文件路径和行号。
```

插件不会证明调用图。它为模型提供稳定证据和明确限制，使模型可以先阅读返回的文件，再作出判断。

-----

<a id="step-1-define-the-package-boundary"></a>
## 步骤 1：定义包边界

当一项能力的服务定义、实现和消费方不需要独立发布生命周期时，应将单一用途的能力放在一个包中。这个案例是 Host 侧 Cordis 插件，不是新的能力 seam：它消费 `tools`，注册两个工具，并拥有本地搜索算法。

### 包清单

[`packages/experimental/revenue-source/package.json`](../../packages/experimental/revenue-source/package.json) 声明一个 ESM workspace 包，包含仓库版本、`lib/index.js` 运行时产物、`lib/types/index.d.ts` 声明、`@deepseek-ai/cordis` 和 `@deepseek-ai/dsh-tools` 对等／开发依赖，以及作为运行时依赖的 `@deepseek-ai/schemastery`。`dsh.bundle.patch` 条目把包的构建 patch 指向插件；`private: true` 则使这个个人实验包不参与发布。

包清单是 workspace 安装、包清单解析、构建发现和文档检查使用的包身份。插件可以成功加载，但如果活动 Loader 条目无法解析到包清单，仍可能在请求扩展准备阶段失败；步骤 5 的启动 overlay 用来避免这个不一致。

### TypeScript 项目

[`packages/experimental/revenue-source/tsconfig.json`](../../packages/experimental/revenue-source/tsconfig.json) 将 `src` 设为源码根目录，将声明输出到 `lib/types`，并引用 Cordis、Schemastery 和 `dsh-tools` 项目。这些引用使包参与 Host solution，也让编译器使用源码平面的类型，而不是另造包内类型副本。

-----

<a id="step-2-register-model-facing-tools"></a>
## 步骤 2：注册面向模型的工具

[`packages/experimental/revenue-source/src/index.ts`](../../packages/experimental/revenue-source/src/index.ts) 是 Cordis 入口。它声明 `name`、注入 `tools`，使用 Schemastery 校验部署配置，定义规范的 JSON 输出 schema，并通过 `ctx.tools.register(defineTool(...))` 注册两个工具。

`revenue_search` 接收必填的字面查询、可选的配置根目录标签和可选的结果上限。它的规范输出包含规范化查询、根目录标签、绝对路径、从 1 开始的行号、压缩后的源码行、扫描文件数量和截断标记。`revenue_trace` 复用相同的执行路径，并把平面匹配列表替换为按顺序排列的 `frontend`、`controller`、`service`、`mapper`、`documentation` 和 `other` 分组。

`execute` 函数返回结构化值，`output.render` 生成简洁的面向模型文本。`presentCall` 只提供纯函数式的通用搜索卡片。这种拆分为 PTC 和回放保留了可编程结果，同时把 UI 格式化留在搜索算法之外。

插件把空的配置根目录列表转换为调用方 workspace。显式根目录可以是绝对路径，也可以是相对于 workspace 的路径；请求未知标签时会失败，而不会静默搜索其他目录。配置限制文件访问数量、文件字节数、保留匹配数和排除目录名称，不把部署环境的具体源码路径硬编码到实现中。

-----

<a id="step-3-isolate-the-search-engine"></a>
## 步骤 3：隔离搜索引擎

[`packages/experimental/revenue-source/src/search.ts`](../../packages/experimental/revenue-source/src/search.ts) 负责文件系统遍历和证据转换，因此 Cordis 入口只需要适配配置与工具约定。这种拆分让单元测试可以在不启动 agent harness 的情况下验证搜索行为。

搜索器在遍历前对目录项排序，只处理源码和文档扩展名，以不区分大小写的方式执行字面比较，压缩过长的匹配行，并记录从 1 开始的行号。它跳过 `.git`、`node_modules`、`dist` 和 `build` 等配置的目录基名。达到文件、字节或结果上限后，它返回 `truncated: true`，而不是把被截断的结果当成完整结果展示。

`resolveSourceRoots` 将相对路径解析到调用方 workspace。`classifySourceMatch` 只检查路径，`groupSourceMatches` 应用稳定的分组顺序。`Controller`、`Service`、`Mapper`、`repository`、`dao` 等名称以及类似前端的源码路径只能产生导航提示，不能证明文件之间存在运行时关系。

搜索循环会在处理目录和文件前检查 `AbortSignal`。调用方断开连接或模型轮次结束时，工具注册表就可以取消长时间遍历。该函数不会写文件、启动进程、调用网络服务，也不会在配置根目录出错后静默回退。

-----

<a id="step-4-test-evidence-and-grouping"></a>
## 步骤 4：测试证据与分组

[`packages/experimental/revenue-source/tests/search.spec.ts`](../../packages/experimental/revenue-source/tests/search.spec.ts) 测试未来重构可能意外削弱的行为。测试夹具证明匹配源码行会返回根目录、绝对路径、行号和压缩文本，同时排除目录中的 `node_modules` 匹配不会出现。第二个测试固定可能链路的分组顺序，第三个测试固定相对根目录的解析方式。

测试使用临时目录，并在 `afterEach` 中删除这些目录。测试的是纯搜索模块，而不是真实收益仓库，因此套件保持确定性，不依赖本机是否存在业务源码。如果未来改变 Cordis 注册、面向模型的 schema 或 patch 加载方式，应增加包级集成测试。

从仓库根目录运行专项测试：

```powershell
node_modules\\.bin\\vitest.cmd run packages/experimental/revenue-source/tests/search.spec.ts
```

-----

<a id="step-5-support-source-and-built-launchers"></a>
## 步骤 5：支持源码和构建启动器

两个 patch 文件对应不同的启动约定。[`cordis.source.patch.yml`](../../packages/experimental/revenue-source/cordis.source.patch.yml) 为 `tsx` 源码启动器插入 `./src/index.ts`。[`cordis.patch.yml`](../../packages/experimental/revenue-source/cordis.patch.yml) 为普通 Node 构建启动器插入 `./lib/index.js`。

相对文件入口很重要，因为包清单扩展会为文件入口解析最近的 `package.json`。裸包名可以通过 TypeScript 路径别名加载，但请求扩展准备阶段仍可能无法识别活动包。源码和构建 overlay 让 Loader 执行路径与包身份解析路径保持一致。

编辑源码时使用源码启动方式：

```powershell
pnpm dsh web --patch packages/experimental/revenue-source/cordis.source.patch.yml
```

完成 Host 构建后使用构建启动方式：

```powershell
pnpm run build:lib:host
node apps/cli/lib/bin.js web --patch packages/experimental/revenue-source/cordis.patch.yml
```

两个 patch 接受相同的包配置。把本地收益代码根目录配置在对应的插入条目中：

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

在构建 patch 中将入口改为 `./lib/index.js`。不要在源码启动器中使用构建 patch。

-----

<a id="step-6-register-the-workspace-package"></a>
## 步骤 6：注册 workspace 包

[`tsconfig.base.json`](../../tsconfig.base.json) 增加包的源码别名，[`tsconfig.host.json`](../../tsconfig.host.json) 将包的项目引用加入 Host aggregate。这些修改让源码消费者和 Host 构建看到该包；它们不能替代运行时挂载插件的 Cordis patch。

[`pnpm-lock.yaml`](../../pnpm-lock.yaml) 为包及其 workspace 依赖增加一个 workspace importer。应将这项修改限制为新的 importer，避免离线冻结安装静默升级无关的依赖范围。

包目录已经被仓库 workspace glob 覆盖。仍然需要包级项目引用，因为 TypeScript solution 构建使用显式 aggregate 成员关系。

-----

<a id="step-7-document-and-validate-the-package"></a>
## 步骤 7：编写文档并验证包

这组[包 README 配对文件](../../packages/experimental/revenue-source/README.zh.md)及其伴随记录说明配置、源码／构建启动命令、工具语义、面向模型的行为和限制。README 明确路径分类是启发式判断，并明确插件只读；它不承诺恢复语义调用图。

这组[生成配置目录配对文件](../config-catalog.zh.md)从包的 `Config` 声明生成。[`docs/config-catalog.i18n.yaml`](../config-catalog.i18n.yaml) 记录已经确认的双语配对。应从源码重新生成这些文件，不要手动编辑生成目录。

[`website/docs.ts`](../../website/docs.ts) 将这份配对的 cookbook 页面加入中英文文档导航。网站投影仍然是派生内容，因此不要编辑 `website/.generated/`。

实现理由归属于 [`2026-09-12-revenue-source-plugin.md`](../../.agents/notes/implemented/feature/2026-09-12-revenue-source-plugin.zh.md)。Agent Note 记录当前决策和被舍弃的替代方案；本手册保留逐文件的实践说明。

编辑后运行包和文档专项检查：

```powershell
node_modules\\.bin\\tsc.cmd -b packages/experimental/revenue-source/tsconfig.json --pretty false
node_modules\\.bin\\tsc.cmd -b tsconfig.host.json --pretty false
node_modules\\.bin\\tsx.cmd scripts/gen-config-catalog.ts --check
node_modules\\.bin\\tsx.cmd scripts/verify-translation-pairing.ts --write docs/cookbook/building-a-source-evidence-plugin.md
node_modules\\.bin\\tsx.cmd scripts/verify-translation-pairing.ts
git diff --check
```

不需要模型 key 也可以检查源码和构建 patch：使用 `--dump-config` 输出组合后的 profile。成功输出应在指定 patch 下显示插件文件 URL。

-----

<a id="file-by-file-source-map"></a>
## 逐文件源码说明表

下表覆盖本次插件修改中所有已跟踪或已编写的文件。生成的目录文件和锁文件也列出，因为它们属于包的仓库约定；被忽略的 `lib/` 产物和包内 `node_modules/` 仍是构建产物，不是源码文件。

| 文件 | 为什么存在 | 负责内容 |
|---|---|---|
| [`package.json`](../../packages/experimental/revenue-source/package.json) | 为 workspace 和 Loader 提供有效的包身份。 | ESM 元数据、依赖、导出、构建产物和 bundle patch 声明。 |
| [`tsconfig.json`](../../packages/experimental/revenue-source/tsconfig.json) | 让包成为显式 TypeScript 项目。 | 源码根目录、声明输出和项目引用。 |
| [`src/index.ts`](../../packages/experimental/revenue-source/src/index.ts) | 将能力连接到 Cordis 和 `dsh-tools`。 | 配置校验、工具 schema、执行、渲染和根目录选择。 |
| [`src/search.ts`](../../packages/experimental/revenue-source/src/search.ts) | 将文件系统行为与插件 wiring 分开。 | 遍历、过滤、限制、取消、证据记录和启发式分组。 |
| [`tests/search.spec.ts`](../../packages/experimental/revenue-source/tests/search.spec.ts) | 使用确定性夹具保护搜索行为。 | 文件行证据、排除目录、分组顺序和相对根目录行为。 |
| [`cordis.source.patch.yml`](../../packages/experimental/revenue-source/cordis.source.patch.yml) | 在 `tsx` 开发期间加载源码。 | 相对的 `./src/index.ts` Loader 入口。 |
| [`cordis.patch.yml`](../../packages/experimental/revenue-source/cordis.patch.yml) | 在普通 Node 下加载构建插件。 | 相对的 `./lib/index.js` Loader 入口。 |
| [`tsconfig.base.json`](../../tsconfig.base.json) | 让源码平面消费者解析包名。 | 新包的源码别名。 |
| [`tsconfig.host.json`](../../tsconfig.host.json) | 将包加入 Host solution 构建。 | 显式项目引用。 |
| [`pnpm-lock.yaml`](../../pnpm-lock.yaml) | 使 workspace 冻结安装可复现。 | 包的 workspace importer 和 workspace 依赖链接。 |
| [包 README 配对文件](../../packages/experimental/revenue-source/README.zh.md) | 向包消费者提供约定和限制。 | 挂载、配置、模型体验和支持的用法。 |
| [配置目录配对文件](../config-catalog.zh.md) | 为生成的配置参考增加源码条目。 | 提取出的 `Config` 声明和源码链接。 |
| [`website/docs.ts`](../../website/docs.ts) | 让这个开发案例可以被发现。 | Cookbook 导航和网站投影映射。 |
| [Agent Note](../../.agents/notes/implemented/feature/2026-09-12-revenue-source-plugin.zh.md) 及配对文件 | 将决策理由与操作步骤分开保存。 | 选定的包拓扑、只读范围和替代方案。 |

-----

<a id="failure-and-recovery"></a>
## 失败与恢复

如果真实模型请求失败，并显示 `DeepSeek request extension preparation failed` 和 `REQUEST_EXTENSION`，请先检查 patch 入口，不要先修改工具代码。这个案例最常见的原因是源码 patch 使用了裸包名：TypeScript 可以解析源码别名，但包清单扩展无法通过 Node 包搜索路径找到活动包清单。使用 `pnpm dsh` 时切换到 `cordis.source.patch.yml`，完成 Host 构建后切换到 `cordis.patch.yml`，然后使用 `--dump-config` 确认组合后的 profile。

如果工具没有返回匹配项，请检查配置的根目录标签和路径。`roots` 为空时只搜索调用方 workspace；从本 checkout 启动时，该 workspace 是 harness 仓库。如果结果包含 `truncated: true`，请缩小根目录或查询更具体的符号，再作出结论。

-----

<a id="further-exploration"></a>
## 进一步阅读

- [添加工具](adding-a-tool.zh.md) — 通用 schema、执行、取消和展示约定。
- [添加 workspace 包](adding-a-package.zh.md) — 包元数据、TypeScript 引用、README 门禁和验证。
- [扩展模式](extension-cookbook.zh.md) — Cordis effect、hook 和扩展点组合。
- [DeepSeek Harness 架构](../architecture.zh.md) — 包组合和已记录扩展点。

-----

<a id="dev-note"></a>
## 开发备注

None.
