'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Core = require('../dist/merge-core.js');

function table(text, fileName = 'sample.csv', options) {
  return Core.normalizeTable(Core.parseCSV(text, options).rows, { fileName, sheetName: 'Sheet1' });
}

test('browser script exposes the same buildless API without CommonJS', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(require.resolve('../dist/merge-core.js'), 'utf8'), context);
  assert.equal(typeof context.TableMergeCore.parseCSV, 'function');
  assert.equal(context.TableMergeCore.parseCSV('A,B\n1,2').rows[1][1], '2');
});

test('CSV preserves BOM-safe headers, leading zeroes, quoted commas and embedded CRLF', () => {
  const parsed = Core.parseCSV('\uFEFFID,備註,數量\r\n0012,"first, second\r\nsaid ""yes""",0.5\r\n');
  assert.equal(parsed.delimiter, ',');
  assert.deepEqual(parsed.rows, [['ID', '備註', '數量'], ['0012', 'first, second\r\nsaid "yes"', '0.5']]);
});

test('CSV handles empty input, empty quoted cells, trailing fields and blank rows', () => {
  assert.deepEqual(Core.parseCSV('').rows, []);
  assert.deepEqual(Core.parseCSV('""').rows, [['']]);
  assert.deepEqual(Core.parseCSV('A,B\n1,\n\n').rows, [['A', 'B'], ['1', ''], ['']]);
  assert.deepEqual(Core.parseCSV('""""').rows, [['"']]);
});

test('auto detection recognizes tabs and semicolons despite decimal commas in data', () => {
  assert.equal(Core.parseCSV('ID\tName\n001\tLin').delimiter, '\t');
  assert.equal(Core.parseCSV('ID;數量\n001;1,25\n002;2,50').delimiter, ';');
  assert.deepEqual(Core.parseCSV('A;B\n"x;y";z').rows[1], ['x;y', 'z']);
});

test('malformed quoting gives a useful location instead of silently repairing data', () => {
  for (const text of ['A,B\n1,"unfinished', 'A,B\n1,ab"cd', 'A,B\n1,"x"tail']) {
    assert.throws(() => Core.parseCSV(text), error => error.name === 'CSVParseError' && error.line >= 2 && error.column > 0);
  }
  assert.throws(() => Core.parseCSV('A,B\n1,"x" '), /結束引號/);
});

test('normalization trims only headers, fills short rows, skips blank rows, keeps provenance', () => {
  const normalized = Core.normalizeTable([[''], [' ID ', 'Name'], ['0012', ' Alice '], ['0013'], ['', ' ']], { fileName: 'input.csv', sheetName: 'Main' });
  assert.deepEqual(normalized.columns, ['ID', 'Name']);
  assert.equal(normalized.records[0].values.ID, '0012');
  assert.equal(normalized.records[0].values.Name, ' Alice ');
  assert.equal(normalized.records[1].values.Name, '');
  assert.equal(normalized.records[0].sourceRow, 3);
  assert.equal(normalized.records[0].sourceFile, 'input.csv');
  assert.equal(normalized.records[0].sourceSheet, 'Main');
  assert.equal(normalized.warnings.length, 2);
});

test('ambiguous or oversized structures fail before any cells are discarded', () => {
  assert.throws(() => table('A,A\n1,2'), /重複/);
  assert.throws(() => table(' A ,A\n1,2'), /重複/);
  assert.throws(() => table('A,\n1,2'), /缺少/);
  assert.throws(() => table('A,B\n1,2,3'), /第 2 列.*3 欄/);
  assert.throws(() => Core.normalizeTable([['A', , 'C'], ['1', '2', '3']]), /缺少/);
});

test('special object property headers remain ordinary data and cannot pollute prototypes', () => {
  const normalized = table('__proto__,constructor,toString\nkeep,also,yes');
  const result = Core.mergeTables([normalized]);
  assert.equal(Object.getPrototypeOf(result.records[0].values), null);
  assert.equal(result.records[0].values.__proto__, 'keep');
  assert.equal(result.records[0].values.constructor, 'also');
  assert.equal(result.records[0].values.toString, 'yes');
  assert.equal({}.polluted, undefined);
});

test('union retains all columns and rows, including duplicates unless explicitly enabled', () => {
  const a = table('ID,A\n1,x\n1,x', 'first.csv');
  const b = table('ID,B\n2,y', 'second.csv');
  const result = Core.mergeTables([a, b]);
  assert.deepEqual(result.columns, ['ID', 'A', 'B']);
  assert.equal(result.totalRows, 3);
  assert.equal(result.records.length, 3);
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.removedCount, 0);
  assert.equal(result.records[0].values.B, '');
  assert.equal(result.records[2].values.A, '');
  assert.equal(result.records[2].sourceFile, 'second.csv');
  assert.deepEqual(a.columns, ['ID', 'A']);
  assert.equal(hasOwn(a.records[0].values, 'B'), false);
});

function hasOwn(object, key) { return Object.prototype.hasOwnProperty.call(object, key); }

test('intersection is explicit, warns about omitted values, and rejects zero common columns', () => {
  const a = table('ID,A\n1,x');
  const b = table('ID,B\n2,y');
  const result = Core.mergeTables([a, b], { mode: 'intersection' });
  assert.deepEqual(result.columns, ['ID']);
  assert.equal(result.records.length, 2);
  assert.match(result.warnings.join(' '), /排除 2 個欄位/);
  assert.throws(() => Core.mergeTables([table('A\nx'), table('B\ny')], { mode: 'intersection' }), /沒有共同欄位/);
  assert.deepEqual(Core.mergeTables([a, Core.normalizeTable([])], { mode: 'intersection' }).columns, ['ID', 'A']);
});

test('dedupe uses structured keys, normalizes missing fields and keeps first provenance', () => {
  const a = table('A,B\nx|y,z\nx,y|z\nx|y,z', 'first.csv');
  const result = Core.mergeTables([a], { dedupe: true });
  assert.equal(result.records.length, 2);
  assert.equal(result.removedCount, 1);
  assert.equal(result.records[0].sourceRow, 2);
  const normalizedMissing = Core.mergeTables([table('ID,A\n1,x'), table('ID,A,B\n1,x,')], { dedupe: true });
  assert.equal(normalizedMissing.records.length, 1);
  assert.equal(normalizedMissing.duplicateCount, 1);
});

test('selected keys are exact strings and conflicting non-key data produces a warning', () => {
  const result = Core.mergeTables([table('ID,Name\n01,A\n1,B\n01,C')], { dedupe: true, keyColumns: ['ID'] });
  assert.equal(result.records.length, 2);
  assert.equal(result.records[0].values.Name, 'A');
  assert.match(result.warnings.join(' '), /其他欄位內容不同/);
  assert.throws(() => Core.mergeTables([table('ID\n1')], { keyColumns: ['Missing'] }), /不在合併後/);
  assert.throws(() => Core.mergeTables([table('ID\n1')], { keyColumns: ['ID', 'ID'] }), /重複/);
});

test('CSV raw export round-trips exact cell text and adds collision-safe source columns', () => {
  const merged = Core.mergeTables([table('ID,來源檔案,來源檔案_2,Note\n001,original,reserved,"a,b\n""hello"""', 'input.csv')]);
  const csv = Core.toCSV(merged.columns, merged.records, { safeSpreadsheet: false });
  assert.equal(csv.charCodeAt(0), 0xFEFF);
  assert.equal(csv.endsWith('\r\n'), true);
  const rows = Core.parseCSV(csv).rows;
  assert.deepEqual(rows[0], ['ID', '來源檔案', '來源檔案_2', 'Note', '來源檔案_3', '來源工作表', '來源列號']);
  assert.deepEqual(rows[1], ['001', 'original', 'reserved', 'a,b\n"hello"', 'input.csv', 'Sheet1', '2']);
  assert.deepEqual(Core.buildExportRows(merged.columns, merged.records), rows);
  assert.equal(Core.parseCSV(Core.toCSV(merged.columns, merged.records, { includeSource: false, safeSpreadsheet: false })).rows[0].length, 4);
});

test('CSV protects headers and formula-like cells even when hidden behind whitespace', () => {
  const columns = ['=HEADER', 'Value'];
  const dangerous = ['=SUM(1,2)', '+CMD', '-1', '@SUM(A1)', '\t123', '\r123', '  =1', '\n=1'];
  const records = dangerous.map(value => ({ values: { '=HEADER': '001', Value: value }, sourceFile: '', sourceSheet: '', sourceRow: 1 }));
  const raw = Core.parseCSV(Core.toCSV(columns, records, { includeSource: false })).rows;
  assert.equal(raw[0][0], "'=HEADER");
  dangerous.forEach((value, index) => assert.equal(raw[index + 1][1], "'" + value));
  assert.equal(records[0].values.Value, '=SUM(1,2)');
  const disabled = Core.parseCSV(Core.toCSV(columns, records, { includeSource: false, safeSpreadsheet: false })).rows;
  assert.equal(disabled[0][0], '=HEADER');
  assert.equal(disabled[1][1], '=SUM(1,2)');
});

test('strict numeric summary handles decimal halves, zero, exponent and invalid text', () => {
  const records = ['0.5', '0', '-.5', ' 2e2 ', '', '   ', 'NT$20', '1,000', '12abc', 'Infinity', '0x10', '1e999'].map(value => ({ values: { Amount: value } }));
  assert.deepEqual(Core.summarizeColumn(records, 'Amount'), { count: 12, validCount: 4, emptyCount: 2, invalidCount: 6, sum: 200 });
  assert.equal(Core.summarizeColumn([{ values: { A: '' } }], 'A').sum, null);
  assert.equal(Core.summarizeColumn([{ values: { A: '0' } }], 'A').sum, 0);
  assert.equal(Core.summarizeColumn([{ values: { A: 'bad' } }], 'A').sum, null);
});

test('summary compensates cancellation and reports overflow without returning Infinity', () => {
  const cancellation = [1e16, 1, -1e16].map(value => ({ values: { A: String(value) } }));
  assert.equal(Core.summarizeColumn(cancellation, 'A').sum, 1);
  const overflow = Core.summarizeColumn([{ values: { A: '1e308' } }, { values: { A: '1e308' } }], 'A');
  assert.equal(overflow.sum, null);
  assert.equal(overflow.overflow, true);
  assert.equal(overflow.validCount, 2);
});
