# WebRPG Index

> 2026-11-08 新账号恢复：`list.json` 是唯一目录真源，旧账号的部署状态不作为新账号可玩证明。索引使用仓库内置 `GITHUB_TOKEN`，可独立运行。Fork/Pages 还需给新账号安装 GitHub App，配置 `WEBRPG_APP_CLIENT_ID` Variable、`WEBRPG_APP_PRIVATE_KEY` Secret，最后把 `WEBRPG_AUTOMATION_ENABLED` Variable 设置为 `true`。未满足时 Fork 会显示待配置并跳过，绝不表示游戏迁移成功。密钥仅在 GitHub Secrets 中填写。

## Scheduling

The only automatic entry points are the native GitHub schedules in these two workflows:

- `index-github-rpgmaker-repos.yml`: hourly at minute 17.
- `fork-listed-repos.yml`: every 30 minutes.

`continuous-*.yml` are retained only for one-off manual recovery and no longer self-dispatch. `bulk-drain-pending.yml` processes one manually requested batch and no longer creates recursive batches. This prevents the index, fork, and validation workers from recursively consuming the same GitHub App API budget.

This repository hosts a JSON index of web-playable RPG Maker games found on GitHub.

Data file:

- `list.json`

The list is sorted by `title`. Language metadata is intentionally omitted until it can be verified reliably.

## Fork Workflow

The index workflow runs hourly at minute 17. It syncs upstream metadata and performs bounded repository search for RPG Maker candidates using the built-in repository token. Code search is preserved as a separate script but is not used by the default workflow. Repository search is discovery only, not proof of a playable export.

The `Fork listed repositories` workflow runs every 30 minutes. It reads `list.json`, deduplicates source repositories, and forks up to 40 missing repositories into `opsemilygohmbza` with an eight-second creation interval.

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
https://opsemilygohmbza.github.io/example-game/
```

This workflow uses a GitHub App token. Create and install a GitHub App on `opsemilygohmbza`, then add these Actions settings to this repository or to the organization with access granted to this repository:

- Variable: `WEBRPG_APP_CLIENT_ID`
- Secret: `WEBRPG_APP_PRIVATE_KEY`

Recommended GitHub App repository permissions:

- `Administration`: read and write
- `Contents`: read and write
- `Pages`: read and write
- `Metadata`: read-only

Install the App on all repositories in `opsemilygohmbza`. This matters because new fork repositories will be added over time; a selected-repositories installation will not automatically include new forks.

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
