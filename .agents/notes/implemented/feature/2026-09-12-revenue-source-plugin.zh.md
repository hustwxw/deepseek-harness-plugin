# Agent Note: 收益源码证据使用有上限的只读 Host 插件

Status: implemented

[English](2026-09-12-revenue-source-plugin.md) | 中文

## Problem

收益系统调查需要跨前端工作区和一个或多个 Java 后台根目录获取文件与行号证据。通用文件搜索可以找到文本，但不能提供稳定的工具名、配置根目录标签、有上限的证据记录，或让模型可以直接请求的前端到后台初步视图。

## Decision

`@deepseek-ai/dsh-experimental-revenue-source` 是一个私有的 Host 侧 Cordis 插件。它消费 `tools`，注册 `revenue_search` 和 `revenue_trace`，并将文件系统遍历放在独立模块中。`revenue_search` 返回字面文件行证据。`revenue_trace` 复用这些证据，并按路径将匹配项分为前端、Controller、Service、Mapper、文档或其他类别。

插件接受带标签的根目录配置和有上限的遍历设置。根目录列表为空时表示调用方 workspace。实现只读，检查取消信号，跳过常见的依赖目录和构建目录，并在达到上限时标记结果已截断。路径分类只用于导航，不证明调用关系。

包提供独立的源码和构建 Cordis patch 文件。源码 patch 通过 `tsx` 启动器加载 `./src/index.ts`。构建 patch 通过普通 Node 加载 `./lib/index.js`。相对文件入口让包清单扩展可以解析最近的包清单，使 Loader 执行路径与请求扩展的包身份路径保持一致。

包参与 Host TypeScript aggregate，拥有冻结安装所需的 workspace importer，并维护配对的包 README。生成的配置目录仍从 `Config` 声明派生，逐文件开发流程由 cookbook 负责。

## Consequences

模型可以请求一个领域专用搜索工具，并在不修改 `agent-loop` 的情况下获得稳定证据字段。目标源码位于调用方 workspace 之外时，部署必须配置根目录。宽泛查询可能在配置上限处停止，因此调用方必须先检查 `truncated`，再把结果视为完整结果。语义调用图恢复不属于本包。

源码和构建 patch 增加了两个需要维护的启动文件，但可以避免源码 TypeScript 别名通过 Loader 启动后，在请求扩展准备阶段才失败。包保持搜索引擎无需启动 Cordis 即可测试，并将 UI 展示与规范工具结果分开。

## Alternatives considered

**只使用通用文件搜索。** 不采用，因为模型需要为每次收益调查自行选择路径和搜索参数，结果也不会携带稳定的领域证据约定。

**语义索引或调用图分析器。** 不在本包中采用，因为 JavaScript、TypeScript、Java、XML、SQL 和生成的前端代码需要不同的解析器与构建上下文。字面证据可以立即使用，语义确认留给源码阅读。

**在源码 patch 中使用裸包名。** 不采用，因为 TypeScript 路径别名可以加载模块，但包清单扩展仍无法通过 Node 包搜索路径解析其所属包清单。相对文件入口明确了包身份解析路径。

**修改 `agent-loop`，增加收益搜索专用阶段。** 不采用，因为这项行为属于面向模型的工具能力，仓库扩展规则要求新工具行为放在插件中，而不是循环中。

## Testing

包测试覆盖文件行证据、排除目录、稳定分组顺序和相对根目录解析。源码和构建 patch 通过 profile 组合输出加载。包级 TypeScript 项目和 Host aggregate 均可编译，生成配置目录保持最新，双语配对保持一致，所编写修改通过 `git diff --check`。
