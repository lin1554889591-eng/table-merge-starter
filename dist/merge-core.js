/* Table Merge: browser and Node.js data core. No network or dependencies. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TableMergeCore = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  const SOURCE_NAMES = ['來源檔案', '來源工作表', '來源列號'];
  const NUMERIC = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

  function asText(value) {
    if (value === null || value === undefined) return '';
    if (['string', 'number', 'boolean', 'bigint'].includes(typeof value)) return String(value);
    throw new TypeError('儲存格必須是文字、數字或布林值；請先將日期或物件轉成文字。');
  }

  function csvError(message, line, column) {
    const error = new Error('CSV 第 ' + line + ' 行、第 ' + column + ' 字元：' + message);
    error.name = 'CSVParseError';
    error.line = line;
    error.column = column;
    return error;
  }

  function parseWithDelimiter(text, delimiter) {
    const rows = [];
    let row = [], field = '', state = 'start';
    let line = 1, column = 1, previousCR = false;

    function advance(character) {
      if (character === '\r') { line += 1; column = 1; }
      else if (character === '\n') {
        if (!previousCR) line += 1;
        column = 1;
      } else column += 1;
      previousCR = character === '\r';
    }
    function finishField() { row.push(field); field = ''; state = 'start'; }
    function finishRow() { finishField(); rows.push(row); row = []; }

    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      if (state === 'quoted') {
        if (character === '"') state = 'closed';
        else field += character;
      } else if (state === 'closed' && character === '"') {
        field += '"';
        state = 'quoted';
      } else if (character === delimiter) {
        finishField();
      } else if (character === '\r' || character === '\n') {
        finishRow();
        if (character === '\r' && text[index + 1] === '\n') {
          advance(character);
          index += 1;
          advance('\n');
          continue;
        }
      } else if (state === 'closed') {
        throw csvError('結束引號後只能接分隔符號或換行。', line, column);
      } else if (character === '"') {
        if (state !== 'start') throw csvError('未加引號的欄位中出現引號。', line, column);
        state = 'quoted';
      } else {
        field += character;
        state = 'unquoted';
      }
      advance(character);
    }

    if (state === 'quoted') throw csvError('引號欄位沒有結束。', line, column);
    if (row.length || field.length || state !== 'start') finishRow();
    return rows;
  }

  function isBlank(row) { return row.every(value => asText(value).trim() === ''); }

  function parseCSV(text, options) {
    options = options || {};
    if (typeof text !== 'string') throw new TypeError('CSV 內容必須是文字。');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const delimiter = options.delimiter === undefined ? 'auto' : options.delimiter;
    if (delimiter !== 'auto') {
      if (typeof delimiter !== 'string' || delimiter.length !== 1 || /["\r\n]/.test(delimiter)) {
        throw new Error('分隔符號必須是單一字元，且不能是引號或換行。');
      }
      return { rows: parseWithDelimiter(text, delimiter), delimiter };
    }

    // Prefer a candidate that yields a multi-column header and consistent rows.
    // Ambiguous one-column files use comma; users can explicitly choose a delimiter.
    const attempts = [',', '\t', ';'].map(candidate => {
      try {
        const rows = parseWithDelimiter(text, candidate);
        const nonblank = rows.filter(row => !isBlank(row));
        const width = nonblank.length ? nonblank[0].length : 1;
        const sample = nonblank.slice(0, 50);
        const matching = sample.filter(row => row.length === width).length;
        const consistency = sample.length ? matching / sample.length : 1;
        return { delimiter: candidate, rows, score: (width > 1 ? 1000 : 0) + consistency * 100 + Math.min(width, 50) };
      } catch (error) { return { delimiter: candidate, error }; }
    });
    const candidates = attempts.filter(attempt => !attempt.error);
    if (!candidates.length) throw attempts[0].error;
    candidates.sort((left, right) => right.score - left.score);
    return { rows: candidates[0].rows, delimiter: candidates[0].delimiter };
  }

  function validateColumns(columns) {
    if (!Array.isArray(columns)) throw new TypeError('欄位清單必須是陣列。');
    const seen = new Set();
    Array.from(columns).forEach((column, index) => {
      if (typeof column !== 'string' || !column.trim()) throw new Error('第 ' + (index + 1) + ' 欄缺少欄位名稱。');
      if (seen.has(column)) throw new Error('欄位名稱重複：「' + column + '」。請先改成不同名稱。');
      seen.add(column);
    });
  }

  function normalizeTable(rows, options) {
    options = options || {};
    if (!Array.isArray(rows)) throw new TypeError('資料列必須是陣列。');
    const sourceFile = asText(options.fileName);
    const sourceSheet = asText(options.sheetName);
    const label = [sourceFile, sourceSheet].filter(Boolean).join(' / ') || '資料表';
    const cleanRows = Array.from(rows, (row, index) => {
      if (!Array.isArray(row)) throw new TypeError(label + ' 第 ' + (index + 1) + ' 列不是陣列。');
      return Array.from(row, asText);
    });
    const headerIndex = cleanRows.findIndex(row => !isBlank(row));
    if (headerIndex < 0) return { columns: [], records: [], warnings: [label + '：沒有可讀取的欄位或資料。'] };
    const columns = cleanRows[headerIndex].map(value => value.trim());
    try { validateColumns(columns); }
    catch (error) { throw new Error(label + ' 表頭（第 ' + (headerIndex + 1) + ' 列）：' + error.message); }
    const records = [], warnings = [];
    let skipped = 0;

    for (let index = headerIndex + 1; index < cleanRows.length; index += 1) {
      const row = cleanRows[index];
      if (isBlank(row)) { skipped += 1; continue; }
      if (row.length > columns.length) {
        throw new Error(label + ' 第 ' + (index + 1) + ' 列有 ' + row.length + ' 欄，但表頭只有 ' + columns.length + ' 欄。請檢查分隔符號或補齊表頭。');
      }
      const values = Object.create(null);
      columns.forEach((column, columnIndex) => { values[column] = row[columnIndex] === undefined ? '' : row[columnIndex]; });
      records.push({ values, sourceFile, sourceSheet, sourceRow: index + 1 });
    }
    if (headerIndex) warnings.push(label + '：表頭前略過 ' + headerIndex + ' 列空白列。');
    if (skipped) warnings.push(label + '：略過 ' + skipped + ' 列空白資料。');
    return { columns, records, warnings };
  }

  function recordValue(record, column) {
    if (!record || !record.values || typeof record.values !== 'object') throw new TypeError('資料列缺少 values 欄位。');
    return hasOwn(record.values, column) ? asText(record.values[column]) : '';
  }

  function mergeTables(tables, options) {
    options = options || {};
    const mode = options.mode === undefined ? 'union' : options.mode;
    const dedupe = options.dedupe === undefined ? false : options.dedupe;
    const requestedKeys = options.keyColumns === undefined ? [] : options.keyColumns;
    if (!Array.isArray(tables)) throw new TypeError('資料表清單必須是陣列。');
    if (!['union', 'intersection'].includes(mode)) throw new Error('合併模式必須是 union 或 intersection。');
    if (typeof dedupe !== 'boolean') throw new TypeError('dedupe 必須是 true 或 false。');
    if (!Array.isArray(requestedKeys)) throw new TypeError('比對欄位必須是陣列。');
    const warnings = [];
    tables.forEach(table => {
      if (!table || !Array.isArray(table.records)) throw new TypeError('資料表缺少 records 陣列。');
      validateColumns(table.columns);
      if (!table.columns.length && table.records.length) throw new Error('有資料的表格必須提供欄位名稱。');
      if (Array.isArray(table.warnings)) warnings.push(...table.warnings);
    });
    const active = tables.filter(table => table.columns.length);
    const allColumns = Array.from(new Set(active.flatMap(table => table.columns)));
    const columns = mode === 'union' ? allColumns : (active.length ? active[0].columns.filter(column => active.every(table => table.columns.includes(column))) : []);
    if (mode === 'intersection' && active.length && !columns.length) {
      throw new Error('這些資料表沒有共同欄位。請改用「保留全部欄位」，或先統一欄位名稱。');
    }
    if (mode === 'intersection') {
      const removedColumns = allColumns.filter(column => !columns.includes(column));
      if (removedColumns.length) warnings.push('共同欄位模式已排除 ' + removedColumns.length + ' 個欄位：' + removedColumns.slice(0, 10).join('、') + (removedColumns.length > 10 ? '…' : '') + '。這些欄位的值不會出現在輸出中。');
    }
    const keyColumns = requestedKeys.length ? requestedKeys.slice() : columns.slice();
    if (new Set(keyColumns).size !== keyColumns.length) throw new Error('比對欄位不可重複選取。');
    keyColumns.forEach(column => {
      if (!columns.includes(column)) throw new Error('比對欄位「' + asText(column) + '」不在合併後的欄位中。');
    });
    const records = [], seen = new Map();
    let totalRows = 0, duplicateCount = 0, removedCount = 0, differingDuplicates = 0;
    active.forEach(table => {
      table.records.forEach(record => {
        totalRows += 1;
        const values = Object.create(null);
        columns.forEach(column => { values[column] = recordValue(record, column); });
        const projected = { values, sourceFile: asText(record.sourceFile), sourceSheet: asText(record.sourceSheet), sourceRow: record.sourceRow === undefined ? '' : record.sourceRow };
        const key = JSON.stringify(keyColumns.map(column => values[column]));
        if (seen.has(key)) {
          duplicateCount += 1;
          if (dedupe) {
            removedCount += 1;
            const first = seen.get(key);
            if (columns.some(column => first.values[column] !== values[column])) differingDuplicates += 1;
            return;
          }
        } else seen.set(key, projected);
        records.push(projected);
      });
    });
    if (differingDuplicates) warnings.push('依指定欄位去除重複時，有 ' + differingDuplicates + ' 列的其他欄位內容不同；已保留檔案順序中最早出現的一列。請確認這符合你的用途。');
    return { columns, records, totalRows, duplicateCount, removedCount, warnings };
  }

  function getExportColumns(columns, options) {
    options = options || {};
    validateColumns(columns);
    const exportColumns = columns.slice();
    if (options.includeSource !== false) {
      const used = new Set(exportColumns);
      SOURCE_NAMES.forEach(base => {
        let name = base, suffix = 2;
        while (used.has(name)) { name = base + '_' + suffix; suffix += 1; }
        used.add(name);
        exportColumns.push(name);
      });
    }
    return exportColumns;
  }

  function buildExportRows(columns, records, options) {
    options = options || {};
    if (!Array.isArray(records)) throw new TypeError('輸出資料必須是陣列。');
    const result = [getExportColumns(columns, options)];
    records.forEach(record => {
      const row = columns.map(column => recordValue(record, column));
      if (options.includeSource !== false) row.push(asText(record.sourceFile), asText(record.sourceSheet), asText(record.sourceRow));
      result.push(row);
    });
    return result;
  }

  function escapeCSV(value, safeSpreadsheet) {
    let text = asText(value);
    // Quote alone does not disable spreadsheet formulas. Prefix the cell itself.
    if (safeSpreadsheet && /^[\s\uFEFF]*[=+\-@\t\r\n]/.test(text)) text = "'" + text;
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function toCSV(columns, records, options) {
    options = options || {};
    const rows = buildExportRows(columns, records, options);
    return '\uFEFF' + rows.map(row => row.map(value => escapeCSV(value, options.safeSpreadsheet !== false)).join(',')).join('\r\n') + '\r\n';
  }

  function summarizeColumn(records, column) {
    if (!Array.isArray(records)) throw new TypeError('統計資料必須是陣列。');
    let validCount = 0, emptyCount = 0, invalidCount = 0;
    let sum = 0, correction = 0, overflow = false;
    records.forEach(record => {
      const text = recordValue(record, column).trim();
      if (!text) { emptyCount += 1; return; }
      const value = NUMERIC.test(text) ? Number(text) : NaN;
      if (!Number.isFinite(value)) { invalidCount += 1; return; }
      validCount += 1;
      if (overflow) return;
      const next = sum + value;
      if (!Number.isFinite(next)) { overflow = true; return; }
      correction += Math.abs(sum) >= Math.abs(value) ? (sum - next) + value : (value - next) + sum;
      sum = next;
    });
    const corrected = sum + correction;
    if (!Number.isFinite(corrected)) overflow = true;
    const result = { count: records.length, validCount, emptyCount, invalidCount, sum: validCount && !overflow ? corrected : null };
    if (overflow) result.overflow = true;
    return result;
  }

  return Object.freeze({ parseCSV, normalizeTable, mergeTables, getExportColumns, buildExportRows, toCSV, summarizeColumn });
}));
