#!/usr/bin/env node
// gitlab-pipeline-stats — быстрая статистика по пайплайнам GitLab.
// Требует Node.js >= 24 (нативный TypeScript через type stripping).

import * as path     from 'node:path';
import * as fs       from 'node:fs';
import { parseArgs } from 'node:util';
import { execSync }  from 'node:child_process';

// --- Типы -------------------------------------------------------------------

interface GitLabPipeline {
    id: number;
    ref: string;
    duration: number | null;
}

interface GitLabJob {
    name: string;
    status: string;
    duration: number | null;
}

interface GitLabPipelineSummary {
    id: number;
    ref: string;
}

interface JobStats {
    count: number;
    sumD: number;
    durations: number[];
    maxD: number;
}

type StatsMap = Record<string, JobStats>;

interface RenderRow {
    name: string;
    n: number;
    avg: number;
    p50: number;
    p95: number;
    max: number;
}

type ProjectIdSource = 'arg' | 'CI_PROJECT_PATH' | 'CI_PROJECT_ID' | 'git remote';
type HostSource      = 'arg' | 'GITLAB_HOST'     | 'CI_SERVER_URL'  | 'git remote';
type ConfigSource    = 'flag' | 'env' | 'cwd';

interface GroupSpec {
    label: string;
    // server-side фильтры (передаются в API)
    ref?:    string;
    scope?:  string;   // branches | tags | finished | running | pending
    source?: string;   // push | web | trigger | schedule | api | ...
    status?: string;   // success | failed | canceled | ...
    // client-side фильтры (применяются к response)
    refPattern?:        string;
    excludeRef?:        string;
    excludeRefPattern?: string;
}

interface ConfigFile {
    description?: string;
    groups:       GroupSpec[];
}

interface Config {
    projectId:       string;
    projectIdSource: ProjectIdSource;
    host:            string;
    hostSource:      HostSource;
    token:           string;
    limit:           string;
    statusFilter:    string;
    configName:      string;   // что показать в шапке
    configPath:      string;   // абсолютный путь до загруженного JSON
    configSource:    ConfigSource;
    groups:          GroupSpec[];
}

// --- .env parser (без зависимостей) ----------------------------------------

function loadEnv(filePath: string): void {
    if (!fs.existsSync(filePath)) return;
    for (const raw of fs.readFileSync(filePath, 'utf8').split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        const val = line.slice(eq + 1).trim();
        if (!(key in process.env)) process.env[key] = val;
    }
}

loadEnv(path.join(process.cwd(), '.env'));

// --- ANSI-цвета (отключаются при перенаправлении вывода) --------------------

const TTY = process.stdout.isTTY;
const CR          = TTY ? '\x1b[0m'    : '';
const DIM         = TTY ? '\x1b[2m'    : '';
const BOLD_CYAN   = TTY ? '\x1b[1;36m' : '';
const BOLD_YELLOW = TTY ? '\x1b[1;33m' : '';
const BOLD_WHITE  = TTY ? '\x1b[1;37m' : '';

const out  = (s: string): void => { process.stdout.write(s); };
const err  = (s: string): void => { process.stderr.write(s); };

// --- Пути и пресеты ---------------------------------------------------------

const SCRIPT_DIR        = import.meta.dirname;
const CONFIGS_DIR       = path.join(SCRIPT_DIR, '..', 'configs');
const DEFAULT_CONFIG_FILENAME = 'gitlab-pipeline-stats.json';

function listBuiltinPresets(): string[] {
    if (!fs.existsSync(CONFIGS_DIR)) return [];
    return fs.readdirSync(CONFIGS_DIR)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace(/\.json$/, ''))
        .sort();
}

// Возвращает абсолютный путь к bundled пресету или undefined, если такого нет.
function resolveBundledPreset(name: string): string | undefined {
    if (!name || name.includes('/') || name.includes('\\')) return undefined;
    const p = path.join(CONFIGS_DIR, `${name}.json`);
    return fs.existsSync(p) ? p : undefined;
}

// Резолвит --config <path>: только путь к существующему JSON-файлу.
// Имена встроенных пресетов больше не принимаются — используй
//   gitlab-pipeline-stats init <preset> > my.json
// чтобы получить файл, а потом передай путь явно.
function resolveConfigPath(input: string): string {
    if (fs.existsSync(input) && fs.statSync(input).isFile()) {
        return path.resolve(input);
    }
    throw new Error(
        `Config file not found: ${input}\n` +
        `--config expects a path to a JSON file.\n` +
        `To get a starter config from a bundled preset:\n` +
        `  gitlab-pipeline-stats init <preset> > ${DEFAULT_CONFIG_FILENAME}\n` +
        `Bundled presets: ${listBuiltinPresets().join(', ')}`
    );
}

function validateConfig(data: unknown, filePath: string): ConfigFile {
    if (!data || typeof data !== 'object') {
        throw new Error(`Config ${filePath}: expected a JSON object`);
    }
    const obj = data as Record<string, unknown>;
    if (!Array.isArray(obj.groups)) {
        throw new Error(`Config ${filePath}: "groups" must be an array`);
    }

    const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

    const groups: GroupSpec[] = obj.groups.map((raw, i) => {
        if (!raw || typeof raw !== 'object') {
            throw new Error(`Config ${filePath}: groups[${i}] must be an object`);
        }
        const g = raw as Record<string, unknown>;
        if (typeof g.label !== 'string' || !g.label) {
            throw new Error(`Config ${filePath}: groups[${i}].label is required`);
        }
        const spec: GroupSpec = { label: g.label };
        const ref               = str(g.ref);
        const scope             = str(g.scope);
        const source            = str(g.source);
        const status            = str(g.status);
        const refPattern        = str(g.refPattern);
        const excludeRef        = str(g.excludeRef);
        const excludeRefPattern = str(g.excludeRefPattern);
        if (ref               !== undefined) spec.ref               = ref;
        if (scope             !== undefined) spec.scope             = scope;
        if (source            !== undefined) spec.source            = source;
        if (status            !== undefined) spec.status            = status;
        if (refPattern        !== undefined) spec.refPattern        = refPattern;
        if (excludeRef        !== undefined) spec.excludeRef        = excludeRef;
        if (excludeRefPattern !== undefined) spec.excludeRefPattern = excludeRefPattern;
        return spec;
    });

    const result: ConfigFile = { groups };
    const description = str(obj.description);
    if (description !== undefined) result.description = description;
    return result;
}

function loadConfigFile(absPath: string): { name: string; absPath: string; data: ConfigFile } {
    const raw = fs.readFileSync(absPath, 'utf8');
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`Invalid JSON in ${absPath}: ${msg}`);
    }
    const data = validateConfig(parsed, absPath);
    const name = path.basename(absPath, '.json');
    return { name, absPath, data };
}

// --- Subcommands ------------------------------------------------------------

function cmdListPresets(): void {
    const presets = listBuiltinPresets();
    if (presets.length === 0) {
        out('No bundled presets found.\n');
        return;
    }
    out('Available presets:\n');
    for (const name of presets) {
        const filePath = path.join(CONFIGS_DIR, `${name}.json`);
        let desc = '';
        try {
            const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8')) as { description?: unknown };
            if (typeof parsed.description === 'string') desc = parsed.description;
        } catch {
            // некритично
        }
        out(`  ${BOLD_WHITE}${name.padEnd(14)}${CR}${desc ? `${DIM}${desc}${CR}` : ''}\n`);
    }
    out(`\nUsage:\n`);
    out(`  gitlab-pipeline-stats init <preset> > ${DEFAULT_CONFIG_FILENAME}\n`);
    out(`  gitlab-pipeline-stats <PROJECT_ID> --config ./${DEFAULT_CONFIG_FILENAME}\n`);
}

function cmdInit(presetName: string | undefined): void {
    if (!presetName) {
        err(`Usage: gitlab-pipeline-stats init <preset>\n`);
        err(`Available: ${listBuiltinPresets().join(', ')}\n`);
        process.exit(1);
    }
    const absPath = resolveBundledPreset(presetName);
    if (!absPath) {
        err(`Unknown preset: ${presetName}\n`);
        err(`Available: ${listBuiltinPresets().join(', ')}\n`);
        process.exit(1);
    }
    out(fs.readFileSync(absPath, 'utf8'));
}

// --- CLI --------------------------------------------------------------------

const HELP = `gitlab-pipeline-stats — stats for GitLab pipelines

Usage:
  gitlab-pipeline-stats [PROJECT_ID] [options]
  gitlab-pipeline-stats init <preset>           # print a bundled preset to stdout
  gitlab-pipeline-stats list-presets            # show bundled presets

Arguments:
  PROJECT_ID                 Project ID or url-encoded path (e.g. frontend%2Fmy-app).
                             Optional if it can be auto-detected from:
                               1. CI_PROJECT_PATH / CI_PROJECT_ID (inside GitLab CI)
                               2. git remote get-url origin (inside a cloned repository)
                             Explicit argument always wins over auto-detection.

Options (override env / .env):
  --config <path>            Path to a JSON config file describing pipeline groups.
                             Resolution order (first match wins):
                               1. --config <path>
                               2. env GITLAB_PIPELINE_STATS_CONFIG=<path>
                               3. ./${DEFAULT_CONFIG_FILENAME} in the current directory
                             To bootstrap from a bundled preset:
                               gitlab-pipeline-stats init <preset> > ${DEFAULT_CONFIG_FILENAME}
                             Bundled presets: ${listBuiltinPresets().join(', ')}
  --host <url>               GitLab host without trailing slash             [env: GITLAB_HOST]
                             Optional if it can be auto-detected from:
                               1. CI_SERVER_URL (inside GitLab CI)
                               2. git remote get-url origin
  --token <token>            Personal Access Token (scope read_api)         [env: GITLAB_TOKEN]
  --limit <n>                Pipelines per group (max 100)                  [env: PIPELINE_LIMIT, default: 50]
  --status-filter <status>   Job status filter (empty — no filter)          [env: JOB_STATUS_FILTER, default: success]
  -h, --help                 Show help

Examples:
  gitlab-pipeline-stats init gitflow > ${DEFAULT_CONFIG_FILENAME}
  gitlab-pipeline-stats                                    # auto-detect PROJECT_ID + ./${DEFAULT_CONFIG_FILENAME}
  gitlab-pipeline-stats 261 --config ./${DEFAULT_CONFIG_FILENAME}
  gitlab-pipeline-stats 261 --config ./ci/groups.json
`;

// Кэш origin-URL: git remote вызывается один раз для host- и project-детекта.
let cachedOriginUrl: string | null | undefined;

function getOriginUrl(): string | undefined {
    if (cachedOriginUrl !== undefined) return cachedOriginUrl ?? undefined;
    try {
        const url = execSync('git remote get-url origin', {
            stdio: ['ignore', 'pipe', 'ignore'],
        }).toString().trim();
        cachedOriginUrl = url || null;
        return url || undefined;
    } catch {
        cachedOriginUrl = null;
        return undefined;
    }
}

// Извлекает host (https://...) из git remote URL.
// SSH-форматы (git@host:path, ssh://git@host/path) считаются HTTPS — у GitLab API всегда HTTPS.
function hostFromOriginUrl(url: string): string | undefined {
    if (!url.startsWith('http')) {
        const ssh = url.match(/^(?:ssh:\/\/)?(?:[^@]+@)?([^:/]+)/);
        if (ssh && ssh[1]) return `https://${ssh[1]}`;
    }
    try {
        const u = new URL(url);
        return `${u.protocol}//${u.host}`;
    } catch {
        return undefined;
    }
}

function detectHost(): { host: string; source: HostSource } | undefined {
    const ciHost = process.env.CI_SERVER_URL;
    if (ciHost) return { host: ciHost.replace(/\/$/, ''), source: 'CI_SERVER_URL' };

    const url = getOriginUrl();
    if (url) {
        const host = hostFromOriginUrl(url);
        if (host) return { host, source: 'git remote' };
    }
    return undefined;
}

// Парсит GitLab project path из remote-URL.
function parseGitLabPath(url: string, expectedHost: string): string | undefined {
    let expected: string;
    try {
        expected = new URL(expectedHost).hostname;
    } catch {
        return undefined;
    }

    // git@host:group/project.git  или  ssh://git@host/group/project.git
    const ssh = url.match(/^(?:ssh:\/\/)?(?:[^@]+@)?([^:/]+)[:/](.+?)(?:\.git)?$/);
    if (ssh && ssh[1] === expected && ssh[2] && !url.startsWith('http')) {
        return ssh[2];
    }

    // https://host/group/project.git
    try {
        const u = new URL(url);
        if (u.hostname === expected) {
            return u.pathname.replace(/^\//, '').replace(/\.git$/, '');
        }
    } catch {
        // не URL
    }
    return undefined;
}

function detectProjectId(expectedHost: string): { id: string; source: ProjectIdSource } | undefined {
    const ciPath = process.env.CI_PROJECT_PATH;
    if (ciPath) return { id: encodeURIComponent(ciPath), source: 'CI_PROJECT_PATH' };

    const ciId = process.env.CI_PROJECT_ID;
    if (ciId) return { id: ciId, source: 'CI_PROJECT_ID' };

    const url = getOriginUrl();
    if (url) {
        const gitPath = parseGitLabPath(url, expectedHost);
        if (gitPath) return { id: encodeURIComponent(gitPath), source: 'git remote' };
    }
    return undefined;
}

function parseCli(): Config {
    let parsed;
    try {
        parsed = parseArgs({
            args: process.argv.slice(2),
            allowPositionals: true,
            options: {
                config:          { type: 'string' },
                host:            { type: 'string' },
                token:           { type: 'string' },
                limit:           { type: 'string' },
                'status-filter': { type: 'string' },
                help:            { type: 'boolean', short: 'h' },
            },
        });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        err(`Failed to parse arguments: ${msg}\n\n${HELP}`);
        process.exit(1);
    }

    const { values, positionals } = parsed;

    if (values.help) {
        out(HELP);
        process.exit(0);
    }

    if (positionals.length > 1) {
        err(`Unexpected positional arguments: ${positionals.slice(1).join(' ')}\n\n${HELP}`);
        process.exit(1);
    }

    const pick = (flag: string | undefined, env: string | undefined, fallback?: string): string | undefined =>
        flag ?? env ?? fallback;

    const required = (name: string, value: string | undefined, flag: string, envVar: string): string => {
        if (!value) {
            err(`Missing ${name}: pass ${flag} or set ${envVar} (see .env.example)\n`);
            process.exit(1);
        }
        return value;
    };

    const token = required('token', pick(values.token, process.env.GITLAB_TOKEN), '--token', 'GITLAB_TOKEN');

    // --- Host: --host → GITLAB_HOST → CI_SERVER_URL → git remote
    let host:       string;
    let hostSource: HostSource;

    if (values.host) {
        host       = values.host;
        hostSource = 'arg';
    } else if (process.env.GITLAB_HOST) {
        host       = process.env.GITLAB_HOST;
        hostSource = 'GITLAB_HOST';
    } else {
        const detected = detectHost();
        if (!detected) {
            err(
                `Missing --host / GITLAB_HOST and could not auto-detect ` +
                `(no CI_SERVER_URL and git remote 'origin' is unavailable or unparseable).\n\n${HELP}`
            );
            process.exit(1);
        }
        host       = detected.host;
        hostSource = detected.source;
    }

    // --- PROJECT_ID: явный аргумент → CI env → git remote
    let projectId:       string;
    let projectIdSource: ProjectIdSource;

    if (positionals[0]) {
        projectId       = positionals[0];
        projectIdSource = 'arg';
    } else {
        const detected = detectProjectId(host);
        if (!detected) {
            err(
                `Missing PROJECT_ID and could not auto-detect ` +
                `(no CI_PROJECT_PATH/CI_PROJECT_ID and git remote 'origin' does not point to ${host}).\n\n${HELP}`
            );
            process.exit(1);
        }
        projectId       = detected.id;
        projectIdSource = detected.source;
    }

    // --- Конфиг групп
    // Приоритет: --config → env GITLAB_PIPELINE_STATS_CONFIG → ./gitlab-pipeline-stats.json в cwd.
    // Имена встроенных пресетов больше не принимаются — только путь к JSON.
    let configInput: string | undefined = pick(values.config, process.env.GITLAB_PIPELINE_STATS_CONFIG);
    let configSource: ConfigSource;
    if (values.config !== undefined) {
        configSource = 'flag';
    } else if (process.env.GITLAB_PIPELINE_STATS_CONFIG) {
        configSource = 'env';
    } else {
        const cwdConfig = path.resolve(process.cwd(), DEFAULT_CONFIG_FILENAME);
        if (fs.existsSync(cwdConfig)) {
            configInput  = cwdConfig;
            configSource = 'cwd';
        } else {
            err(
                `No config provided.\n` +
                `Pass --config <path>, set GITLAB_PIPELINE_STATS_CONFIG, ` +
                `or place ${DEFAULT_CONFIG_FILENAME} in the current directory.\n` +
                `To bootstrap from a bundled preset:\n` +
                `  gitlab-pipeline-stats init <preset> > ${DEFAULT_CONFIG_FILENAME}\n` +
                `Bundled presets: ${listBuiltinPresets().join(', ')}\n`
            );
            process.exit(1);
        }
    }

    let configName: string;
    let configPath: string;
    let groups:     GroupSpec[];
    try {
        const absPath = resolveConfigPath(configInput!);
        const loaded  = loadConfigFile(absPath);
        configName = loaded.name;
        configPath = loaded.absPath;
        groups     = loaded.data.groups;
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        err(`${msg}\n`);
        process.exit(1);
    }

    return {
        projectId,
        projectIdSource,
        host,
        hostSource,
        token,
        limit:        pick(values.limit,            process.env.PIPELINE_LIMIT,    '50')      ?? '50',
        statusFilter: pick(values['status-filter'], process.env.JOB_STATUS_FILTER, 'success') ?? 'success',
        configName,
        configPath,
        configSource,
        groups,
    };
}

// --- Subcommand routing -----------------------------------------------------

const argv0 = process.argv[2];
if (argv0 === 'list-presets') {
    cmdListPresets();
    process.exit(0);
}
if (argv0 === 'init') {
    cmdInit(process.argv[3]);
    process.exit(0);
}

const cfg = parseCli();

const API     = `${cfg.host.replace(/\/$/, '')}/api/v4`;
const HEADERS: Record<string, string> = { 'PRIVATE-TOKEN': cfg.token };

// --- Инфо-шапка -------------------------------------------------------------

out(`${DIM}GitLab:${CR}      ${cfg.host} ${DIM}(from ${cfg.hostSource})${CR}\n`);
out(`${DIM}Project:${CR}     ${cfg.projectId} ${DIM}(from ${cfg.projectIdSource})${CR}\n`);
out(`${DIM}Config:${CR}      ${cfg.configName} ${DIM}(from ${cfg.configSource}: ${cfg.configPath})${CR}\n`);
out(`${DIM}Pipelines:${CR}   ${cfg.limit} per group\n`);
out(`${DIM}Job filter:${CR}  status=${cfg.statusFilter || '<any>'}\n`);

// --- HTTP -------------------------------------------------------------------

async function get<T>(url: string): Promise<T> {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
    return res.json() as Promise<T>;
}

// --- Статистика -------------------------------------------------------------

function addStat(stats: StatsMap, name: string, duration: number): void {
    let s = stats[name];
    if (!s) {
        s = { count: 0, sumD: 0, durations: [], maxD: 0 };
        stats[name] = s;
    }
    s.count++;
    s.sumD += duration;
    s.durations.push(duration);
    if (duration > s.maxD) s.maxD = duration;
}

function pct(arr: readonly number[], p: number): number {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.min(Math.floor((p / 100) * (sorted.length - 1)), sorted.length - 1);
    return sorted[Math.max(0, idx)] ?? 0;
}

// --- Сбор данных ------------------------------------------------------------

// GitLab API: per_page max = 100.
const GITLAB_MAX_PER_PAGE = 100;

async function fetchPipelinesForGroup(spec: GroupSpec): Promise<number[]> {
    const limit = Math.max(1, Number.parseInt(cfg.limit, 10) || 50);

    const baseParams = new URLSearchParams();
    if (spec.ref)    baseParams.set('ref',    spec.ref);
    if (spec.scope)  baseParams.set('scope',  spec.scope);
    if (spec.source) baseParams.set('source', spec.source);
    if (spec.status) baseParams.set('status', spec.status);

    const matchesFilters = (p: GitLabPipelineSummary): boolean => {
        if (spec.refPattern        && !new RegExp(spec.refPattern).test(p.ref)) return false;
        if (spec.excludeRef        !== undefined && p.ref === spec.excludeRef)  return false;
        if (spec.excludeRefPattern && new RegExp(spec.excludeRefPattern).test(p.ref)) return false;
        return true;
    };

    const hasClientFilter = !!(spec.refPattern || spec.excludeRef !== undefined || spec.excludeRefPattern);

    // Без client-фильтров — одна страница ровно на limit (не качаем лишнее).
    if (!hasClientFilter) {
        baseParams.set('per_page', String(Math.min(limit, GITLAB_MAX_PER_PAGE)));
        const data = await get<GitLabPipelineSummary[]>(
            `${API}/projects/${cfg.projectId}/pipelines?${baseParams.toString()}`
        );
        return data.slice(0, limit).map((p) => p.id);
    }

    // С client-фильтрами — пагинация до набора limit отфильтрованных пайплайнов.
    // MAX_SCAN страхует от бесконечного цикла, если фильтр всё отбрасывает.
    const PER_PAGE = Math.min(GITLAB_MAX_PER_PAGE, Math.max(limit * 2, 50));
    const MAX_SCAN = limit * 10;

    const collected: number[] = [];
    let scanned = 0;
    let page    = 1;

    while (collected.length < limit && scanned < MAX_SCAN) {
        const params = new URLSearchParams(baseParams);
        params.set('per_page', String(PER_PAGE));
        params.set('page',     String(page));

        const batch = await get<GitLabPipelineSummary[]>(
            `${API}/projects/${cfg.projectId}/pipelines?${params.toString()}`
        );
        if (batch.length === 0) break;
        scanned += batch.length;

        for (const p of batch) {
            if (matchesFilters(p)) {
                collected.push(p.id);
                if (collected.length >= limit) break;
            }
        }

        if (batch.length < PER_PAGE) break;
        page++;
    }

    return collected;
}

const TOTAL_KEY = 'TOTAL' as const;

async function collect(ids: readonly number[]): Promise<StatsMap> {
    const stats: StatsMap = {};
    for (let i = 0; i < ids.length; i++) {
        const pid = ids[i];
        err(`\r  pipeline ${i + 1}/${ids.length} (id=${pid})        `);

        const pipeline = await get<GitLabPipeline>(`${API}/projects/${cfg.projectId}/pipelines/${pid}`);
        if (pipeline.duration != null) {
            addStat(stats, TOTAL_KEY, pipeline.duration);
        }

        const jobs = await get<GitLabJob[]>(`${API}/projects/${cfg.projectId}/pipelines/${pid}/jobs?per_page=100`);
        for (const job of jobs) {
            if (cfg.statusFilter && job.status !== cfg.statusFilter) continue;
            if (job.duration == null) continue;
            addStat(stats, job.name, job.duration);
        }
    }
    err(`\r${' '.repeat(60)}\r`);
    return stats;
}

// --- Рендер таблицы ---------------------------------------------------------

function fmtRow(
    name: string,
    n:    number | string,
    avg:  number | string,
    p50:  number | string,
    p95:  number | string,
    max:  number | string,
): string {
    const cell = (v: number | string): string =>
        typeof v === 'number' ? String(Math.round(v)) : v;
    return (
        name.padEnd(55).slice(0, 55) +
        cell(n).padStart(6) +
        cell(avg).padStart(9) +
        cell(p50).padStart(9) +
        cell(p95).padStart(9) +
        cell(max).padStart(9)
    );
}

const SEP_ROW = fmtRow('---', '---', '---', '---', '---', '---');

function render(label: string, stats: StatsMap): void {
    out(`\n${BOLD_CYAN}=== ${label} ===${CR}\n`);

    if (Object.keys(stats).length === 0) {
        out(`${DIM}  (no pipelines found)${CR}\n`);
        return;
    }

    out(`${BOLD_WHITE}${fmtRow('JOB', 'N', 'avg(s)', 'p50(s)', 'p95(s)', 'max(s)')}${CR}\n`);
    out(`${DIM}${SEP_ROW}${CR}\n`);

    const jobs: RenderRow[] = Object.entries(stats)
        .filter(([name]) => name !== TOTAL_KEY)
        .map(([name, s]) => ({
            name,
            n:   s.count,
            avg: s.sumD / s.count,
            p50: pct(s.durations, 50),
            p95: pct(s.durations, 95),
            max: s.maxD,
        }))
        .sort((a, b) => b.p50 - a.p50);

    for (const j of jobs) {
        out(`${fmtRow(j.name, j.n, j.avg, j.p50, j.p95, j.max)}\n`);
    }

    const t = stats[TOTAL_KEY];
    if (t) {
        out(`${DIM}${SEP_ROW}${CR}\n`);
        out(
            `${BOLD_YELLOW}` +
            fmtRow(
                'TOTAL pipeline (wall)',
                t.count,
                t.sumD / t.count,
                pct(t.durations, 50),
                pct(t.durations, 95),
                t.maxD,
            ) +
            `${CR}\n`
        );
    }
}

// --- Оркестрация ------------------------------------------------------------

async function analyze(spec: GroupSpec): Promise<void> {
    const ids = await fetchPipelinesForGroup(spec);
    if (ids.length === 0) {
        out(`\n${BOLD_CYAN}=== ${spec.label} ===${CR}\n`);
        out(`${DIM}  (no pipelines found)${CR}\n`);
        return;
    }
    err(`\n${DIM}>>> ${spec.label}: fetching ${ids.length} pipeline(s)${CR}\n`);
    const stats = await collect(ids);
    render(spec.label, stats);
}

async function main(): Promise<void> {
    for (const group of cfg.groups) {
        await analyze(group);
    }
}

main().catch((e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    err(`Error: ${msg}\n`);
    process.exit(1);
});
