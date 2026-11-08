# WebRPG Index

> 2026-11-08 新账号恢复：`list.json` 是唯一目录真源，旧账号的部署状态不作为新账号可玩证明。索引使用仓库内置 `GITHUB_TOKEN`，可独立运行。Fork/Pages 还需给新账号安装 GitHub App，配置 `WEBRPG_APP_CLIENT_ID` Variable、`WEBRPG_APP_PRIVATE_KEY` Secret，最后把 `WEBRPG_AUTOMATION_ENABLED` Variable 设置为 `true`。未满足时 Fork 会显示待配置并跳过，绝不表示游戏迁移成功。密钥仅在 GitHub Secrets 中填写。

## 全量恢复队列

一次任务覆盖整个真源目录，而不是固定处理五款后退出。执行前确认 GitHub CLI 当前登录的是目标账号；脚本只在内存读取已有登录，凭据不会写入目录、结果或 Actions Secret。

```bash
node scripts/migrate-all-games.mjs
DRY_RUN=false node scripts/migrate-all-games.mjs
```

首条命令只规划。恢复实际运行时仍执行第二条，已完成项会跳过。失败项逐项保存在被 Git 忽略的 `migration-state/progress.json`；修复具体故障后再执行：

```bash
DRY_RUN=false RETRY_BLOCKED=true node scripts/migrate-all-games.mjs
```

当前全量队列采用串行准备，Fork 间隔至少八秒；检查启用插件与入口脚本的大小写精确路径，保留扁平化前的根部署名文件，添加 `.nojekyll`，移除游戏 Fork 自带的 `CNAME`。LFS 文件先校验长度与 SHA-256，再保存成真实静态资源；单文件上限 95 MiB、静态站点预算 900 MiB。每个游戏单独占用临时目录并在结束后清理，不将全量游戏下载到本机或 VPS。

等待对应提交的 Pages 构建成功与 HTML 入口返回后，才使用并发安全的合并写入唯一 `list.json`；每十项变更触发一次门户部署，队列正常结束时补发剩余变更。`publication` 只表示构建和入口检查，`runtime.status=passed` 需要另外的浏览器实际操作证据，二者并不等价。队列不会伪造 `runtime`，新版提交也不会继承旧版的运行验证。

GitHub 返回 401、403 或 429 时保存进度并暂停新增操作，不循环绕开限制。恢复前先排查响应原因与账户额度。`hidden` 和原有 `invalid_structure` 保持原状态，不把非游戏仓库凑作可玩数量。此队列是本机显式启动的恢复进程，**不是已经配置完成的云端定时器**；长期 Actions 仍依赖上面的 App 配置。

参考：[GitHub REST API 最佳实践](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)、[Pages 使用限制](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)、[Git LFS](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-git-large-file-storage)。

## Scheduling

The only scheduled entry point is `index-github-rpgmaker-repos.yml`, using native cron `17 2 1,6,11,16,21,26 * *`: 10:17 Beijing on the 1st, 6th, 11th, 16th, 21st and 26th each month. There is no daily checker, no daily guard workflow and no sleeping/self-renewal chain. Most intervals are five days; month-end intervals are 3–6 days. This is a calendar-based low-frequency cadence, not a claim of exact 120-hour execution.

The index can also be run manually. Successful index completion triggers Fork (up to 40, eight-second spacing), then Prepare/Pages (up to 40, parallelism five), then canonical publication and a portal event. The portal has no polling cron. GitHub scheduling delays still apply; a failed/missed scheduled run does not create a daily retry. Failures are visible in Actions and may require a manual rerun.

`continuous-*.yml` are retained only for one-off manual recovery and no longer self-dispatch. `bulk-drain-pending.yml` processes one manually requested batch and no longer creates recursive batches. This prevents the index, fork, and validation workers from recursively consuming the same GitHub App API budget.

This repository hosts a JSON index of web-playable RPG Maker games found on GitHub.

Data file:

- `list.json`

The canonical publisher sorts by stable `id`; the portal applies its presentation ordering separately. Language metadata is intentionally omitted until it can be verified reliably.

## Fork Workflow

The index workflow runs on that low-frequency calendar or on manual request. It syncs upstream metadata and performs bounded repository search for RPG Maker candidates using the built-in repository token. Code search is preserved as a separate script but is not used by the default workflow. Repository search is discovery only, not proof of a playable export.

The `Fork listed repositories` workflow follows successful index completion or a manual request. It reads `list.json`, deduplicates source repositories, and forks up to 40 missing repositories into `opsemilygohmbza` with an eight-second creation interval. It does not recursively drain the queue.

The built-in token publishes catalog changes through a compare-and-swap Contents API update. A GitHub App is needed separately for cross-repository Fork/Pages operations. This recovery target is a personal account, not an organization.

The workflow waits between fork creation requests to avoid GitHub secondary rate limits. Defaults:

- `create_delay_seconds`: `8`
- `retry_limit`: `5`
- `retry_base_delay_seconds`: `60`

If GitHub still reports that requests were submitted too quickly, increase `CREATE_DELAY_SECONDS` in `.github/workflows/fork-listed-repos.yml`. Existing forks are detected and skipped.

Repositories are skipped when:

- The source repository is already forked into `opsemilygohmbza`.
- `opsemilygohmbza` already has a repository with the target fork name.
- The `list.json` entry is marked `invalid_structure`, `deleted_invalid_structure`, or `duplicate_name`.
- Another entry already uses the same repository name, even when the owner is different.

Fork names use this format:

```text
sourceOwner-sourceRepo
```

This avoids name collisions for common repository names such as `game`, `rpg`, and `github.io`.

## Prepare Fork Workflow

The `Prepare fork repositories` workflow runs automatically after the fork workflow succeeds. It processes up to 40 fork repositories with a maximum parallelism of five.

It validates the RPG Maker structure, optionally extracts a local cover image, and enables GitHub Pages from the repository default branch and `/`. It does not inject analytics or other third-party scripts.

Each matrix job has a 20-minute hard timeout. Repository HTML inspection prioritizes shallow `index*.html` entries, reads at most 120 candidates with a concurrency of five, and gives every GitHub API request a 30-second timeout. These limits prevent a single web-archive repository containing thousands of HTML files from blocking the entire 40-repository batch and its final `list.json` aggregation.

The public Pages URL path is determined by the repository name. For example, `opsemilygohmbza/example-game` is published at:

```text
https://yx.ecy.al/example-game/
```

This workflow uses a GitHub App token. Create and install a GitHub App on `opsemilygohmbza`, then add these Actions settings to this repository or to the organization with access granted to this repository:

- Variable: `WEBRPG_APP_CLIENT_ID`
- Secret: `WEBRPG_APP_PRIVATE_KEY`

Recommended GitHub App repository permissions:

- `Administration`: read and write
- `Contents`: read and write
- `Pages`: read and write
- `Metadata`: read-only

Install the App on the runner, the portal and games explicitly in scope. Selected-repositories installation does not automatically include new forks; add access before processing them. Fully unattended access to future forks requires a separately approved broader installation. Existing unrelated repositories are not implicitly in scope. Administration write is a broad permission; keeping deletion disabled in the scripts does not remove that permission's power.

After a changed canonical publication, the workflow requests a portal-only Contents write App token to send `catalog-updated`. It never copies the catalog into a second source. A notification failure fails the step; the saved canonical file remains intact and the portal deployment can be run manually. The new account's App credentials and selected repository installation are still external setup prerequisites.

After credentials are configured, the workflow runs without dry-run mode. Before that, the cross-repository phase is explicitly paused. Native GitHub schedules may be delayed or dropped; they are not an exact-time service guarantee.

During each run, the workflow validates every matching fork before preparing Pages. A fork is treated as valid only when it has an RPG Maker MV/MZ web structure, such as a HTML entry file plus the expected `js/rpg_core.js` or `js/rmmz_core.js` runtime files.

The supplied workflow keeps invalid forks (`DELETE_INVALID_REPOS=false`) for inspection instead of deleting them. The final aggregation job updates `list.json` with validation metadata:

- `status`: `verified` or `invalid_structure`
- `checkedAt`
- `forkName`
- `pagesUrl`
- `entryPath`
- `cover`
- `invalidReason`
- `deletedAt`

Cover URLs are inferred from files in the fork, prioritizing RPG Maker paths such as `icon/icon.png`, `img/titles1/*`, `img/titles2/*`, and `img/pictures/*`.

Entries marked `invalid_structure` are skipped by the fork workflow so they are not recreated on the next fork run.
