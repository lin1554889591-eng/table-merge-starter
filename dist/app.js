/* UI state stays in memory. No fetch, analytics, or persistent storage. */
(function () {
  'use strict';
  const Core=window.TableMergeCore, IO=window.TableMergeIO;
  const $=id=>document.getElementById(id);
  const state={files:[],result:null,page:0,query:'',keys:new Set(),busy:false,sequence:0};
  const PAGE_SIZE=50;
  const fmt=n=>Number(n).toLocaleString('zh-TW',{maximumFractionDigits:10});
  const fmtSum=n=>n===0?'0':Number(n).toLocaleString('zh-TW',{maximumSignificantDigits:15,notation:Math.abs(n)<1e-6||Math.abs(n)>=1e15?'scientific':'standard'});
  const el=(tag,cls,text)=>{const node=document.createElement(tag);if(cls)node.className=cls;if(text!==undefined)node.textContent=text;return node;};
  function message(text,error) { const box=$('alerts');box.textContent=text;box.className='alerts'+(error?' error':'');box.hidden=!text; }
  function invalidate() {state.result=null;$('results').hidden=true;state.page=0;updateControls();}
  function validTables() {return state.files.filter(file=>file.table&&!file.error).map(file=>file.table);}
  function currentColumns() {
    const tables=validTables().filter(t=>t.columns.length);
    return $('merge-mode').value==='intersection' ? (tables.length?tables[0].columns.filter(c=>tables.every(t=>t.columns.includes(c))):[]) : Array.from(new Set(tables.flatMap(t=>t.columns)));
  }
  function updateControls() {
    const count=state.files.length, errors=state.files.filter(f=>f.error).length;
    const rows=validTables().reduce((n,t)=>n+t.records.length,0);
    $('run-merge').disabled=state.busy||!count||!!errors||!rows;
    $('clear-files').hidden=!count;
    $('merge-hint').textContent=state.busy?'正在你的裝置讀取檔案…':errors?'先修正或移除讀取失敗的檔案。':count?(rows?count+' 份檔案，共 '+fmt(rows)+' 列資料，準備好了。':'目前檔案沒有資料列，請換一份檔案。'):'先放入檔案，或載入範例資料。';
    ['choose-files','load-demo','clear-files','csv-encoding','merge-mode','dedupe','include-source'].forEach(id=>{$(id).disabled=state.busy;});
    document.body.classList.toggle('busy',state.busy);
  }
  function renderKeys() {
    const columns=currentColumns();
    state.keys=new Set([...state.keys].filter(key=>columns.includes(key)));
    const box=$('key-columns');box.replaceChildren();
    if(!columns.length){box.append(el('span','muted','載入檔案後可選擇'));return;}
    columns.forEach(column=>{const label=el('label','key-chip');const input=document.createElement('input');input.type='checkbox';input.checked=state.keys.has(column);input.disabled=state.busy;input.addEventListener('change',()=>{if(input.checked)state.keys.add(column);else state.keys.delete(column);invalidate();});label.append(input,el('span','',column));box.append(label);});
  }
  function renderFiles() {
    const list=$('file-list');list.replaceChildren();
    state.files.forEach(file=>{
      const entry=el('div','file-entry'+(file.error?' error':''));
      const badge=el('span','file-badge',file.kind.toUpperCase());
      const content=el('div','file-content');content.append(el('p','file-name',file.name));
      if(file.error)content.append(el('p','file-error',file.error));
      else if(file.table)content.append(el('p','file-detail',fmt(file.table.records.length)+' 列 · '+file.table.columns.length+' 欄'+(file.demo?' · 虛構範例':'')));
      else content.append(el('p','file-detail','讀取中…'));
      if(file.sheetNames&&file.sheetNames.length){const select=el('select','file-sheet');select.setAttribute('aria-label',file.name+' 的工作表');file.sheetNames.forEach(name=>{const option=el('option','',name);option.value=name;select.append(option);});select.value=file.selectedSheet;select.disabled=state.busy;select.addEventListener('change',async()=>{file.selectedSheet=select.value;await refreshFile(file);});content.append(select);}
      const remove=el('button','remove-file','×');remove.type='button';remove.disabled=state.busy;remove.setAttribute('aria-label','移除 '+file.name);remove.addEventListener('click',()=>{state.files=state.files.filter(f=>f.id!==file.id);invalidate();renderFiles();renderKeys();message('');});
      entry.append(badge,content,remove);list.append(entry);
    });updateControls();
  }
  async function pauseFrame(){await new Promise(resolve=>setTimeout(resolve,0));}
  async function parseFile(file) {
    file.error='';file.table=null;
    try {const parsed=file.kind==='csv'?IO.csvFromBuffer(file.buffer,file.name,$('csv-encoding').value):IO.spreadsheetFromBuffer(file.buffer,file.name,file.selectedSheet);Object.assign(file,parsed);}
    catch(error){file.error=error.message||'讀取失敗';if(Array.isArray(error.sheetNames)){file.sheetNames=error.sheetNames;file.selectedSheet=error.selectedSheet;}}
  }
  async function refreshFile(file) {state.busy=true;invalidate();renderFiles();await pauseFrame();await parseFile(file);state.busy=false;renderFiles();renderKeys();}
  async function importFiles(fileList) {
    if(state.busy)return;
    const files=Array.from(fileList||[]);if(!files.length)return;
    const limit=IO.LIMITS;
    if(state.files.length+files.length>limit.files){message('一次最多整理 20 份檔案，請分批加入。',true);return;}
    if(state.files.reduce((n,f)=>n+f.size,0)+files.reduce((n,f)=>n+f.size,0)>limit.totalBytes){message('檔案總大小超過 20 MiB，請分批整理。',true);return;}
    state.busy=true;invalidate();message('');renderFiles();
    const errors=[];
    for(const file of files){
      if(!/\.(csv|xlsx)$/i.test(file.name)){errors.push(file.name+'：目前只支援 .xlsx 與 .csv。');continue;}
      if(file.size>limit.fileBytes){errors.push(file.name+'：超過每份 5 MiB 的限制。');continue;}
      const record={id:++state.sequence,name:file.name,size:file.size,kind:file.name.toLowerCase().endsWith('.xlsx')?'xlsx':'csv',table:null,error:''};state.files.push(record);renderFiles();await pauseFrame();
      try{record.buffer=await file.arrayBuffer();await parseFile(record);}catch(error){record.error='無法讀取檔案：'+error.message;}
    }
    state.busy=false;renderFiles();renderKeys();if(errors.length)message(errors.join('\n'),true);
  }
  function demoFiles() {
    const examples=[{name:'範例_店面.csv',text:'編號,品項,數量,日期\r\n001,原味茶,2,2026-10-16\r\n002,奶茶,0.5,2026-10-16\r\n003,"餅乾,小包",1,2026-10-16\r\n'},{name:'範例_網路.csv',text:'日期,編號,品項,數量,備註\r\n2026-10-16,002,奶茶,0.5,\r\n2026-10-17,004,檸檬茶,3,週末\r\n2026-10-17,005,原味茶,1,\r\n'}];
    return examples.map(item=>{const buffer=new TextEncoder().encode(item.text);return {id:++state.sequence,name:item.name,kind:'csv',size:buffer.byteLength,buffer,demo:true,...IO.csvFromBuffer(buffer,item.name,'utf-8')};});
  }
  function loadDemo() {
    if(state.busy)return;
    if(state.files.length){message('請先按「清空」移除目前檔案，再載入範例。現有資料已保留。');return;}
    $('csv-encoding').value='utf-8';$('merge-mode').value='union';$('dedupe').checked=false;state.keys.clear();state.files=demoFiles();invalidate();renderFiles();renderKeys();message('已載入虛構範例：6 列資料，其中有 1 列重複。按「合併並檢查」試試看。');
  }
  function runMerge() {
    if(state.busy||$('run-merge').disabled)return;
    try{const tables=validTables();IO.checkTotal(tables);state.result=Core.mergeTables(tables,{mode:$('merge-mode').value,dedupe:$('dedupe').checked,keyColumns:[...state.keys]});state.query='';state.page=0;$('search').value='';message('');renderResult();if(typeof $('results').scrollIntoView==='function')$('results').scrollIntoView({behavior:window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});}
    catch(error){invalidate();message(error.message,true);}
  }
  function renderResult() {
    const result=state.result;if(!result)return;
    $('results').hidden=false;$('stat-input').textContent=fmt(result.totalRows);$('stat-output').textContent=fmt(result.records.length);$('stat-duplicate').textContent=fmt(result.duplicateCount);$('stat-columns').textContent=result.columns.length;
    $('duplicate-label').textContent=result.removedCount?'已移除重複':'發現重複';
    $('result-subtitle').textContent=state.files.length+' 份檔案已整理完成。'+(result.duplicateCount&&!result.removedCount?'重複資料目前仍保留。':'');
    const list=$('warning-list');list.replaceChildren();[...new Set(result.warnings)].forEach(w=>list.append(el('li','',w)));$('result-warnings').hidden=!result.warnings.length;
    const sum=$('sum-column');sum.replaceChildren();const opt=el('option','','選擇欄位');opt.value='';sum.append(opt);result.columns.forEach((column,index)=>{const option=el('option','',column);option.value=String(index);sum.append(option);});$('sum-result').hidden=true;renderPreview();
  }
  function renderPreview() {
    const result=state.result;if(!result)return;
    const includeSource=$('include-source').checked;
    const query=state.query.trim().toLocaleLowerCase();
    const matches=result.records.map((record,index)=>({record,index})).filter(({record})=>!query||result.columns.some(c=>String(record.values[c]||'').toLocaleLowerCase().includes(query))||(includeSource&&[record.sourceFile,record.sourceSheet,String(record.sourceRow)].some(v=>v.toLocaleLowerCase().includes(query))));
    const pages=Math.max(1,Math.ceil(matches.length/PAGE_SIZE));state.page=Math.min(state.page,pages-1);
    const start=state.page*PAGE_SIZE, visible=matches.slice(start,start+PAGE_SIZE);
    const columns=Core.getExportColumns(result.columns,{includeSource});
    const head=el('tr');head.append(el('th','row-number','#'));columns.forEach(column=>{const th=el('th','',column);th.scope='col';head.append(th);});$('preview-head').replaceChildren(head);
    const body=$('preview-body');body.replaceChildren();
    visible.forEach(({record,index})=>{const row=el('tr');row.append(el('td','row-number',String(index+1)));const vals=result.columns.map(c=>record.values[c]||'');if(includeSource)vals.push(record.sourceFile,record.sourceSheet,String(record.sourceRow));vals.forEach((value,i)=>{const td=el('td',i>=result.columns.length?'source-cell':'',value);td.title=value;row.append(td);});body.append(row);});
    if(!visible.length){const tr=el('tr'),td=el('td','empty-table','沒有符合搜尋條件的資料。');td.colSpan=columns.length+1;tr.append(td);body.append(tr);}
    $('page-caption').textContent=(matches.length?fmt(start+1)+'–'+fmt(start+visible.length):'0')+' / '+fmt(matches.length)+' 列'+(query?'（搜尋結果）':'');$('prev-page').disabled=state.page===0;$('next-page').disabled=state.page>=pages-1;
  }
  function renderSum() {
    if(!state.result||$('sum-column').value===''){$('sum-result').hidden=true;return;}
    const column=state.result.columns[Number($('sum-column').value)];const s=Core.summarizeColumn(state.result.records,column);
    $('sum-result').hidden=false;$('sum-result').textContent=column+'：'+(s.overflow?'加總超出數值範圍':s.validCount?'合計 '+fmtSum(s.sum):'沒有可加總的純數字')+'。'+s.validCount+' 筆數字、'+s.emptyCount+' 筆空白、'+s.invalidCount+' 筆非數字。以全部合併結果計算；千分位、貨幣符號與日期不視為純數字。';
  }
  function download(bytes,name,type) {const url=URL.createObjectURL(new Blob([bytes],{type}));const link=el('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  function fileStem(){const d=new Date();return '表格合併_'+d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
  function downloadResult(kind) {
    if(!state.result)return;
    try{const options={includeSource:$('include-source').checked};if(kind==='csv')download(Core.toCSV(state.result.columns,state.result.records,options),fileStem()+'.csv','text/csv;charset=utf-8');else download(window.XLSX.write(IO.resultToWorkbook(state.result,options),{type:'array',bookType:'xlsx',compression:true}),fileStem()+'.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');message('已產生下載檔案。你可以在瀏覽器的下載項目中開啟。');}
    catch(error){message('匯出失敗：'+error.message,true);}
  }
  if(!Core||!IO||!window.XLSX){message('程式檔案載入不完整。若使用下載版本，請先解壓縮整個資料夾，再開啟 dist/index.html。',true);return;}
  $('choose-files').addEventListener('click',()=>$('file-input').click());
  $('file-input').addEventListener('change',async()=>{await importFiles($('file-input').files);$('file-input').value='';});
  const zone=$('drop-zone');['dragenter','dragover'].forEach(name=>zone.addEventListener(name,e=>{e.preventDefault();if(!state.busy)zone.classList.add('dragover');}));['dragleave','drop'].forEach(name=>zone.addEventListener(name,e=>{e.preventDefault();zone.classList.remove('dragover');}));zone.addEventListener('drop',e=>importFiles(e.dataTransfer.files));
  $('clear-files').addEventListener('click',()=>{state.files=[];state.keys.clear();invalidate();renderFiles();renderKeys();message('目前工作資料已清除，原始檔案不受影響。');});
  $('load-demo').addEventListener('click',loadDemo);$('run-merge').addEventListener('click',runMerge);
  $('merge-mode').addEventListener('change',()=>{invalidate();renderKeys();});$('dedupe').addEventListener('change',invalidate);
  $('include-source').addEventListener('change',renderPreview);
  $('csv-encoding').addEventListener('change',async()=>{state.busy=true;invalidate();renderFiles();for(const file of state.files.filter(f=>f.kind==='csv')){await pauseFrame();await parseFile(file);}state.busy=false;renderFiles();renderKeys();});
  $('search').addEventListener('input',()=>{state.query=$('search').value;state.page=0;renderPreview();});$('prev-page').addEventListener('click',()=>{state.page--;renderPreview();});$('next-page').addEventListener('click',()=>{state.page++;renderPreview();});$('sum-column').addEventListener('change',renderSum);
  $('download-csv').addEventListener('click',()=>downloadResult('csv'));$('download-xlsx').addEventListener('click',()=>downloadResult('xlsx'));
  renderFiles();renderKeys();
}());
