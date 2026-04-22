[English](#gitlab-pipeline-stats) | [Русский](#gitlab-pipeline-stats-1)

# gitlab-pipeline-stats

[![npm](https://img.shields.io/npm/v/gitlab-pipeline-stats.svg)](https://www.npmjs.com/package/gitlab-pipeline-stats)
[![GitHub](https://img.shields.io/badge/GitHub-sergeychernov%2Fgitlab-181717?logo=github)](https://github.com/sergeychernov/gitlab)

- Source code: [github.com/sergeychernov/gitlab](https://github.com/sergeychernov/gitlab)
- npm package: [npmjs.com/package/gitlab-pipeline-stats](https://www.npmjs.com/package/gitlab-pipeline-stats)

Quick stats for the latest N GitLab pipelines.  
For every job it computes `count / avg / p50 / p95 / max` of execution duration.

Pipelines are grouped by type (e.g. `main` / `develop` / `release/*` / `feature/*` / `tags`); each group gets its own table. Groups are defined by a **JSON config file**. The package ships a set of **bundled presets** (gitflow, github-flow, trunk) — generate a starter config from any of them with `init` and tweak it under version control. All presets assume the default branch is `main`; if you still use `master`, see [the note below](#bundled-presets).

## Installation

**Globally:**
```sh
npm install -g gitlab-pipeline-stats
# Yarn 1.x (rare): yarn global add gitlab-pipeline-stats
```

**Without installing (one-off run):**
```sh
npx gitlab-pipeline-stats <PROJECT_ID>
yarn dlx gitlab-pipeline-stats <PROJECT_ID>   # Yarn 2+ (Berry); use npx with Yarn 1
```

**Locally as a devDependency:**
```sh
npm install --save-dev gitlab-pipeline-stats
yarn add -D gitlab-pipeline-stats
```
After installation the binary is available as `yarn gitlab-pipeline-stats …` or via a `package.json` script:
```json
// package.json
"scripts": {
  "pipeline-stats": "gitlab-pipeline-stats <PROJECT_ID>"
}
```
Run with: `yarn pipeline-stats` (or `npm run pipeline-stats`).

Requires **Node.js ≥ 20.11.0** to run the published npm package (`dist/*.js`).  
Running TypeScript sources directly (`node bin/gitlab-pipeline-stats.ts`) requires **Node.js 24+** (native type stripping). No runtime dependencies.

## Usage

```sh
gitlab-pipeline-stats [PROJECT_ID] [options]
gitlab-pipeline-stats init <preset>           # print a bundled preset to stdout
gitlab-pipeline-stats list-presets            # show bundled presets
gitlab-pipeline-stats --help
```

`PROJECT_ID` — numeric ID or url-encoded path (e.g. `frontend%2Fmy-app`). The ID is shown on the project's main page in GitLab under the project name.

### Auto-detection of `--host` and `PROJECT_ID`

Both `--host` and `PROJECT_ID` are **optional** when they can be auto-detected.

**`--host` / `GITLAB_HOST`** (in priority order):

1. **Inside GitLab CI** — taken from `CI_SERVER_URL`.
2. **Inside a cloned repository** — parsed from `git remote get-url origin`. HTTPS and SSH formats are supported (`git@host:...`, `ssh://git@host/...`); the GitLab API is always called over `https://`.

**`PROJECT_ID`** (in priority order):

1. **Inside GitLab CI** — taken from `CI_PROJECT_PATH` or `CI_PROJECT_ID`.
2. **Inside a cloned repository** — parsed from `git remote get-url origin`. The host from origin must match `--host` / `GITLAB_HOST` (after auto-detection it always does).

An explicit value always wins over auto-detection. The source is shown in the info header:

```
GitLab:      https://gitlab.example.com (from git remote)
Project:     frontend%2Fmy-app (from git remote)
```

So in the typical "cd into repo → run" case a single command is enough:

```sh
GITLAB_TOKEN=glpat-xxx gitlab-pipeline-stats
```

### Options and environment variables

Each option can be set in three ways (in decreasing priority):
**CLI flag** → **environment variable** → **`.env` in `cwd`** → default.

| Flag                       | Env                            | Required | Default | Description |
|----------------------------|--------------------------------|:---:|---|---|
| `--config <path>`          | `GITLAB_PIPELINE_STATS_CONFIG` | ✓² | `./gitlab-pipeline-stats.json` | Path to a JSON groups config. Bundled preset names are **not** accepted — use `init <preset>` to materialize a file. |
| `--host <url>`             | `GITLAB_HOST`                  | | auto¹ | GitLab host without trailing `/` |
| `--token <token>`          | `GITLAB_TOKEN`                 | ✓ | — | Personal Access Token (scope `read_api`) |
| `--limit <n>`              | `PIPELINE_LIMIT`               | | `50` | Pipelines per group **after** client-side filters. If a group has `refPattern` / `excludeRef` / `excludeRefPattern`, the tool paginates (cap: 10×limit scanned) until exactly `n` matching pipelines are collected. |
| `--status-filter <status>` | `JOB_STATUS_FILTER`            | | `success` | Job status filter (empty — no filter) |
| `--section`                | —                              | | off | Drill into GitLab CI [section markers](#drill-into-job-sections) inside each job log |
| `--section-filter <regex>` | —                              | | — | Show only sections whose name matches the regex |
| `--section-job-filter <regex>` | —                          | | — | Limit drill-down to jobs whose name matches the regex (perf) |
| `--section-order <mode>`   | —                              | | `appearance` | Section row sort: `appearance` \| `p50` \| `name` |
| `--section-builtins`       | —                              | | off | Also show built-in sections emitted around your code by the toolchain — gitlab-runner stages (`step_script`, `get_sources`, `upload_artifacts_on_success`, …) and Yarn Berry (`resolution_step`, `fetch_step`, `link_step`, `_tmp_xfs_<hex>_build_log`, …). OFF by default — only user sections from your `script:` are shown. |
| `--warnings`               | —                              | | off | Print non-fatal warnings to stderr (failed trace fetches, unclosed section markers, etc.). OFF by default — output stays clean. |
| `-h`, `--help`             | —                              | | | Show help |

¹ Auto-detection via `CI_SERVER_URL` or `git remote`. If neither works, the flag becomes required.  
² A config is required, but the path can come from `--config`, the env var, or — by default — `./gitlab-pipeline-stats.json` in the current directory. If none of these is available, the tool exits with an error.

## Config file

A config is **always a JSON file** (`--config` does **not** accept preset names anymore). The package bundles a few presets you can dump into a file with `init` and then commit / edit:

```sh
gitlab-pipeline-stats init gitflow > gitlab-pipeline-stats.json
git add gitlab-pipeline-stats.json
gitlab-pipeline-stats 261                                   # picks ./gitlab-pipeline-stats.json
gitlab-pipeline-stats 261 --config ./ci/groups.json         # explicit path
```

Resolution order for the config (first match wins):

1. `--config <path>`
2. env `GITLAB_PIPELINE_STATS_CONFIG=<path>`
3. `./gitlab-pipeline-stats.json` in the current working directory

If none of these resolves to a file, the tool exits with an error and a hint about `init`.

## Bundled presets

Three starter presets ship with the package. Pick the one that matches your flow, dump it into a JSON file via `init`, then point `--config` at it (or commit it as `./gitlab-pipeline-stats.json` in the repo root).

> **Note: `master` vs `main`.** All bundled presets assume the default branch is `main`. If your repository still uses the legacy `master`, after `init` open the generated `gitlab-pipeline-stats.json` and replace every `"main"` with `"master"` in `ref` / `excludeRef` / `label` fields. The tool itself does not know your default branch — the config is the source of truth.

### `gitflow` ([Vincent Driessen, 2010](https://nvie.com/posts/a-successful-git-branching-model/))

The "fullest" model: long-lived `main` and `develop`, short-lived `release/*`, `feature/*`, `hotfix/*`; releases are tagged. Suitable for complex products with a fixed release cadence and parallel support of several versions.

```sh
gitlab-pipeline-stats init gitflow > gitlab-pipeline-stats.json
gitlab-pipeline-stats 261
```

Groups: `main`, `develop`, `release/*`, `feature/*`, `hotfix/*`, `tags`.

### `github-flow` ([GitHub, 2011](https://docs.github.com/en/get-started/using-github/github-flow))

Minimal model: a single `main`, everything else is short-lived feature branches; releases are tagged. Deploy usually happens after merging into `main`. Suits web apps and SaaS with CD.

```sh
gitlab-pipeline-stats init github-flow > gitlab-pipeline-stats.json
```

Groups: `main`, `feature branches`, `tags`.

### `trunk` (Trunk-based development)

Even simpler: a single "trunk" (`main`) where any change lands fast (hours/days). Releases — via CD straight from `main`; tags are optional and not tracked here. Best for teams with feature flags and a mature CI/CD.

```sh
gitlab-pipeline-stats init trunk > gitlab-pipeline-stats.json
```

Groups: `main`, `short-lived branches`.

### Listing and viewing presets

```sh
gitlab-pipeline-stats list-presets             # name + short description for each
gitlab-pipeline-stats init gitflow             # prints JSON to stdout
gitlab-pipeline-stats init gitflow > gitlab-pipeline-stats.json   # redirect to a file and tweak
```

## Config schema

```jsonc
{
    "$schema": "https://cdn.jsdelivr.net/npm/gitlab-pipeline-stats@latest/schemas/config.schema.json",
    "description": "Free-form description (optional)",
    "groups": [
        {
            "label": "main",                      // required: table heading
            "ref": "main",                        // server-side: exact ref name (no wildcards)
            "scope": "branches",                  // server-side: branches | tags | finished | running | pending
            "source": "push",                     // server-side: push | web | trigger | schedule | api | merge_request_event | ...
            "status": "success",                  // server-side: success | failed | canceled | ...
            "refPattern": "^release/",            // client-side: regexp matched against ref
            "excludeRef": "main",                 // client-side: exact ref to exclude
            "excludeRefPattern": "^dependabot/"   // client-side: regexp to exclude
        }
    ]
}
```

Every field except `label` is optional. **Server-side filters** are forwarded straight to the GitLab API (`/projects/:id/pipelines?scope=...&ref=...`); **client-side** ones are applied to the response. Wildcards in `ref` are not supported by the GitLab API — use `scope: "branches"` + `refPattern: "^release/"` instead.

> **Note: `scope: "branches"` and merge requests.** GitLab API's `scope=branches` returns only branch-ref pipelines. Merge-request pipelines (`source = merge_request_event`, ref = `refs/merge-requests/<n>/head`) are **not** included — if you have jobs that only run on MRs (`rules:if: $CI_PIPELINE_SOURCE == "merge_request_event"`), add a separate group `{ "label": "merge requests", "source": "merge_request_event" }`. All bundled presets already include it.

### `$schema` and IDE support

Bundled presets ship with a `$schema` field pointing to the JSON schema for this config format ([`schemas/config.schema.json`](./schemas/config.schema.json)). When you run `init`, the relative path inside the bundle is automatically rewritten to a stable CDN URL pinned to your installed CLI version, e.g.:

```jsonc
"$schema": "https://cdn.jsdelivr.net/npm/gitlab-pipeline-stats@1.1.2/schemas/config.schema.json"
```

This gives you autocompletion, enum hints (`scope`, `source`, `status`) and typo detection in any editor that supports JSON Schema (VSCode, Cursor, JetBrains, etc.) — no extra setup. The schema is purely an editor-time hint; the CLI ships its own runtime validator and ignores `$schema`.

### Group examples

```jsonc
// all pipelines exactly on main
{ "label": "main", "ref": "main" }

// all tags
{ "label": "tags", "scope": "tags" }

// release/v1, release/v2.x — by regexp
{ "label": "release/*", "scope": "branches", "refPattern": "^release/" }

// all branches except main and dependabot
{ "label": "feature", "scope": "branches", "excludeRef": "main", "excludeRefPattern": "^dependabot/" }

// only successful pipelines from schedule trigger on main
{ "label": "nightly", "ref": "main", "source": "schedule", "status": "success" }
```

## Config via `.env`

```sh
cp .env.example .env
# fill GITLAB_HOST and GITLAB_TOKEN
gitlab-pipeline-stats 261
```

## Drill into job sections

GitLab CI supports collapsible sections in job logs via ANSI markers. If your team instruments `before_script`/`script` with these markers (typically via a small `section()` bash helper, [example below](#instrumenting-jobs-with-sections)), the marker boundaries also encode start/end Unix timestamps — i.e. each section comes with its own duration. `gitlab-pipeline-stats --section` parses those markers from job traces and prints per-section breakdown under each job row.

```sh
gitlab-pipeline-stats --section
gitlab-pipeline-stats --section --section-filter '^build|^deploy'
gitlab-pipeline-stats --section --section-job-filter '^(build|deploy-)'
```

Default behaviour is unchanged: **without** `--section` the tool makes zero `/trace` requests and produces exactly the same output as before. With `--section` enabled it additionally fetches `/projects/:id/jobs/:job_id/trace` for each job that passed the status filter (and matches `--section-job-filter`, if set), parses section markers and renders them indented under the job row in the order they first appeared in the build flow:

```
=== main ===
JOB                                                    N   avg(s)  p50(s)  p95(s)  max(s)
build                                                 33      401     406     490     570
  ├─ ssh_keys                                         33        2       2       3       5
  ├─ check_deps                                       33        4       4       6      10
  ├─ submodules                                       33        8       7      12      20
  ├─ install                                          33       38      36      62      90
  ├─ test                                             33       71      70     110     150
  ├─ gatsby_build                                     33      198     195     270     320
  └─ pdf_buffers                                      33       11      11      18      22
deploy-cdn                                            27      275     257     404     420
  ├─ helm_setup                                       27       15      14      22      30
  └─ upload                                           27      255     240     380     400
TOTAL pipeline (wall)                                 50      724     719     969    1082
Sections found in 60/60 jobs
```

Notes:

- The same `read_api` token scope is sufficient — no extra permissions needed.
- Sections are aggregated per `(job_name, section_name)`. If the same section repeats inside a single job run, durations are summed before being added to the sample.
- For `--section-order appearance` (the default) sections of a job are displayed in the order their first start marker appeared in the first scanned trace; sections that appear only in later pipelines are appended at the end.
- Built-in sections that the toolchain wraps around your code are **hidden by default** — usually only your own sections from `script:` are interesting. Hidden out of the box are: gitlab-runner stages (`step_script`, `get_sources`, `upload_artifacts_on_success`, etc.) and Yarn Berry sections (`resolution_step`, `fetch_step`, `link_step`, `_tmp_xfs_<hex>_build_log`, etc.). Pass `--section-builtins` to also include them in the breakdown.
- If a job was killed mid-section (start without a matching end), the orphan is silently dropped. Pass `--warnings` to surface such cases (and other non-fatal issues like failed `/trace` fetches) on stderr.
- GitLab can truncate traces (default 4 MB), but section markers are short and almost always survive truncation.
- Performance: with `--limit 50` and ~7 jobs per pipeline that's ~350 trace GETs per group. Requests run in parallel with a fixed concurrency of 8 — tight enough not to hammer the API, while still finishing fast. Tighten the scan with `--section-job-filter` if you only care about a couple of heavy jobs.
- If `--section` is on but no markers are found, the tool prints the regular job table plus a hint like `Sections found in 0/27 jobs (no instrumentation?)`.

### Instrumenting jobs with sections

To make `--section` useful you need to wrap the interesting steps in your `before_script`/`script` with section markers. The package ships a ready-made bash helper at [`share/section.sh`](./share/section.sh), so you don't have to copy-paste it into every repo.

**If `gitlab-pipeline-stats` is already a `devDependency` of your project**, just `source` it from `node_modules` — no extra download step:

```yaml
build:
  before_script:
    - source node_modules/gitlab-pipeline-stats/share/section.sh
  script:
    - section install      yarn install --frozen-lockfile
    - section test         yarn test
    - section gatsby_build yarn build
```

**If the job runs without `node_modules` available** (e.g. a build-image without npm), grab the file directly from the published tarball or from the repo:

```yaml
build:
  before_script:
    - curl -fsSL https://raw.githubusercontent.com/sergeychernov/gitlab/master/share/section.sh -o /tmp/section.sh
    - source /tmp/section.sh
  script:
    - section install yarn install --frozen-lockfile
```

`section <name> <cmd...>` runs `<cmd...>`, prints `section_start` / `section_end` ANSI markers around it, and returns the wrapped command's exit code (so `set -e` keeps working). Section names must match `[^\[\]\r\n]+` (everything except `[`, `]`, newlines) — keep them short, regex-friendly identifiers (`snake_case` plays well with `--section-filter`).

## Sample output

```
GitLab:      https://gitlab.example.com (from git remote)
Project:     261 (from git remote)
Config:      gitlab-pipeline-stats (from cwd: /repo/gitlab-pipeline-stats.json)
Pipelines:   100 per group
Job filter:  status=success

=== main ===
JOB                                                          N    avg(s)   p50(s)   p95(s)   max(s)
---                                                        ---       ---      ---      ---      ---
build                                                       61       395      369      563      804
deploy-cdn                                                  53       250      227      401      420
playwright-e2e-testing-on-test-environment                  93        83       87      152      196
---                                                        ---       ---      ---      ---      ---
TOTAL pipeline (wall)                                      100       891      682     1073    10500

=== develop ===
...
```

## Development

```sh
yarn install
yarn typecheck                                     # tsc --noEmit, strict mode
yarn test                                          # node:test on bin/sections.ts (Node 24+)
node bin/gitlab-pipeline-stats.ts <PROJECT_ID>    # run from sources (Node 24+)
yarn build                                         # build into dist/ (for publishing)
```

For users installing from npm, **Node.js >= 20.11.0** is sufficient because the package runs from compiled `dist/*.js`.  
Node.js 24+ can run `.ts` files from regular directories directly (type stripping). However, type stripping **does not work for files inside `node_modules`** ([spec](https://nodejs.org/api/typescript.html#type-stripping-in-dependencies)), so the package is published already compiled into `dist/*.js`. The build runs automatically before `npm publish` via the `prepublishOnly` hook.

## License

MIT

____

# gitlab-pipeline-stats

[![npm](https://img.shields.io/npm/v/gitlab-pipeline-stats.svg)](https://www.npmjs.com/package/gitlab-pipeline-stats)
[![GitHub](https://img.shields.io/badge/GitHub-sergeychernov%2Fgitlab-181717?logo=github)](https://github.com/sergeychernov/gitlab)

- Исходники: [github.com/sergeychernov/gitlab](https://github.com/sergeychernov/gitlab)
- Пакет в npm: [npmjs.com/package/gitlab-pipeline-stats](https://www.npmjs.com/package/gitlab-pipeline-stats)

Быстрая статистика по последним N пайплайнам GitLab.  
Считает по каждой джобе `count / avg / p50 / p95 / max` длительности выполнения.

Пайплайны группируются по типу (например `main` / `develop` / `release/*` / `feature/*` / `tags`), для каждой группы выводится своя таблица. Группы задаются **JSON-файлом конфигурации**. В пакете есть набор **встроенных пресетов** (gitflow, github-flow, trunk) — выгрузи стартовый конфиг через `init` и правь его под свой репозиторий, держа его под контролем версий. Все пресеты исходят из имени основной ветки `main`; если у тебя по старинке `master` — см. [заметку ниже](#встроенные-пресеты).

## Установка

**Глобально:**
```sh
npm install -g gitlab-pipeline-stats
# Yarn 1.x (редко): yarn global add gitlab-pipeline-stats
```

**Без установки (одноразовый запуск):**
```sh
npx gitlab-pipeline-stats <PROJECT_ID>
yarn dlx gitlab-pipeline-stats <PROJECT_ID>   # Yarn 2+ (Berry); в Yarn 1 используй npx
```

**Локально в проект (devDependency):**
```sh
npm install --save-dev gitlab-pipeline-stats
yarn add -D gitlab-pipeline-stats
```
После установки бинарь доступен как `yarn gitlab-pipeline-stats …` или через скрипт в `package.json`:
```json
// package.json
"scripts": {
  "pipeline-stats": "gitlab-pipeline-stats <PROJECT_ID>"
}
```
Запуск: `yarn pipeline-stats` (или `npm run pipeline-stats`).

Для запуска опубликованного npm-пакета (`dist/*.js`) нужен **Node.js ≥ 20.11.0**.  
Для прямого запуска TypeScript-исходников (`node bin/gitlab-pipeline-stats.ts`) нужен **Node.js 24+** (нативный type stripping). Внешних рантайм-зависимостей нет.

## Использование

```sh
gitlab-pipeline-stats [PROJECT_ID] [options]
gitlab-pipeline-stats init <preset>           # выгрузить пресет в stdout
gitlab-pipeline-stats list-presets            # показать доступные пресеты
gitlab-pipeline-stats --help
```

`PROJECT_ID` — числовой ID или url-encoded path проекта (например `frontend%2Fmy-app`). ID виден на главной странице репозитория в GitLab под названием проекта.

### Автоопределение `--host` и `PROJECT_ID`

И `--host`, и `PROJECT_ID` **опциональны**, если их можно определить автоматически.

**`--host` / `GITLAB_HOST`** (в порядке приоритета):

1. **Внутри GitLab CI** — берётся `CI_SERVER_URL`.
2. **Внутри клонированного репозитория** — парсится `git remote get-url origin`. Поддерживаются HTTPS и SSH-форматы (`git@host:...`, `ssh://git@host/...`); во всех случаях GitLab API запрашивается по `https://`.

**`PROJECT_ID`** (в порядке приоритета):

1. **Внутри GitLab CI** — берётся `CI_PROJECT_PATH` или `CI_PROJECT_ID`.
2. **Внутри клонированного репозитория** — парсится `git remote get-url origin`. Хост из origin должен совпадать с `--host`/`GITLAB_HOST` (после автодетекта это всегда так).

Явное значение всегда побеждает автодетект. Источник выводится в инфо-шапке:

```
GitLab:      https://gitlab.example.com (from git remote)
Project:     frontend%2Fmy-app (from git remote)
```

То есть в типичном кейсе «зашёл в репозиторий → запустил» достаточно одной команды:

```sh
GITLAB_TOKEN=glpat-xxx gitlab-pipeline-stats
```

### Опции и переменные окружения

Все опции можно задать тремя способами (в порядке убывания приоритета):
**CLI-флаг** → **переменная окружения** → **`.env` в `cwd`** → дефолт.

| Флаг                       | Env                            | Обязательный | По умолчанию | Описание |
|----------------------------|--------------------------------|:---:|---|---|
| `--config <path>`          | `GITLAB_PIPELINE_STATS_CONFIG` | ✓² | `./gitlab-pipeline-stats.json` | Путь к JSON-конфигу групп. Имена встроенных пресетов **не принимаются** — используй `init <preset>`, чтобы выгрузить пресет в файл. |
| `--host <url>`             | `GITLAB_HOST`                  | | авто¹ | Хост GitLab без завершающего `/` |
| `--token <token>`          | `GITLAB_TOKEN`                 | ✓ | — | Personal Access Token (scope `read_api`) |
| `--limit <n>`              | `PIPELINE_LIMIT`               | | `50` | Число пайплайнов на группу **после** client-side фильтров. Если в группе есть `refPattern`/`excludeRef`/`excludeRefPattern`, инструмент дозапрашивает страницы (cap: 10×limit просканированных) пока не наберёт ровно `n` подходящих. |
| `--status-filter <status>` | `JOB_STATUS_FILTER`            | | `success` | Фильтр статуса джобы (пусто — без фильтра) |
| `--section`                | —                              | | off | Дрилл-даун по [section-маркерам](#детализация-по-section-маркерам) GitLab CI внутри лога каждой джобы |
| `--section-filter <regex>` | —                              | | — | Показать только секции с именем, подходящим под regex |
| `--section-job-filter <regex>` | —                          | | — | Загружать trace только у джоб, чьи имена подходят под regex (perf) |
| `--section-order <mode>`   | —                              | | `appearance` | Сортировка строк секций: `appearance` \| `p50` \| `name` |
| `--section-builtins`       | —                              | | off | Показывать в выводе встроенные секции, которыми тулчейн оборачивает твой код: stages gitlab-runner (`step_script`, `get_sources`, `upload_artifacts_on_success`, …) и Yarn Berry (`resolution_step`, `fetch_step`, `link_step`, `_tmp_xfs_<hex>_build_log`, …). По умолчанию выключено — выводятся только user-секции из твоего `script:`. |
| `--warnings`               | —                              | | off | Печатать в stderr нефатальные предупреждения (не удалось скачать trace, незакрытые section-маркеры и т.п.). По умолчанию выключено, чтобы не зашумлять вывод. |
| `-h`, `--help`             | —                              | | | Показать справку |

¹ Авто-определение через `CI_SERVER_URL` или `git remote`. Если ни одно не сработало — флаг становится обязательным.  
² Конфиг обязателен, но путь может прийти из `--config`, env-переменной или — по умолчанию — из `./gitlab-pipeline-stats.json` в текущей директории. Если ничего из этого недоступно, инструмент завершается с ошибкой.

## Файл конфигурации

Конфиг — это **всегда JSON-файл** (`--config` больше **не принимает** имена пресетов). В пакет встроены пресеты, которые можно выгрузить в файл через `init` и закоммитить / поправить:

```sh
gitlab-pipeline-stats init gitflow > gitlab-pipeline-stats.json
git add gitlab-pipeline-stats.json
gitlab-pipeline-stats 261                                   # подхватит ./gitlab-pipeline-stats.json
gitlab-pipeline-stats 261 --config ./ci/groups.json         # явный путь
```

Порядок резолва конфига (побеждает первое сработавшее):

1. `--config <path>`
2. env `GITLAB_PIPELINE_STATS_CONFIG=<path>`
3. `./gitlab-pipeline-stats.json` в текущей директории

Если ни один вариант не находит файл — выходим с ошибкой и подсказкой про `init`.

## Встроенные пресеты

В стартовом наборе три пресета. Выбираешь подходящий, выгружаешь в JSON через `init`, потом указываешь его в `--config` (либо коммитишь как `./gitlab-pipeline-stats.json` в корень репозитория).

> **Note: `master` vs `main`.** Все встроенные пресеты исходят из того, что основная ветка называется `main`. Если в репозитории по старинке используется `master` — после `init` открой получившийся `gitlab-pipeline-stats.json` и замени все `"main"` на `"master"` в полях `ref` / `excludeRef` / `label`. Сам инструмент не знает имя дефолтной ветки твоего репозитория — источником правды является конфиг.

### `gitflow` ([Vincent Driessen, 2010](https://nvie.com/posts/a-successful-git-branching-model/))

Самая «полная» модель: долгоживущие `main` и `develop`, временные `release/*`, `feature/*`, `hotfix/*`, релизы оформляются тегами. Подходит для сложных продуктов с фиксированным циклом релизов и поддержкой нескольких версий одновременно.

```sh
gitlab-pipeline-stats init gitflow > gitlab-pipeline-stats.json
gitlab-pipeline-stats 261
```

Группы: `main`, `develop`, `release/*`, `feature/*`, `hotfix/*`, `tags`.

### `github-flow` ([GitHub, 2011](https://docs.github.com/en/get-started/using-github/github-flow))

Минималистичная модель: одна основная ветка `main`, всё остальное — короткоживущие feature-ветки, релизы оформляются тегами. Деплой обычно после мержа в `main`. Подходит для веб-приложений и SaaS с CD.

```sh
gitlab-pipeline-stats init github-flow > gitlab-pipeline-stats.json
```

Группы: `main`, `feature branches`, `tags`.

### `trunk` (Trunk-based development)

Ещё проще: единственный «trunk» (`main`), любые правки попадают в него быстро (часы/день). Релизы — через CD прямо из `main`, теги опциональны и здесь не учитываются. Подходит командам с feature-flag'ами и зрелым CI/CD.

```sh
gitlab-pipeline-stats init trunk > gitlab-pipeline-stats.json
```

Группы: `main`, `short-lived branches`.

### Список и просмотр пресетов

```sh
gitlab-pipeline-stats list-presets             # имя + краткое описание каждого
gitlab-pipeline-stats init gitflow             # печатает JSON в stdout
gitlab-pipeline-stats init gitflow > gitlab-pipeline-stats.json   # перенаправить в файл и доработать
```

## Схема конфига

```jsonc
{
    "$schema": "https://cdn.jsdelivr.net/npm/gitlab-pipeline-stats@latest/schemas/config.schema.json",
    "description": "Произвольное описание (опционально)",
    "groups": [
        {
            "label": "main",                      // обязательное: что показать в заголовке таблицы
            "ref": "main",                        // server-side: точное имя ref (без wildcards)
            "scope": "branches",                  // server-side: branches | tags | finished | running | pending
            "source": "push",                     // server-side: push | web | trigger | schedule | api | merge_request_event | ...
            "status": "success",                  // server-side: success | failed | canceled | ...
            "refPattern": "^release/",            // client-side: регэксп для фильтра по ref
            "excludeRef": "main",                 // client-side: точное имя для исключения
            "excludeRefPattern": "^dependabot/"   // client-side: регэксп для исключения
        }
    ]
}
```

Все поля кроме `label` опциональны. **Server-side фильтры** уходят в API GitLab напрямую (`/projects/:id/pipelines?scope=...&ref=...`), **client-side** применяются к ответу. Wildcards в `ref` GitLab API не поддерживает — используй `scope: "branches"` + `refPattern: "^release/"`.

> **Важно: `scope: "branches"` и MR-пайплайны.** GitLab API на `scope=branches` отдаёт только пайплайны на branch-рефах. MR-пайплайны (`source = merge_request_event`, ref `refs/merge-requests/<n>/head`) под него **не попадают** — если у тебя есть джобы, которые крутятся только в MR (`rules:if: $CI_PIPELINE_SOURCE == "merge_request_event"`), добавь отдельную группу `{ "label": "merge requests", "source": "merge_request_event" }`. Во всех bundled-пресетах она уже есть.

### `$schema` и поддержка в IDE

Bundled-пресеты содержат поле `$schema`, ссылающееся на JSON Schema формата ([`schemas/config.schema.json`](./schemas/config.schema.json)). При запуске `init` относительный путь внутри пакета автоматически переписывается на стабильный CDN-URL, привязанный к версии установленного CLI, например:

```jsonc
"$schema": "https://cdn.jsdelivr.net/npm/gitlab-pipeline-stats@1.1.2/schemas/config.schema.json"
```

Это даёт автодополнение, подсказки по перечислениям (`scope`, `source`, `status`) и подсветку опечаток в любом редакторе с поддержкой JSON Schema (VSCode, Cursor, JetBrains и пр.) — без какой-либо ручной настройки. Схема — чисто IDE-сахар; CLI имеет свой собственный валидатор и поле `$schema` игнорирует.

### Примеры групп

```jsonc
// все пайплайны точно на main
{ "label": "main", "ref": "main" }

// все теги
{ "label": "tags", "scope": "tags" }

// release/v1, release/v2.x — по regexp
{ "label": "release/*", "scope": "branches", "refPattern": "^release/" }

// все ветки кроме main и dependabot
{ "label": "feature", "scope": "branches", "excludeRef": "main", "excludeRefPattern": "^dependabot/" }

// только успешные пайплайны schedule-триггера на main
{ "label": "nightly", "ref": "main", "source": "schedule", "status": "success" }
```

## Конфиг через `.env`

```sh
cp .env.example .env
# заполнить GITLAB_HOST и GITLAB_TOKEN
gitlab-pipeline-stats 261
```

## Детализация по section-маркерам

GitLab CI поддерживает collapsible-секции в логах джоб через ANSI-маркеры. Если в твоём `before_script`/`script` секции уже размечены (обычно небольшим bash-хелпером `section()`, [пример ниже](#разметка-джоб-через-section-helper)), то границы маркеров одновременно несут Unix-таймштампы старта и конца — то есть у каждой секции есть собственная длительность. Флаг `gitlab-pipeline-stats --section` парсит эти маркеры из job trace и печатает разбивку по секциям отступом под строкой джобы.

```sh
gitlab-pipeline-stats --section
gitlab-pipeline-stats --section --section-filter '^build|^deploy'
gitlab-pipeline-stats --section --section-job-filter '^(build|deploy-)'
```

Поведение по умолчанию не меняется: **без** `--section` инструмент не делает ни одного запроса `/trace` и выдаёт ровно тот же вывод, что и раньше. С `--section` он дополнительно тянет `/projects/:id/jobs/:job_id/trace` для каждой джобы, прошедшей фильтр статуса (и `--section-job-filter`, если задан), парсит маркеры и рендерит секции под строкой джобы — в том порядке, в котором они впервые встречаются в build flow:

```
=== main ===
JOB                                                    N   avg(s)  p50(s)  p95(s)  max(s)
build                                                 33      401     406     490     570
  ├─ ssh_keys                                         33        2       2       3       5
  ├─ check_deps                                       33        4       4       6      10
  ├─ submodules                                       33        8       7      12      20
  ├─ install                                          33       38      36      62      90
  ├─ test                                             33       71      70     110     150
  ├─ gatsby_build                                     33      198     195     270     320
  └─ pdf_buffers                                      33       11      11      18      22
deploy-cdn                                            27      275     257     404     420
  ├─ helm_setup                                       27       15      14      22      30
  └─ upload                                           27      255     240     380     400
TOTAL pipeline (wall)                                 50      724     719     969    1082
Sections found in 60/60 jobs
```

Что важно знать:

- Достаточно того же скоупа токена `read_api` — никаких дополнительных прав не нужно.
- Секции агрегируются по ключу `(job_name, section_name)`. Если одна и та же секция повторяется внутри одной джобы — её длительности суммируются перед добавлением в сэмпл.
- При `--section-order appearance` (дефолт) секции внутри джобы выводятся в порядке появления первых start-маркеров в первом просканированном trace; секции, которые встретились только в более поздних пайплайнах, дописываются в конец.
- Встроенные секции, которыми тулчейн оборачивает твой код, **по умолчанию скрыты** — обычно интересны только твои собственные секции из `script:`. Из коробки прячутся: stages gitlab-runner (`step_script`, `get_sources`, `upload_artifacts_on_success` и т.д.) и секции Yarn Berry (`resolution_step`, `fetch_step`, `link_step`, `_tmp_xfs_<hex>_build_log` и т.д.). Чтобы вывести и их, добавь `--section-builtins`.
- Если джоба была прибита посреди секции (start без парного end) — orphan-секция тихо игнорируется. Чтобы такие случаи (а также прочие нефатальные проблемы — например, не удалось скачать `/trace`) показывались в stderr, добавь флаг `--warnings`.
- GitLab может обрезать trace (по умолчанию 4 МБ), но section-маркеры короткие и почти всегда выживают.
- Производительность: при `--limit 50` и ~7 джоб на пайплайн получается ~350 trace-GET'ов на группу. Запросы идут параллельно с фиксированной concurrency 8 — этого хватает, чтобы быстро отработать, и при этом не «забомбить» API. Сужай область через `--section-job-filter`, если интересны только пара тяжёлых джоб.
- Если `--section` включён, но маркеров нигде не нашлось, после таблицы появится подсказка вроде `Sections found in 0/27 jobs (no instrumentation?)`.

### Разметка джоб через `section()` helper

Чтобы `--section` начал давать пользу, нужно обернуть интересующие шаги в `before_script`/`script` маркерами секций. Готовый bash-хелпер уже едет внутри пакета — [`share/section.sh`](./share/section.sh), копировать его в каждый репозиторий не нужно.

**Если `gitlab-pipeline-stats` уже стоит как `devDependency`** в проекте, просто `source`-ни файл из `node_modules` — никаких дополнительных шагов:

```yaml
build:
  before_script:
    - source node_modules/gitlab-pipeline-stats/share/section.sh
  script:
    - section install      yarn install --frozen-lockfile
    - section test         yarn test
    - section gatsby_build yarn build
```

**Если в job нет `node_modules`** (например, build-образ без npm), скачай файл напрямую из репозитория:

```yaml
build:
  before_script:
    - curl -fsSL https://raw.githubusercontent.com/sergeychernov/gitlab/master/share/section.sh -o /tmp/section.sh
    - source /tmp/section.sh
  script:
    - section install yarn install --frozen-lockfile
```

`section <name> <cmd...>` выполняет `<cmd...>`, оборачивает его ANSI-маркерами `section_start` / `section_end` и возвращает rc обёрнутой команды (так что `set -e` продолжает работать). Имена секций должны попадать под `[^\[\]\r\n]+` (всё, кроме `[`, `]`, переводов строки) — выбирай короткие regex-friendly идентификаторы (`snake_case` хорошо дружит с `--section-filter`).

## Пример вывода

```
GitLab:      https://gitlab.example.com (from git remote)
Project:     261 (from git remote)
Config:      gitlab-pipeline-stats (from cwd: /repo/gitlab-pipeline-stats.json)
Pipelines:   100 per group
Job filter:  status=success

=== main ===
JOB                                                          N    avg(s)   p50(s)   p95(s)   max(s)
---                                                        ---       ---      ---      ---      ---
build                                                       61       395      369      563      804
deploy-cdn                                                  53       250      227      401      420
playwright-e2e-testing-on-test-environment                  93        83       87      152      196
---                                                        ---       ---      ---      ---      ---
TOTAL pipeline (wall)                                      100       891      682     1073    10500

=== develop ===
...
```

## Разработка

```sh
yarn install
yarn typecheck                                     # tsc --noEmit, strict-режим
yarn test                                          # node:test для bin/sections.ts (Node 24+)
node bin/gitlab-pipeline-stats.ts <PROJECT_ID>    # запуск из исходников (Node 24+)
yarn build                                         # сборка в dist/ (для публикации)
```

Для пользователей npm-пакета достаточно **Node.js >= 20.11.0**, так как выполняется скомпилированный `dist/*.js`.  
Node.js 24+ умеет запускать `.ts`-файлы из обычных каталогов напрямую (type stripping). Однако type stripping **не работает для файлов внутри `node_modules`** ([спецификация](https://nodejs.org/api/typescript.html#type-stripping-in-dependencies)), поэтому пакет публикуется уже скомпилированным в `dist/*.js`. Сборка запускается автоматически перед `npm publish` через хук `prepublishOnly`.

## Лицензия

MIT
