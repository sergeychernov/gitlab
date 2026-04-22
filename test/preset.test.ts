// Unit-тесты на подмену `$schema` в bundled пресетах при `init`.
// Запуск (Node 24+):
//   node --test test/preset.test.ts

import { describe, it } from 'node:test';
import * as assert      from 'node:assert/strict';
import * as fs          from 'node:fs';
import * as os          from 'node:os';
import * as path        from 'node:path';

import {
    buildSchemaUrl,
    readPackageVersion,
    rewritePresetSchemaUrl,
} from '../bin/preset.ts';

describe('buildSchemaUrl', () => {
    it('собирает версионированный URL на jsdelivr', () => {
        assert.equal(
            buildSchemaUrl('1.2.3'),
            'https://cdn.jsdelivr.net/npm/gitlab-pipeline-stats@1.2.3/schemas/config.schema.json',
        );
    });

    it('поддерживает dist-tag вместо версии', () => {
        assert.equal(
            buildSchemaUrl('latest'),
            'https://cdn.jsdelivr.net/npm/gitlab-pipeline-stats@latest/schemas/config.schema.json',
        );
    });
});

describe('rewritePresetSchemaUrl', () => {
    it('подменяет относительный $schema на CDN-URL с версией', () => {
        const raw = [
            '{',
            '    "$schema": "../schemas/config.schema.json",',
            '    "description": "Git Flow",',
            '    "groups": []',
            '}',
        ].join('\n');

        const out = rewritePresetSchemaUrl(raw, '1.1.2');

        assert.match(
            out,
            /"\$schema":\s*"https:\/\/cdn\.jsdelivr\.net\/npm\/gitlab-pipeline-stats@1\.1\.2\/schemas\/config\.schema\.json"/,
        );
        // прежней относительной ссылки не остаётся
        assert.doesNotMatch(out, /\.\.\/schemas\/config\.schema\.json/);
        // остальной JSON не трогается
        assert.match(out, /"description":\s*"Git Flow"/);
    });

    it('не трогает текст, если $schema отсутствует', () => {
        const raw = '{ "groups": [] }';
        assert.equal(rewritePresetSchemaUrl(raw, '1.1.2'), raw);
    });

    it('сохраняет валидный JSON после подмены', () => {
        const raw = JSON.stringify({
            $schema: '../schemas/config.schema.json',
            description: 'preset',
            groups: [{ label: 'main', ref: 'main' }],
        }, null, 4);

        const parsed = JSON.parse(rewritePresetSchemaUrl(raw, '9.9.9')) as {
            $schema: string;
            groups: unknown[];
        };

        assert.equal(
            parsed.$schema,
            'https://cdn.jsdelivr.net/npm/gitlab-pipeline-stats@9.9.9/schemas/config.schema.json',
        );
        assert.equal(parsed.groups.length, 1);
    });
});

describe('readPackageVersion', () => {
    it('читает version из package.json рядом со скриптом', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gps-pkg-'));
        const scriptDir = path.join(tmp, 'bin');
        fs.mkdirSync(scriptDir);
        fs.writeFileSync(
            path.join(tmp, 'package.json'),
            JSON.stringify({ name: 'x', version: '4.5.6' }),
        );

        assert.equal(readPackageVersion(scriptDir), '4.5.6');
    });

    it('откатывается на "latest", если package.json не найден', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gps-pkg-'));
        const scriptDir = path.join(tmp, 'bin');
        fs.mkdirSync(scriptDir);

        assert.equal(readPackageVersion(scriptDir), 'latest');
    });

    it('откатывается на "latest" при битом JSON', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gps-pkg-'));
        const scriptDir = path.join(tmp, 'bin');
        fs.mkdirSync(scriptDir);
        fs.writeFileSync(path.join(tmp, 'package.json'), '{ not json');

        assert.equal(readPackageVersion(scriptDir), 'latest');
    });

    it('откатывается на "latest", если поле version отсутствует / пустое', () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gps-pkg-'));
        const scriptDir = path.join(tmp, 'bin');
        fs.mkdirSync(scriptDir);
        fs.writeFileSync(
            path.join(tmp, 'package.json'),
            JSON.stringify({ name: 'x', version: '' }),
        );

        assert.equal(readPackageVersion(scriptDir), 'latest');
    });
});
