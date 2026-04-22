// Парсер section-маркеров GitLab CI из job trace.
//
// Канонический формат маркера (как его эмитит, например, bash-хелпер
// section() и сама документация GitLab):
//   \e[0Ksection_start:<unix_ts>:<name>[collapsed=true]\r\e[0K<header text>
//   ... commands ...
//   \e[0Ksection_end:<unix_ts>:<name>\r\e[0K
//
// Однако GitLab Runner свои собственные встроенные секции
// (`prepare_executor`, `prepare_script`, `get_sources`, `step_script`,
// `upload_artifacts_on_*`, `cleanup_file_variables`, …) эмитит немного
// иначе: у `section_start` обычно есть префикс \e[0K, а у `section_end`
// его нет — это просто строка `section_end:TS:NAME\n` без ANSI-обвязки.
//
// Поэтому парсер не привязывается к ANSI-обвязке вообще: он бьёт trace
// на «строки» (с учётом \r как терминального carriage-return), снимает
// с каждой строки ANSI-escape'ы и пытается распарсить чистый маркер
// `section_(start|end):TS:NAME[opts]?`. Так покрываются оба формата.

export interface ParsedTraceSections {
    // Сумма длительностей по каждому уникальному имени секции в одном trace.
    // Если секция повторяется внутри джобы — суммируем.
    durations: Map<string, number>;
    // Порядок появления секций в trace (только первое вхождение каждого имени).
    order: string[];
    // Имена start-маркеров, оставшихся без парного end (job killed mid-section,
    // обрезанный trace или реально нестандартный формат маркера).
    // Порядок — снизу вверх по LIFO-стеку (внешние секции первыми).
    orphanNames: string[];
}

// Любая ANSI/CSI escape-последовательность вида \x1b[...X — режется целиком.
const ANSI_RE   = /\x1b\[[0-9;?]*[A-Za-z]/g;
// Маркер на уже «очищенной от ANSI» строке. Имя секции — всё, кроме [ и ].
const MARKER_RE = /^section_(start|end):(\d+):([^\[\]]+?)(?:\[[^\]]*\])?$/;

export function parseTraceSections(trace: string): ParsedTraceSections {
    const durations = new Map<string, number>();
    const order: string[] = [];
    const seen = new Set<string>();
    const stack: Array<{ name: string; ts: number }> = [];

    // Бьём поток и по \n, и по \r: GitLab CI после имени секции обычно
    // ставит \r\e[0K, чтобы терминал перерисовал текущую строку header'ом
    // секции — для нас этот \r точно так же отделяет токен с маркером
    // от заголовка секции.
    for (const raw of trace.split(/[\r\n]+/)) {
        const cleaned = raw.replace(ANSI_RE, '').trim();
        if (!cleaned.startsWith('section_')) continue;

        const m = MARKER_RE.exec(cleaned);
        if (!m) continue;

        const kind = m[1]!;
        const ts   = Number.parseInt(m[2]!, 10);
        const name = m[3]!.trim();
        if (!name || !Number.isFinite(ts)) continue;

        if (kind === 'start') {
            stack.push({ name, ts });
            if (!seen.has(name)) {
                seen.add(name);
                order.push(name);
            }
            continue;
        }

        // kind === 'end' — парсим как LIFO. Если top не совпадает по имени,
        // считаем end-маркер мусорным и игнорируем (нестандартное вложение
        // или повреждённый поток).
        const top = stack[stack.length - 1];
        if (top && top.name === name) {
            stack.pop();
            const dur = Math.max(0, ts - top.ts);
            durations.set(name, (durations.get(name) ?? 0) + dur);
        }
    }

    return { durations, order, orphanNames: stack.map((f) => f.name) };
}
