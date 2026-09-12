---
description: "面向收益系统工作区的私有 profile 组合包，提供有上限的只读源码证据搜索与前端到后台候选链路追踪。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-revenue-source

[English](README.md) | 中文

## 概述

这个私有组合包向 profile 增加两个只读的模型工具：`revenue_search` 返回带文件路径和行号的字面匹配，`revenue_trace` 将匹配结果按前端、Controller、Service、Mapper 和文档分组，形成候选的前端到后台链路。开发时使用源码 patch，完成 Host 构建后使用构建 patch。目标源码位于调用方 workspace 之外时，请配置根目录。包提供证据和导航提示，不恢复语义调用图。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

这个包只在当前 checkout 中使用，因此应使用 patch overlay，而不是已发布包安装命令。源码开发时使用 `cordis.source.patch.yml`；完成 Host 构建后使用 `cordis.patch.yml`：

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

`roots` 为空时搜索当前 agent 工作区。根目录可以是绝对路径，也可以是相对于调用工作区的路径。插件不会写文件、启动进程或发送网络请求。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

组合包插入一个相对 Loader 入口。源码 patch 指向 `./src/index.ts`，构建 patch 指向 `./lib/index.js`；两个入口都通过最近的 `package.json` 保持包清单解析。入口插件负责校验配置和注册工具，`src/search.ts` 负责文件系统遍历、上限、取消信号和启发式分组。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`cordis.source.patch.yml`](cordis.source.patch.yml) | `tsx` 启动器使用的源码模式 Loader 入口 |
| [`cordis.patch.yml`](cordis.patch.yml) | 普通 Node 使用的构建模式 Loader 入口 |
| [`src/index.ts`](src/index.ts) | 配置和面向模型的工具注册 |
| [`src/search.ts`](src/search.ts) | 只读搜索、证据记录和路径分类 |
| [`tests/search.spec.ts`](tests/search.spec.ts) | 文件行、排除、分组和根目录解析测试 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [添加源码证据插件](../../../docs/cookbook/building-a-source-evidence-plugin.zh.md)——完整的包开发案例。
- [添加工具](../../../docs/cookbook/adding-a-tool.zh.md)——schema、执行、取消和展示约定。
- [添加 workspace 包](../../../docs/cookbook/adding-a-package.zh.md)——包元数据和验证。

-----

<a id="model-experience"></a>
## 模型体验

### 搜索与追踪工具

#### 模型看到的内容

挂载这个组合包且工具对调用中的 agent 可见时，模型可以看到 `revenue_search` 和 `revenue_trace` 的 schema。每次调用返回有上限的证据记录或按顺序排列的启发式分组。

#### Token 影响

工具描述增加少量固定 prompt 成本；搜索结果只增加本次调用返回的受限记录。

#### KV Cache 影响

工具描述保持前缀稳定。每次结果都是独立的调用输出，不会改写之前的 prompt 内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **目前只有字面搜索**——本包不解析 TypeScript、Java、XML、SQL、路由注册表或调用图。
- **路径分类是启发式的**——`revenue_trace` 根据文件名和路径分组，不能证明两个匹配符号存在调用关系。
- **没有源码索引**——每次调用都会重新遍历配置根目录，大型仓库需要收紧根目录和各项上限。
- **私有 workspace 包**——当前 checkout 使用 patch overlay；发布安装路径需要未来单独决定。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

这个包有意保持为一个工具插件加一个 Bundle patch。带索引的 Provider 可以在保持模型侧返回字段不变的情况下替换搜索实现。

</details>
