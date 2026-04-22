// Хелперы вокруг bundled-пресетов: чтение версии пакета и подмена
// относительной ссылки `$schema` на стабильный CDN-URL для `init`.
//
// Вынесено в отдельный модуль, чтобы можно было покрыть unit-тестами без
// запуска основного CLI (там есть top-level side effects: parseCli, fetch).

import * as fs   from 'node:fs';
import * as path from 'node:path';

// Шаблон относительной ссылки в bundled пресетах (`configs/*.json`):
//   "$schema": "../schemas/config.schema.json"
// Этот путь корректен только в контексте монорепы тулзы. Когда пользователь
// делает `init <preset> > some/where/my-config.json`, относительный путь
// ломается — нужно подменять на абсолютный URL.
const BUNDLED_SCHEMA_RE =
    /"\$schema"\s*:\s*"\.\.\/schemas\/config\.schema\.json"/;

// Стабильный CDN, отдающий npm-пакеты как статику. Привязка к конкретной
// версии важна: схема может расширяться, а конфиги пользователей
// останутся валидными для своей версии CLI.
const CDN_BASE = 'https://cdn.jsdelivr.net/npm/gitlab-pipeline-stats';

export function buildSchemaUrl(version: string): string {
    return `${CDN_BASE}@${version}/schemas/config.schema.json`;
}

// Подменяет в JSON-тексте пресета относительный `$schema` на CDN-URL,
// привязанный к переданной версии. Если поля `$schema` нет — текст
// возвращается как есть (без вставки нового поля, чтобы не рисковать
// с форматированием произвольного JSON-а).
export function rewritePresetSchemaUrl(raw: string, version: string): string {
    return raw.replace(
        BUNDLED_SCHEMA_RE,
        `"$schema": "${buildSchemaUrl(version)}"`,
    );
}

// Читает версию из package.json, лежащего рядом со скриптом (через `bin/`
// в исходниках, через `dist/` после сборки — оба варианта в корне репы).
// На непредвиденный случай (битый/отсутствующий package.json) откатываемся
// на 'latest', чтобы init всё равно отработал.
export function readPackageVersion(scriptDir: string): string {
    try {
        const pkgPath = path.join(scriptDir, '..', 'package.json');
        const raw     = fs.readFileSync(pkgPath, 'utf8');
        const parsed  = JSON.parse(raw) as { version?: unknown };
        if (typeof parsed.version === 'string' && parsed.version.length > 0) {
            return parsed.version;
        }
    } catch {
        // ignore — упадём на 'latest' ниже
    }
    return 'latest';
}
