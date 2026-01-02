# 依赖更新自动化

本项目实现了自动化依赖更新系统，可以自动检查并更新所有依赖包到最新稳定版本，并自动创建 Pull Request。

## 📋 目录

- [概述](#概述)
- [两种更新方式](#两种更新方式)
  - [Dependabot](#dependabot)
  - [自定义工作流](#自定义工作流)
- [如何使用](#如何使用)
- [配置说明](#配置说明)
- [常见问题](#常见问题)

## 概述

项目包含两种依赖更新机制：

1. **Dependabot**：GitHub 原生的依赖更新工具，按依赖项逐个创建 PR
2. **自定义工作流**：基于 npm-check-updates 的批量更新工作流，一次性更新所有依赖

## 两种更新方式

### Dependabot

**配置文件**：`.github/dependabot.yml`

**特点**：
- ✅ GitHub 原生支持，零配置运行
- ✅ 每个依赖单独创建 PR，便于审查
- ✅ 自动检测安全漏洞
- ✅ 支持多种包管理器
- ⏰ 每周一自动运行

**更新范围**：
- Express 后端依赖（`/express-project`）
- Vue3 前端依赖（`/vue3-project`）
- GitHub Actions 依赖

**PR 配置**：
- 最多同时打开 10 个 PR（npm 依赖）
- 最多同时打开 5 个 PR（GitHub Actions）
- 自动添加标签：`dependencies`、`backend`、`frontend`、`github-actions`
- 提交信息格式：`chore(deps): update xxx`

### 自定义工作流

**配置文件**：`.github/workflows/update-dependencies.yml`

**特点**：
- ✅ 一次性更新所有依赖到最新版本
- ✅ 支持手动触发，可选择更新范围
- ✅ 自动生成详细的变更摘要
- ✅ 更激进的更新策略
- ⏰ 每周一自动运行

**更新策略**：
使用 `npm-check-updates` (ncu) 将所有依赖更新到最新稳定版本，包括主版本更新。

## 如何使用

### 方式一：等待自动运行

两个系统都会在**每周一 08:00 UTC**自动运行，检查并创建更新 PR。

### 方式二：手动触发自定义工作流

1. 进入 GitHub 仓库的 **Actions** 页面
2. 选择 **Update Dependencies to Latest** 工作流
3. 点击 **Run workflow** 按钮
4. 选择更新目标：
   - `all`：更新前端和后端所有依赖
   - `frontend`：仅更新前端依赖
   - `backend`：仅更新后端依赖
5. 点击 **Run workflow** 开始执行

### 方式三：审查和合并 PR

当有依赖更新 PR 创建后：

1. **查看 PR 详情**：
   - 查看更新的依赖列表
   - 检查版本变更情况
   - 阅读依赖的 Changelog

2. **测试变更**：
   ```bash
   # 拉取 PR 分支
   git fetch origin
   git checkout <pr-branch>
   
   # 安装依赖
   cd vue3-project && npm ci
   cd ../express-project && npm ci
   
   # 构建项目
   cd vue3-project && npm run build
   cd ../express-project && npm run build
   
   # 运行测试
   npm test  # 如果有测试
   
   # 本地运行验证
   npm run dev
   ```

3. **合并 PR**：
   - 确认测试通过后合并 PR
   - 如果有问题，可以在 PR 中讨论或关闭

## 配置说明

### Dependabot 配置

修改 `.github/dependabot.yml` 来自定义 Dependabot 行为：

```yaml
# 修改运行时间
schedule:
  interval: "weekly"
  day: "monday"
  time: "08:00"

# 修改同时打开的 PR 数量
open-pull-requests-limit: 10

# 修改审阅者
reviewers:
  - "your-username"
```

### 自定义工作流配置

修改 `.github/workflows/update-dependencies.yml` 来自定义工作流行为：

```yaml
# 修改运行时间
on:
  schedule:
    - cron: '0 8 * * 1'  # 每周一 08:00 UTC

# 修改 ncu 更新策略
run: ncu -u --target latest  # 更新到最新版本
run: ncu -u --target minor   # 只更新小版本
```

## 常见问题

### Q: 两种方式有什么区别？

**A**: 
- **Dependabot**：适合稳健更新，每个依赖独立审查，推荐用于生产环境
- **自定义工作流**：适合快速更新，批量升级所有依赖，适合开发环境或定期大更新

### Q: 更新后构建失败怎么办？

**A**: 
1. 查看 PR 中的构建日志，定位失败原因
2. 检查是否有重大版本变更（Breaking Changes）
3. 查阅相关依赖的迁移指南
4. 如果无法修复，可以先回退该依赖版本

### Q: 如何禁用某个依赖的自动更新？

**A**: 
对于 Dependabot，在 `.github/dependabot.yml` 中添加：

```yaml
updates:
  - package-ecosystem: "npm"
    directory: "/express-project"
    ignore:
      - dependency-name: "axios"
        update-types: ["version-update:semver-major"]
```

### Q: 更新频率太高怎么办？

**A**: 
可以修改运行频率：

```yaml
schedule:
  interval: "monthly"  # 改为每月
```

### Q: 如何查看更新历史？

**A**: 
1. 在 GitHub Actions 页面查看工作流运行历史
2. 在 Pull Requests 页面筛选 `dependencies` 标签
3. 查看已合并的 PR 获取历史更新记录

## 最佳实践

1. **渐进式更新**：优先合并 Dependabot 的单个依赖更新，定期使用自定义工作流做全量更新
2. **测试覆盖**：确保有充分的测试覆盖，自动化测试可以快速发现问题
3. **版本锁定**：对于关键依赖，考虑使用 `package-lock.json` 锁定版本
4. **监控日志**：关注更新后的应用日志，及时发现运行时问题
5. **定期审查**：即使自动更新，也要定期审查依赖的安全公告和变更日志

## 相关资源

- [Dependabot 官方文档](https://docs.github.com/en/code-security/dependabot)
- [npm-check-updates 文档](https://github.com/raineorshine/npm-check-updates)
- [GitHub Actions 文档](https://docs.github.com/en/actions)
- [语义化版本规范](https://semver.org/lang/zh-CN/)

---

**维护者注意**：本文档随依赖更新系统配置的变化而更新。如有问题，请提交 Issue。
