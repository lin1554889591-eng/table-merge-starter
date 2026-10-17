/* File conversion boundary. Workbook values become text; formulas never execute. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./merge-core.js'), require('./vendor/xlsx.full.min.js'));
  else root.TableMergeIO = factory(root.TableMergeCore, root.XLSX);
}(typeof globalThis !== 'undefined' ? globalThis : this, function (Core, XLSX) {
  'use strict';
  const LIMITS = Object.freeze({files:20, fileBytes:5*1024*1024, totalBytes:20*1024*1024, rows:20000, columns:200, cells:500000});
  function checkTable(table) {
    if (table.columns.length > LIMITS.columns) throw new Error('欄位超過 200 欄，請先拆分檔案。');
    if (table.records.length > LIMITS.rows) throw new Error('資料超過 20,000 列，請先拆分檔案。');
    if (table.records.length * table.columns.length > LIMITS.cells) throw new Error('資料超過 500,000 個欄位值，請先拆分檔案。');
    return table;
  }
  function checkTotal(tables) {
    const rows = tables.reduce((n,t)=>n+t.records.length,0);
    const allColumns = new Set(tables.flatMap(t=>t.columns));
    if (allColumns.size > LIMITS.columns) throw new Error('合併後超過 200 欄，請減少檔案或先統一欄位名稱。');
    if (rows > LIMITS.rows) throw new Error('所有檔案合計超過 20,000 列，請分批整理。');
    if (rows * allColumns.size > LIMITS.cells) throw new Error('合併後超過 500,000 個欄位值，請分批整理。');
    return {rows,columns:allColumns.size};
  }
  function csvFromBuffer(buffer, fileName, encoding) {
    let text;
    try { text = new TextDecoder(encoding || 'utf-8', {fatal:true}).decode(buffer); }
    catch (_) { throw new Error('無法以選定編碼讀取。若是舊式繁中 CSV，請改選 Big5；也可以先另存成 UTF-8 CSV。'); }
    const parsed = Core.parseCSV(text);
    const table = checkTable(Core.normalizeTable(parsed.rows,{fileName,sheetName:'CSV'}));
    return {table,sheetNames:[],selectedSheet:'CSV',delimiter:parsed.delimiter};
  }
  function spreadsheetFromBuffer(buffer, fileName, requestedSheet) {
    if (!XLSX) throw new Error('Excel 讀寫程式尚未載入，請重新整理頁面。');
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (bytes.length<4 || bytes[0]!==0x50 || bytes[1]!==0x4b) throw new Error('這不是可讀取的 .xlsx 檔案。請使用 Excel 另存成 .xlsx。');
    let names;
    try { names = XLSX.read(bytes,{type:'array',bookSheets:true}).SheetNames; }
    catch (_) { throw new Error('無法讀取 Excel。請確認檔案完整、未加密，並另存成 .xlsx。'); }
    if (!names || !names.length) throw new Error('這份 Excel 沒有可讀取的工作表。');
    const selectedSheet = requestedSheet || names[0];
    if (!names.includes(selectedSheet)) throw new Error('找不到指定的工作表。');
    try {
    const workbook = XLSX.read(bytes,{type:'array',sheets:[selectedSheet],sheetRows:LIMITS.rows+2,cellFormula:true,cellHTML:false,cellDates:false,sheetStubs:true});
    const sheet = workbook.Sheets[selectedSheet];
    if (!sheet) throw new Error('指定的工作表無法讀取。');
    let rows = [], formulaCount = 0;
    const bounds = sheet['!fullref'] || sheet['!ref'];
    if (bounds) {
      const range = XLSX.utils.decode_range(bounds);
      if (range.e.r + 1 > LIMITS.rows + 1 || range.e.c + 1 > LIMITS.columns || (range.e.r+1)*(range.e.c+1) > LIMITS.cells+LIMITS.columns) {
        throw new Error('這張工作表的範圍超過第一版容量（20,000 列、200 欄、500,000 個欄位值）。請移除多餘格式或拆分後再試。');
      }
      Object.keys(sheet).filter(key=>key[0]!=='!').forEach(address=>{
        const cell=sheet[address];
        if (cell.t==='e') throw new Error('工作表 '+selectedSheet+' 的 '+address+' 是 Excel 錯誤值。請先修正後再匯入。');
        if (cell.f) {
          formulaCount++;
          if (cell.t==='z' || cell.v===undefined || cell.v===null) throw new Error('工作表 '+selectedSheet+' 的 '+address+' 有公式但沒有已儲存的結果。請先在 Excel 中重新計算並儲存。');
        }
      });
      rows=XLSX.utils.sheet_to_json(sheet,{header:1,raw:false,defval:'',blankrows:true,range:{s:{r:0,c:0},e:range.e}});
    }
    const table=checkTable(Core.normalizeTable(rows,{fileName,sheetName:selectedSheet}));
    if (formulaCount) table.warnings.push(fileName+' / '+selectedSheet+'：'+formulaCount+' 個公式使用檔案內已儲存的結果，本工具不重新計算公式。');
    return {table,sheetNames:names,selectedSheet};
    } catch (error) {
      error.sheetNames=names;
      error.selectedSheet=selectedSheet;
      throw error;
    }
  }
  function resultToWorkbook(result, options) {
    const includeSource = !options || options.includeSource!==false;
    const rows = Core.buildExportRows(result.columns,result.records,{includeSource});
    const workbook = XLSX.utils.book_new();
    const sheet=XLSX.utils.aoa_to_sheet(rows);
    sheet['!autofilter']={ref:sheet['!ref']};
    sheet['!cols']=rows[0].map(name=>({wch:Math.max(14,Math.min(28,name.length*2+3))}));
    XLSX.utils.book_append_sheet(workbook,sheet,'合併資料');
    const report=[['整理項目','內容'],['讀入列數',result.totalRows],['保留列數',result.records.length],['重複列數',result.duplicateCount],['移除列數',result.removedCount],['欄位數',result.columns.length],['儲存方式','合併資料以文字儲存，保留原始編號與內容。'],['公式','輸入公式僅使用已儲存結果，不保留或重新計算公式。']];
    result.warnings.forEach(message=>report.push(['提醒',String(message)]));
    const reportSheet=XLSX.utils.aoa_to_sheet(report); reportSheet['!cols']=[{wch:18},{wch:75}];
    XLSX.utils.book_append_sheet(workbook,reportSheet,'整理摘要');
    return workbook;
  }
  return {LIMITS,checkTable,checkTotal,csvFromBuffer,spreadsheetFromBuffer,resultToWorkbook};
}));
