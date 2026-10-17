'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('../dist/vendor/xlsx.full.min.js');
const Core = require('../dist/merge-core.js');
const IO = require('../dist/table-io.js');

function workbookBytes(entries) {
  const workbook = XLSX.utils.book_new();
  for (const entry of entries) {
    const sheet = entry.sheet || XLSX.utils.aoa_to_sheet(entry.rows);
    XLSX.utils.book_append_sheet(workbook, sheet, entry.name || '資料');
  }
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true });
}

function readBack(workbook) {
  return XLSX.read(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer', cellFormula: true });
}

// Edit the XML in a real XLSX ZIP so missing formula caches are represented
// exactly as third-party spreadsheet producers write them. The XLSX writer
// itself otherwise changes a missing-cache cell into an error-typed cell.
function editSheetXML(bytes, edit, number = 1) {
  const archive = XLSX.CFB.read(bytes, { type: 'buffer' });
  const index = archive.FullPaths.indexOf('Root Entry/xl/worksheets/sheet' + number + '.xml');
  assert.notEqual(index, -1, 'fixture must contain the requested worksheet XML');
  const entry = archive.FileIndex[index];
  const original = Buffer.from(entry.content).toString('utf8');
  const modified = edit(original);
  assert.notEqual(modified, original, 'fixture edit must change the worksheet');
  entry.content = Buffer.from(modified, 'utf8');
  entry.size = entry.content.length;
  return XLSX.CFB.write(archive, { type: 'buffer', fileType: 'zip' });
}

function formulaFixture() {
  const sheet = XLSX.utils.aoa_to_sheet([['ID', '計算'], ['0007', 0]]);
  sheet.B2.f = '1-1';
  return workbookBytes([{ name: '公式資料', sheet }]);
}

function lengthOnlyTable(rowCount, columns) {
  return { columns, records: new Array(rowCount), warnings: [] };
}

test('XLSX import and export preserve literal and formatted identifiers, 0.5 and displayed dates', () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['文字編號', '格式編號', '件數', '日期'],
    ['00007', 12, 0.5, 46313]
  ]);
  sheet.B2.z = '00000';
  sheet.D2.z = 'yyyy/mm/dd';
  const bytes = workbookBytes([{ name: '門診', sheet }]);
  const { table } = IO.spreadsheetFromBuffer(bytes, '資料.xlsx');
  assert.deepEqual({ ...table.records[0].values }, {
    文字編號: '00007', 格式編號: '00012', 件數: '0.5', 日期: '2026/10/18'
  });
  assert.equal(Core.summarizeColumn(table.records, '件數').sum, 0.5);
  const result = Core.mergeTables([table]);
  const exported = readBack(IO.resultToWorkbook(result, { includeSource: false }));
  const output = exported.Sheets['合併資料'];
  for (const address of ['A2', 'B2', 'C2', 'D2']) assert.equal(output[address].t, 's');
  assert.equal(output.A2.v, '00007');
  assert.equal(output.B2.v, '00012');
  assert.equal(output.C2.v, '0.5');
  assert.equal(output.D2.v, '2026/10/18');
});

test('selecting a worksheet preserves physical row provenance through blank leading and interior rows', () => {
  const bytes = workbookBytes([
    { name: '第一張', rows: [['ID'], ['other']] },
    { name: '實際資料', rows: [[], [], ['ID', '備註'], ['0001', 'first'], [], ['0002', 'second']] }
  ]);
  const imported = IO.spreadsheetFromBuffer(bytes, '來源.xlsx', '實際資料');
  assert.deepEqual(imported.sheetNames, ['第一張', '實際資料']);
  assert.equal(imported.selectedSheet, '實際資料');
  assert.deepEqual(imported.table.records.map(record => [record.values.ID, record.sourceFile, record.sourceSheet, record.sourceRow]), [
    ['0001', '來源.xlsx', '實際資料', 4],
    ['0002', '來源.xlsx', '實際資料', 6]
  ]);
  assert.match(imported.table.warnings.join(' '), /表頭前略過 2 列/);
  assert.match(imported.table.warnings.join(' '), /略過 1 列空白資料/);
  assert.equal(IO.spreadsheetFromBuffer(bytes, '來源.xlsx').table.records[0].values.ID, 'other');
  assert.throws(() => IO.spreadsheetFromBuffer(bytes, '來源.xlsx', '不存在'), /找不到指定/);
});

test('an invalid first sheet preserves sheet-selection metadata and does not block a valid second sheet', () => {
  const bytes = workbookBytes([
    { name: '錯誤表頭', rows: [['ID', 'ID'], ['one', 'two']] },
    { name: '可用資料', rows: [['ID', '件數'], ['0008', 0.5]] }
  ]);
  assert.throws(() => IO.spreadsheetFromBuffer(bytes, '多表.xlsx'), error => {
    assert.match(error.message, /重複/);
    assert.deepEqual(error.sheetNames, ['錯誤表頭', '可用資料']);
    assert.equal(error.selectedSheet, '錯誤表頭');
    return true;
  });
  const imported = IO.spreadsheetFromBuffer(bytes, '多表.xlsx', '可用資料');
  assert.equal(imported.table.records[0].values.ID, '0008');
  assert.equal(imported.table.records[0].values['件數'], '0.5');
});

test('a cached formula result of numeric zero is retained with a cache warning and exported without the formula', () => {
  const imported = IO.spreadsheetFromBuffer(formulaFixture(), '公式.xlsx');
  assert.equal(imported.table.records[0].values['計算'], '0');
  assert.match(imported.table.warnings.join(' '), /1 個公式.*已儲存的結果/);
  const result = Core.mergeTables([imported.table]);
  const workbook = readBack(IO.resultToWorkbook(result, { includeSource: false }));
  const cell = workbook.Sheets['合併資料'].B2;
  assert.equal(cell.t, 's');
  assert.equal(cell.v, '0');
  assert.equal(cell.f, undefined);
});

test('uncached numeric formulas fail clearly instead of silently importing as empty strings', () => {
  const original = formulaFixture();
  for (const missingCache of ['<f>1-1</f>', '<f>1-1</f><v></v>', '<f>1-1</f><v/>']) {
    const bytes = editSheetXML(original, xml => xml.replace('<f>1-1</f><v>0</v>', missingCache));
    assert.throws(() => IO.spreadsheetFromBuffer(bytes, '缺少結果.xlsx'), error => {
      assert.match(error.message, /B2.*公式.*沒有已儲存的結果/);
      assert.deepEqual(error.sheetNames, ['公式資料']);
      return true;
    });
  }
});

test('Excel error cells are rejected with their worksheet and physical cell address', () => {
  const sheet = XLSX.utils.aoa_to_sheet([['ID', '件數'], ['0001', 1]]);
  sheet.B2 = { t: 'e', v: 0x07 }; // #DIV/0!
  const bytes = workbookBytes([{ name: '錯誤資料', sheet }]);
  assert.throws(() => IO.spreadsheetFromBuffer(bytes, '錯誤.xlsx'), /錯誤資料.*B2.*Excel 錯誤值/);
});

test('unsupported and damaged workbook bytes are not accepted as a blank table', () => {
  for (const bytes of [
    Buffer.alloc(0),
    Buffer.from('ID,件數\n0001,0.5', 'utf8'),
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])
  ]) assert.throws(() => IO.spreadsheetFromBuffer(bytes, '看似Excel.xlsx'), /xlsx|Excel|工作表/);
});

test('UTF-8 CSV byte decoding preserves BOM, Chinese text, leading zeros and decimals', () => {
  const bytes = Buffer.from('\uFEFF編號,姓名,數量\r\n0007,王小明,0.5\r\n', 'utf8');
  const imported = IO.csvFromBuffer(bytes, '中文.csv', 'utf-8');
  assert.deepEqual(imported.table.columns, ['編號', '姓名', '數量']);
  assert.deepEqual({ ...imported.table.records[0].values }, { 編號: '0007', 姓名: '王小明', 數量: '0.5' });
  assert.equal(imported.table.records[0].sourceRow, 2);
  assert.equal(imported.table.records[0].sourceSheet, 'CSV');
  assert.equal(imported.selectedSheet, 'CSV');
});

test('Big5 CSV bytes decode only under the selected encoding instead of replacing invalid characters', () => {
  // "編號,姓名,數量\r\n0007,王小明,0.5\r\n" encoded with the standard Big5 codec.
  const bytes = Buffer.from('bd73b8b92ca96da6572cbcc6b6710d0a303030372ca4fda470a9fa2c302e350d0a', 'hex');
  const imported = IO.csvFromBuffer(bytes, '舊式中文.csv', 'big5');
  assert.deepEqual(imported.table.columns, ['編號', '姓名', '數量']);
  assert.deepEqual({ ...imported.table.records[0].values }, { 編號: '0007', 姓名: '王小明', 數量: '0.5' });
  assert.throws(() => IO.csvFromBuffer(bytes, '舊式中文.csv', 'utf-8'), /編碼.*Big5/);
  assert.throws(() => IO.csvFromBuffer(Buffer.from([0xff, 0xfe, 0xff]), '損壞.csv', 'utf-8'), /編碼/);
});

test('byte views use the requested slice rather than unrelated surrounding memory', () => {
  const csvBytes = Buffer.from('ID,Qty\n0009,0.5', 'utf8');
  const csvContainer = Buffer.concat([Buffer.from('unrelated'), csvBytes, Buffer.from('trailer')]);
  const csvView = new Uint8Array(csvContainer.buffer, csvContainer.byteOffset + 9, csvBytes.length);
  assert.equal(IO.csvFromBuffer(csvView, 'slice.csv').table.records[0].values.ID, '0009');
  const xlsxBytes = workbookBytes([{ rows: [['ID'], ['0009']] }]);
  const xlsxContainer = Buffer.concat([Buffer.from('unrelated'), xlsxBytes, Buffer.from('trailer')]);
  const xlsxView = new Uint8Array(xlsxContainer.buffer, xlsxContainer.byteOffset + 9, xlsxBytes.length);
  assert.equal(IO.spreadsheetFromBuffer(xlsxView, 'slice.xlsx').table.records[0].values.ID, '0009');
});

test('individual table capacity accepts exact limits and rejects the first excess', () => {
  const columns25 = Array.from({ length: 25 }, (_, index) => '欄' + index);
  assert.equal(IO.checkTable(lengthOnlyTable(20000, columns25)).records.length, 20000);
  assert.throws(() => IO.checkTable(lengthOnlyTable(20001, ['ID'])), /20,000/);
  assert.throws(() => IO.checkTable(lengthOnlyTable(1, Array.from({ length: 201 }, (_, index) => '欄' + index))), /200 欄/);
  assert.throws(() => IO.checkTable(lengthOnlyTable(20000, [...columns25, '額外'])), /500,000/);
});

test('aggregate capacity checks combined rows, unioned columns and the expanded merged cell count', () => {
  assert.deepEqual(IO.checkTotal([lengthOnlyTable(10000, ['ID']), lengthOnlyTable(10000, ['ID'])]), { rows: 20000, columns: 1 });
  assert.throws(() => IO.checkTotal([lengthOnlyTable(10000, ['ID']), lengthOnlyTable(10001, ['ID'])]), /20,000/);
  const first100 = Array.from({ length: 100 }, (_, index) => 'A' + index);
  const second100 = Array.from({ length: 100 }, (_, index) => 'B' + index);
  assert.deepEqual(IO.checkTotal([lengthOnlyTable(1, first100), lengthOnlyTable(1, second100)]), { rows: 2, columns: 200 });
  assert.throws(() => IO.checkTotal([lengthOnlyTable(1, first100), lengthOnlyTable(1, [...second100, '額外'])]), /200 欄/);
  const first25 = first100.slice(0, 25);
  const second25 = second100.slice(0, 25);
  IO.checkTable(lengthOnlyTable(10000, first25));
  IO.checkTable(lengthOnlyTable(10000, second25));
  assert.throws(() => IO.checkTotal([lengthOnlyTable(10000, first25), lengthOnlyTable(10000, second25)]), /500,000/);
});

test('oversized XLSX dimensions fail before parser row truncation could silently remove data', () => {
  const original = workbookBytes([{ rows: [['ID'], ['0001']] }]);
  for (const dimension of ['A1:A20002', 'A1:GS2', 'A1:GR2502']) {
    const bytes = editSheetXML(original, xml => xml.replace('<dimension ref="A1:A2"/>', '<dimension ref="' + dimension + '"/>'));
    assert.throws(() => IO.spreadsheetFromBuffer(bytes, '超量.xlsx'), /容量|20,000|200 欄|500,000/);
  }
});

test('XLSX exports every data cell and formula-looking header as exact text without executable formulas', () => {
  const columns = ['=HEADER', '+Other', '-Third', '@Fourth'];
  const dangerous = ['=SUM(1,2)', '+CMD', '-1', '@SUM(A1)', '  =1', '\t=1', '\r=1', '\n=1'];
  const table = Core.normalizeTable([columns, ...dangerous.map(value => ['0001', value, '0.5', 'plain'])], { fileName: '=source.xlsx', sheetName: '@Sheet' });
  const result = Core.mergeTables([table]);
  const workbook = readBack(IO.resultToWorkbook(result));
  const sheet = workbook.Sheets['合併資料'];
  const expectedRows = Core.buildExportRows(result.columns, result.records);
  for (let row = 0; row < expectedRows.length; row += 1) {
    for (let column = 0; column < expectedRows[row].length; column += 1) {
      const address = XLSX.utils.encode_cell({ r: row, c: column });
      assert.equal(sheet[address].t, 's', address + ' must stay text');
      assert.equal(sheet[address].f, undefined, address + ' must not become a formula');
      assert.equal(sheet[address].v, expectedRows[row][column], address + ' text must round-trip exactly');
    }
  }
  assert.deepEqual(workbook.SheetNames, ['合併資料', '整理摘要']);
});

test('XLSX source column collisions preserve original values and receive distinct appended names', () => {
  const table = Core.normalizeTable([
    ['ID', '來源檔案', '來源檔案_2', '來源工作表', '來源列號'],
    ['0001', 'original-file', 'also-original', 'original-sheet', 'original-row']
  ], { fileName: 'input.xlsx', sheetName: '原始資料' });
  const result = Core.mergeTables([table]);
  const workbook = readBack(IO.resultToWorkbook(result));
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets['合併資料'], { header: 1, raw: true });
  assert.deepEqual(rows[0], ['ID', '來源檔案', '來源檔案_2', '來源工作表', '來源列號', '來源檔案_3', '來源工作表_2', '來源列號_2']);
  assert.deepEqual(rows[1], ['0001', 'original-file', 'also-original', 'original-sheet', 'original-row', 'input.xlsx', '原始資料', '2']);
  const withoutSource = readBack(IO.resultToWorkbook(result, { includeSource: false }));
  assert.deepEqual(XLSX.utils.sheet_to_json(withoutSource.Sheets['合併資料'], { header: 1, raw: true })[0], table.columns);
});
