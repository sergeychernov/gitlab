// Unit-тесты на парсер section-маркеров GitLab CI.
// Запуск (Node 24+):
//   node --test test/sections.test.ts

import { describe, it } from 'node:test';
import * as assert      from 'node:assert/strict';

import { parseTraceSections } from '../bin/sections.ts';

// Удобный конструктор маркеров — точно повторяет формат, который
// эмитит section() helper в bash:
//   \e[0Ksection_start:<ts>:<name>[collapsed=true]\r\e[0K<header>\n
const ESC = '\x1b';
const start = (ts: number, name: string, opts = '[collapsed=true]'): string =>
    `${ESC}[0Ksection_start:${ts}:${name}${opts}\r${ESC}[0K${name}\n`;
const end = (ts: number, name: string): string =>
    `${ESC}[0Ksection_end:${ts}:${name}\r${ESC}[0K\n`;

describe('parseTraceSections', () => {

    it('парсит простую плоскую последовательность секций', () => {
        const trace =
            start(100, 'install') +
            'npm install ...\n' +
            end(140, 'install') +
            start(140, 'test') +
            'jest ...\n' +
            end(210, 'test');

        const r = parseTraceSections(trace);
        assert.deepEqual(r.order, ['install', 'test']);
        assert.equal(r.durations.get('install'), 40);
        assert.equal(r.durations.get('test'),    70);
        assert.deepEqual(r.orphanNames, []);
    });

    it('суммирует длительности повторяющихся секций', () => {
        const trace =
            start(0, 'cache') + end(5, 'cache') +
            start(10, 'build') + end(50, 'build') +
            start(60, 'cache') + end(63, 'cache') +
            start(70, 'cache') + end(72, 'cache');

        const r = parseTraceSections(trace);
        // первое появление определяет позицию в order
        assert.deepEqual(r.order, ['cache', 'build']);
        // 5 + 3 + 2 = 10
        assert.equal(r.durations.get('cache'), 10);
        assert.equal(r.durations.get('build'), 40);
        assert.deepEqual(r.orphanNames, []);
    });

    it('считает orphan-секции, у которых нет end-маркера', () => {
        const trace =
            start(100, 'install') +
            'npm install ...\n' +
            end(150, 'install') +
            start(150, 'long_step') +
            'this job got killed mid-section, no matching end follows\n';

        const r = parseTraceSections(trace);
        assert.deepEqual(r.order, ['install', 'long_step']);
        assert.equal(r.durations.get('install'), 50);
        assert.equal(r.durations.has('long_step'), false);
        assert.deepEqual(r.orphanNames, ['long_step']);
    });

    it('игнорирует ANSI-шум и обычные строки лога вокруг маркеров', () => {
        const noise =
            `${ESC}[31mERROR${ESC}[0m some unrelated text with control chars: ${ESC}[?25l\n` +
            'plain log line\n' +
            `progress: 42% \r79%\r100%\n`;

        const trace =
            noise +
            start(1000, 'lint') +
            noise +
            end(1015, 'lint') +
            noise;

        const r = parseTraceSections(trace);
        assert.deepEqual(r.order, ['lint']);
        assert.equal(r.durations.get('lint'), 15);
        assert.deepEqual(r.orphanNames, []);
    });

    it('обрабатывает вложенные секции по LIFO-стеку', () => {
        // outer { inner } outer
        const trace =
            start(0, 'outer') +
            start(2, 'inner') +
            end(7, 'inner') +
            end(10, 'outer');

        const r = parseTraceSections(trace);
        assert.deepEqual(r.order, ['outer', 'inner']);
        assert.equal(r.durations.get('inner'), 5);
        assert.equal(r.durations.get('outer'), 10);
        assert.deepEqual(r.orphanNames, []);
    });

    it('игнорирует end-маркер с именем, не совпадающим с верхушкой стека', () => {
        // start A, start B, end C (мусор), end B, end A
        const trace =
            start(0,  'A') +
            start(2,  'B') +
            end  (5,  'C') + // мусорный end — игнорируем
            end  (7,  'B') +
            end  (10, 'A');

        const r = parseTraceSections(trace);
        assert.deepEqual(r.order, ['A', 'B']);
        assert.equal(r.durations.get('B'), 5);
        assert.equal(r.durations.get('A'), 10);
        assert.equal(r.durations.has('C'), false);
        assert.deepEqual(r.orphanNames, []);
    });

    it('работает без блока [options] и без collapsed=true', () => {
        const trace =
            `${ESC}[0Ksection_start:100:plain\r${ESC}[0Kplain\n` +
            'work\n' +
            `${ESC}[0Ksection_end:120:plain\r${ESC}[0K\n`;

        const r = parseTraceSections(trace);
        assert.deepEqual(r.order, ['plain']);
        assert.equal(r.durations.get('plain'), 20);
    });

    it('возвращает пустой результат для trace без маркеров', () => {
        const r = parseTraceSections('just some plain log\nwithout markers\n');
        assert.equal(r.durations.size, 0);
        assert.deepEqual(r.order, []);
        assert.deepEqual(r.orphanNames, []);
    });

    it('возвращает имена незакрытых секций в orphanNames (внешние первыми)', () => {
        // Стек: outer → mid → inner. Закрылся только inner. mid и outer остались
        // незакрытыми — их имена должны попасть в orphanNames в порядке
        // «внешний → внутренний».
        const trace =
            start(0,  'outer') +
            start(2,  'mid') +
            start(5,  'inner') +
            end  (8,  'inner');

        const r = parseTraceSections(trace);
        assert.deepEqual(r.orphanNames, ['outer', 'mid']);
        assert.equal(r.durations.get('inner'), 3);
        assert.equal(r.durations.has('mid'),   false);
        assert.equal(r.durations.has('outer'), false);
    });

    it('понимает «гибридный» формат gitlab-runner (start с \\e[0K, end — голый)', () => {
        // Так gitlab-runner эмитит свои встроенные секции в реальном trace.
        // start идёт с префиксом \e[0K и хвостом \r\e[0K, а end — просто
        // строка `section_end:TS:NAME\n` без какой-либо ANSI-обвязки.
        const trace =
            `${ESC}[0Ksection_start:100:get_sources\r${ESC}[0K${ESC}[36;1mGetting sources${ESC}[0;m\n` +
            `Fetching changes...\n` +
            `section_end:140:get_sources\n` +
            `${ESC}[0Ksection_start:140:step_script\r${ESC}[0K${ESC}[36;1mExecuting step_script${ESC}[0;m\n` +
            `running user script\n` +
            `section_end:200:step_script\n`;

        const r = parseTraceSections(trace);
        assert.deepEqual(r.order, ['get_sources', 'step_script']);
        assert.equal(r.durations.get('get_sources'), 40);
        assert.equal(r.durations.get('step_script'), 60);
        assert.deepEqual(r.orphanNames, []);
    });

    it('правильно вкладывает user-секции внутрь runner-секции step_script', () => {
        // Реальная структура: runner оборачивает user-блок в step_script,
        // внутри уже user секции из section() helper. Все маркеры разного
        // формата должны корректно сматчиться, а stack — вернуться к нулю.
        const trace =
            `${ESC}[0Ksection_start:0:step_script\r${ESC}[0Kheader\n` +
            start(1, 'install') +
            `installing...\n` +
            end(11, 'install') +
            start(11, 'test') +
            `testing...\n` +
            end(31, 'test') +
            `section_end:32:step_script\n`;

        const r = parseTraceSections(trace);
        assert.deepEqual(r.order, ['step_script', 'install', 'test']);
        assert.equal(r.durations.get('step_script'), 32);
        assert.equal(r.durations.get('install'),     10);
        assert.equal(r.durations.get('test'),        20);
        assert.deepEqual(r.orphanNames, []);
    });
});
