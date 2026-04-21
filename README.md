[English](#gitlab-pipeline-stats) | [Русский](#gitlab-pipeline-stats-1)

# gitlab-pipeline-stats

Quick stats for the latest N GitLab pipelines.  
For every job it computes `count / avg / p50 / p95 / max` of execution duration.

Pipelines are grouped by type (e.g. `main` / `develop` / `release/*` / `feature/*` / `tags`); each group gets its own table. Groups are defined by a **preset** matching your release flow or by a **custom JSON config**.

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

Requires **Node.js ≥ 24** — the package is written in TypeScript and runs via Node's native type stripping. No runtime dependencies.

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
| `--config <name\|path>`    | `GITLAB_PIPELINE_STATS_CONFIG` | | `gitflow` | Preset name or path to a JSON groups config |
| `--host <url>`             | `GITLAB_HOST`                  | | auto¹ | GitLab host without trailing `/` |
| `--token <token>`          | `GITLAB_TOKEN`                 | ✓ | — | Personal Access Token (scope `read_api`) |
| `--limit <n>`              | `PIPELINE_LIMIT`               | | `50` | Pipelines per group **after** client-side filters. If a group has `refPattern` / `excludeRef` / `excludeRefPattern`, the tool paginates (cap: 10×limit scanned) until exactly `n` matching pipelines are collected. |
| `--status-filter <status>` | `JOB_STATUS_FILTER`            | | `success` | Job status filter (empty — no filter) |
| `-h`, `--help`             | —                              | | | Show help |

¹ Auto-detection via `CI_SERVER_URL` or `git remote`. If neither works, the flag becomes required.

## Release-flow presets

The starter set ships with four presets. Pick the one that matches your flow or use it as a template for your own.

### `gitflow` ([Vincent Driessen, 2010](https://nvie.com/posts/a-successful-git-branching-model/)) — default

The "fullest" model: long-lived `main` and `develop`, short-lived `release/*`, `feature/*`, `hotfix/*`; releases are tagged. Suitable for complex products with a fixed release cadence and parallel support of several versions.

```sh
gitlab-pipeline-stats 261                       # picks gitflow by default
gitlab-pipeline-stats 261 --config gitflow
```

Groups: `main`, `develop`, `release/*`, `feature/*`, `hotfix/*`, `tags`.

### `github-flow` ([GitHub, 2011](https://docs.github.com/en/get-started/using-github/github-flow))

Minimal model: a single `main`, everything else is short-lived feature branches; releases are tagged. Deploy usually happens after merging into `main`. Suits web apps and SaaS with CD.

```sh
gitlab-pipeline-stats 261 --config github-flow
```

Groups: `main`, `feature branches`, `tags`.

### `trunk` (Trunk-based development)

Even simpler: a single "trunk" (`main`) where any change lands fast (hours/days). Releases — via CD straight from `main`; tags are optional and not tracked here. Best for teams with feature flags and a mature CI/CD.

```sh
gitlab-pipeline-stats 261 --config trunk
```

Groups: `main`, `short-lived branches`.

### `tags-flow` (legacy default)

Used by projects where the main branch is called `master` and releases are tags.

```sh
gitlab-pipeline-stats 261 --config tags-flow
```

Groups: `master`, `tags`, `branches != master`.

### Listing and viewing presets

```sh
gitlab-pipeline-stats list-presets             # name + short description for each
gitlab-pipeline-stats init gitflow             # prints JSON to stdout
gitlab-pipeline-stats init gitflow > my.json   # redirect to a file and tweak
```

## Custom config

A preset is just a JSON file. Copy any of them via `init` and tweak:

```sh
gitlab-pipeline-stats init github-flow > .gitlab-pipeline-stats.json
gitlab-pipeline-stats 261 --config ./.gitlab-pipeline-stats.json
```

### Config schema

```jsonc
{
    "description": "Free-form description (optional)",
    "groups": [
        {
            "label": "main",                      // required: table heading
            "ref": "main",                        // server-side: exact ref name (no wildcards)
            "scope": "branches",                  // server-side: branches | tags | finished | running | pending
            "source": "push",                     // server-side: push | web | trigger | schedule | api | ...
            "status": "success",                  // server-side: success | failed | canceled | ...
            "refPattern": "^release/",            // client-side: regexp matched against ref
            "excludeRef": "main",                 // client-side: exact ref to exclude
            "excludeRefPattern": "^dependabot/"   // client-side: regexp to exclude
        }
    ]
}
```

Every field except `label` is optional. **Server-side filters** are forwarded straight to the GitLab API (`/projects/:id/pipelines?scope=...&ref=...`); **client-side** ones are applied to the response. Wildcards in `ref` are not supported by the GitLab API — use `scope: "branches"` + `refPattern: "^release/"` instead.

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

## Sample output

```
GitLab:      https://gitlab.example.com (from git remote)
Project:     261 (from git remote)
Config:      gitflow (/usr/local/lib/node_modules/gitlab-pipeline-stats/configs/gitflow.json)
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
node bin/gitlab-pipeline-stats.ts <PROJECT_ID>    # run from sources (Node 24+)
yarn build                                         # build into dist/ (for publishing)
```

Node.js 24+ can run `.ts` files from regular directories directly (type stripping). However, type stripping **does not work for files inside `node_modules`** ([spec](https://nodejs.org/api/typescript.html#type-stripping-in-dependencies)), so the package is published already compiled into `dist/*.js`. The build runs automatically before `npm publish` via the `prepublishOnly` hook.

## License

MIT

____

# gitlab-pipeline-stats

Быстрая статистика по последним N пайплайнам GitLab.  
Считает по каждой джобе `count / avg / p50 / p95 / max` длительности выполнения.

Пайплайны группируются по типу (например `main` / `develop` / `release/*` / `feature/*` / `tags`), для каждой группы выводится своя таблица. Группы задаются **пресетом** под твой release-flow или **собственным JSON-конфигом**.

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

Требует **Node.js ≥ 24** — пакет написан на TypeScript и запускается напрямую через нативный type-stripping Node.js. Внешних рантайм-зависимостей нет.

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
| `--config <name\|path>`    | `GITLAB_PIPELINE_STATS_CONFIG` | | `gitflow` | Имя пресета или путь к JSON-конфигу групп |
| `--host <url>`             | `GITLAB_HOST`                  | | авто¹ | Хост GitLab без завершающего `/` |
| `--token <token>`          | `GITLAB_TOKEN`                 | ✓ | — | Personal Access Token (scope `read_api`) |
| `--limit <n>`              | `PIPELINE_LIMIT`               | | `50` | Число пайплайнов на группу **после** client-side фильтров. Если в группе есть `refPattern`/`excludeRef`/`excludeRefPattern`, инструмент дозапрашивает страницы (cap: 10×limit просканированных) пока не наберёт ровно `n` подходящих. |
| `--status-filter <status>` | `JOB_STATUS_FILTER`            | | `success` | Фильтр статуса джобы (пусто — без фильтра) |
| `-h`, `--help`             | —                              | | | Показать справку |

¹ Авто-определение через `CI_SERVER_URL` или `git remote`. Если ни одно не сработало — флаг становится обязательным.

## Пресеты под release-flow

Сейчас в стартовом наборе четыре пресета. Выбираешь подходящий или используешь как шаблон для своего.

### `gitflow` ([Vincent Driessen, 2010](https://nvie.com/posts/a-successful-git-branching-model/)) — дефолт

Самая «полная» модель: долгоживущие `main` и `develop`, временные `release/*`, `feature/*`, `hotfix/*`, релизы оформляются тегами. Подходит для сложных продуктов с фиксированным циклом релизов и поддержкой нескольких версий одновременно.

```sh
gitlab-pipeline-stats 261                       # подхватит gitflow по умолчанию
gitlab-pipeline-stats 261 --config gitflow
```

Группы: `main`, `develop`, `release/*`, `feature/*`, `hotfix/*`, `tags`.

### `github-flow` ([GitHub, 2011](https://docs.github.com/en/get-started/using-github/github-flow))

Минималистичная модель: одна основная ветка `main`, всё остальное — короткоживущие feature-ветки, релизы оформляются тегами. Деплой обычно после мержа в `main`. Подходит для веб-приложений и SaaS с CD.

```sh
gitlab-pipeline-stats 261 --config github-flow
```

Группы: `main`, `feature branches`, `tags`.

### `trunk` (Trunk-based development)

Ещё проще: единственный «trunk» (`main`), любые правки попадают в него быстро (часы/день). Релизы — через CD прямо из `main`, теги опциональны и здесь не учитываются. Подходит командам с feature-flag'ами и зрелым CI/CD.

```sh
gitlab-pipeline-stats 261 --config trunk
```

Группы: `main`, `short-lived branches`.

### `tags-flow` (легаси-дефолт)

Используется в проектах, где основная ветка называется `master`, а релизы — это теги.

```sh
gitlab-pipeline-stats 261 --config tags-flow
```

Группы: `master`, `tags`, `branches != master`.

### Список и просмотр пресетов

```sh
gitlab-pipeline-stats list-presets             # имя + краткое описание каждого
gitlab-pipeline-stats init gitflow             # печатает JSON в stdout
gitlab-pipeline-stats init gitflow > my.json   # перенаправить в файл и доработать
```

## Свой конфиг

Пресет — это обычный JSON. Скопируй любой через `init` и правь под себя:

```sh
gitlab-pipeline-stats init github-flow > .gitlab-pipeline-stats.json
gitlab-pipeline-stats 261 --config ./.gitlab-pipeline-stats.json
```

### Схема конфига

```jsonc
{
    "description": "Произвольное описание (опционально)",
    "groups": [
        {
            "label": "main",                      // обязательное: что показать в заголовке таблицы
            "ref": "main",                        // server-side: точное имя ref (без wildcards)
            "scope": "branches",                  // server-side: branches | tags | finished | running | pending
            "source": "push",                     // server-side: push | web | trigger | schedule | api | ...
            "status": "success",                  // server-side: success | failed | canceled | ...
            "refPattern": "^release/",            // client-side: регэксп для фильтра по ref
            "excludeRef": "main",                 // client-side: точное имя для исключения
            "excludeRefPattern": "^dependabot/"   // client-side: регэксп для исключения
        }
    ]
}
```

Все поля кроме `label` опциональны. **Server-side фильтры** уходят в API GitLab напрямую (`/projects/:id/pipelines?scope=...&ref=...`), **client-side** применяются к ответу. Wildcards в `ref` GitLab API не поддерживает — используй `scope: "branches"` + `refPattern: "^release/"`.

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

## Пример вывода

```
GitLab:      https://gitlab.example.com (from git remote)
Project:     261 (from git remote)
Config:      gitflow (/usr/local/lib/node_modules/gitlab-pipeline-stats/configs/gitflow.json)
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
node bin/gitlab-pipeline-stats.ts <PROJECT_ID>    # запуск из исходников (Node 24+)
yarn build                                         # сборка в dist/ (для публикации)
```

Node.js 24+ умеет запускать `.ts`-файлы из обычных каталогов напрямую (type stripping). Однако type stripping **не работает для файлов внутри `node_modules`** ([спецификация](https://nodejs.org/api/typescript.html#type-stripping-in-dependencies)), поэтому пакет публикуется уже скомпилированным в `dist/*.js`. Сборка запускается автоматически перед `npm publish` через хук `prepublishOnly`.

## Лицензия

MIT
