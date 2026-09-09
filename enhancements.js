(function(){
  const DB=(firebase.app().options.databaseURL||'').replace(/\/$/,'');
  const q=s=>document.querySelector(s), qa=s=>[...document.querySelectorAll(s)];
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const email=()=>firebase.auth().currentUser?.email||'unknown';
  let auditTimer=null, searchState={text:'',person:''};

  async function dbFetch(path,opt={}){ return fetch(DB+path,opt); }
  async function audit(action,detail=''){
    try{
      const key=Date.now()+'-'+Math.random().toString(36).slice(2,7);
      await dbFetch('/auditLogs/'+key+'.json',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({at:new Date().toISOString(),by:email(),action,detail,period:typeof data!=='undefined'?data.current:''})});
    }catch(e){}
  }
  function queueAudit(){clearTimeout(auditTimer);auditTimer=setTimeout(()=>audit('資料修改','一般欄位修改'),3000);}

  function installUserBadge(){
    const a=q('header .actions'); if(!a||q('#userBadge'))return;
    const s=document.createElement('span');s.id='userBadge';s.textContent='👤 '+email();a.prepend(s);
  }
  function setSync(text,ok=true){
    let s=q('#syncDetail'); if(!s){const a=q('header .actions');if(!a)return;s=document.createElement('span');s.id='syncDetail';a.appendChild(s);}
    s.textContent=text;s.dataset.ok=ok?'1':'0';
  }
  window.addEventListener('haiyi-sync-start',()=>setSync('⏳ 儲存中…'));
  window.addEventListener('haiyi-sync-ok',e=>setSync('☁ 已同步 '+new Date(e.detail?.at||Date.now()).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit',second:'2-digit'})));
  window.addEventListener('haiyi-sync-conflict',()=>{
    setSync('⚠ 發現其他裝置的新版本',false);
    setTimeout(()=>{if(confirm('另一台裝置剛剛已更新資料。為避免互相覆蓋，這次儲存已停止。\n\n按「確定」重新載入最新雲端資料；本機仍保留目前內容作為備援。')) location.reload();},50);
  });

  function normalize(s){return String(s||'').trim().replace(/\s+/g,'').toLowerCase();}
  function dupKeys(){
    const m=new Map();(typeof currentSlips==='function'?currentSlips():[]).forEach(s=>{const k=normalize(s.projectName)+'|'+(s.date||'');if(!normalize(s.projectName))return;m.set(k,(m.get(k)||0)+1);});return new Set([...m].filter(([,n])=>n>1).map(([k])=>k));
  }
  function applyFilter(){
    const text=normalize(searchState.text),person=searchState.person, dups=dupKeys(); let visible=0;
    qa('.projectCard').forEach(card=>{
      const name=card.querySelector('.pname')?.value||'';
      const date=card.querySelector('input[type=date]')?.value||'';
      const personSel=card.querySelector('select[data-field="person"]')?.value||'';
      const hay=normalize(card.innerText+' '+name);
      const show=(!text||hay.includes(text))&&(!person||personSel===person);card.style.display=show?'':'none';if(show)visible++;
      const k=normalize(name)+'|'+date;card.classList.toggle('duplicateProject',dups.has(k));
    });
    const c=q('#filterCount');if(c)c.textContent='顯示 '+visible+' / '+qa('.projectCard').length+' 筆';
    const w=q('#dupWarning');if(w){const n=dups.size;w.style.display=n?'block':'none';w.textContent=n?'⚠ 發現 '+n+' 組「同日期＋同工程名稱」重複資料，已用紅框標示。':'';}
  }
  function installSearch(){
    if(typeof activeTab==='undefined'||activeTab!==0)return;
    const main=q('#main'), cards=q('#slipCards'); if(!main||!cards||q('#smartFilter'))return;
    const people=[...(typeof data!=='undefined'&&Array.isArray(data.roster)?data.roster:[])];
    const bar=document.createElement('div');bar.id='smartFilter';bar.innerHTML='<div class="smartFilterRow"><input id="projectSearch" type="search" placeholder="搜尋工程名稱、地址、型號、負責人…"><select id="personFilter"><option value="">全部業務人員</option>'+people.map(p=>'<option>'+esc(p)+'</option>').join('')+'</select><span id="filterCount"></span></div><div id="dupWarning"></div>';
    main.insertBefore(bar,cards);
    q('#projectSearch').value=searchState.text;q('#personFilter').value=searchState.person;
    q('#projectSearch').oninput=e=>{searchState.text=e.target.value;applyFilter()};q('#personFilter').onchange=e=>{searchState.person=e.target.value;applyFilter()};applyFilter();
  }

  function download(name,content,type='application/json'){
    const b=new Blob([content],{type});const u=URL.createObjectURL(b),a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),2000);
  }
  async function loadXLSX(){
    if(window.XLSX)return window.XLSX;
    await new Promise((res,rej)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';s.onload=res;s.onerror=rej;document.head.appendChild(s)});return window.XLSX;
  }
  function dateISO(v,XLSX){
    if(!v)return''; if(v instanceof Date&&!isNaN(v))return v.toISOString().slice(0,10);
    if(typeof v==='number'){const d=XLSX.SSF.parse_date_code(v);if(d)return `${d.y}-${String(d.m).padStart(2,'0')}-${String(d.d).padStart(2,'0')}`;}
    const s=String(v).trim().replace(/[./]/g,'-');const d=new Date(s);return isNaN(d)?'':`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function pick(row,names){for(const n of names)if(row[n]!==undefined&&String(row[n]).trim()!=='')return row[n];return'';}
  function number(v){const n=Number(String(v??'').replace(/[,$%\s]/g,''));return Number.isFinite(n)?n:0;}
  const aliases={date:['日期','施工日期','完工日期','date'],project:['工程名稱','案名','工程地址','地址','工地','projectName'],person:['業務人員','業務','person'],revenue:['工程業績','業績','金額','revenue'],share:['分紅%','分紅％','分紅','sharePercent'],approver:['簽核人員','簽核','approver'],note:['備註','note'],model:['型號','設備型號','model'],qty:['數量','qty']};
  function rowsToSlips(rows,XLSX){
    return rows.map((r,i)=>{
      const date=dateISO(pick(r,aliases.date),XLSX), projectName=String(pick(r,aliases.project)||'').trim();
      const roles=(typeof DEFAULT_ROLES!=='undefined'?DEFAULT_ROLES:['工程負責人','外機系統負責人','內機系統負責人','排水負責人','線型負責人','風管負責人']).map(role=>({role,name:String(r[role]||'').trim()}));
      const model=String(pick(r,aliases.model)||'').trim();
      return {sourceRow:i+2,valid:!!(date&&projectName),slip:{id:'xlsx-'+Date.now()+'-'+i+'-'+Math.random().toString(36).slice(2,6),date,projectName,person:String(pick(r,aliases.person)||'').trim(),revenue:number(pick(r,aliases.revenue)),sharePercent:number(pick(r,aliases.share)),approver:String(pick(r,aliases.approver)||'').trim(),note:String(pick(r,aliases.note)||'').trim(),roles,models:model?[{model,qty:number(pick(r,aliases.qty))||1}]:[]}};
    });
  }
  function periodSort(id){const [t,y]=id.split('-');return Number(y)*2+(t==='OS'?1:0);}
  async function beforeImportBackup(){
    const key=Date.now();await dbFetch('/backups/before-import/'+key+'.json',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({createdAt:new Date().toISOString(),createdBy:email(),reason:'Excel 匯入前自動備份',state:JSON.parse(JSON.stringify(data))})});
  }
  function importPreview(parsed,fileName){
    const existing=new Set();Object.values(data.periods||{}).forEach(p=>(p.slips||[]).forEach(s=>existing.add(normalize(s.projectName)+'|'+s.date)));
    const valid=parsed.filter(x=>x.valid), invalid=parsed.filter(x=>!x.valid), fresh=valid.filter(x=>!existing.has(normalize(x.slip.projectName)+'|'+x.slip.date)), dup=valid.length-fresh.length;
    modal('Excel 匯入預覽',`<div class="toolStats"><b>${esc(fileName)}</b><br>讀到 ${parsed.length} 列｜可新增 <b>${fresh.length}</b>｜重複略過 ${dup}｜缺日期/工程名 ${invalid.length}</div><div class="previewList">${fresh.slice(0,12).map(x=>`<div>${esc(x.slip.date)}｜${esc(x.slip.projectName)}</div>`).join('')}${fresh.length>12?'<div>…其餘 '+(fresh.length-12)+' 筆</div>':''}</div><button class="modalPrimary" id="confirmImport">確認匯入 '+fresh.length+' 筆</button>`,()=>{
      const b=q('#confirmImport');if(!b)return;b.onclick=async()=>{if(!fresh.length)return alert('沒有可新增資料');b.disabled=true;b.textContent='匯入中…';try{await beforeImportBackup();fresh.forEach(x=>{const s=x.slip,pid=periodFromDate(new Date(s.date+'T12:00:00'));if(!data.periods[pid]){data.periods[pid]={slips:[]};data.order.push(pid)}data.periods[pid].slips.push(s);if(s.person&&!data.roster.includes(s.person))data.roster.push(s.person);if(s.approver&&!data.approvers.includes(s.approver))data.approvers.push(s.approver)});data.order=[...new Set(data.order)].sort((a,b)=>periodSort(a)-periodSort(b));persist();render();await audit('Excel匯入',`${fileName}：新增 ${fresh.length} 筆，略過重複 ${dup} 筆`);q('#proModal')?.remove();alert('匯入完成，共新增 '+fresh.length+' 筆。');}catch(e){alert('匯入失敗：'+e.message)}finally{b.disabled=false}};
    });
  }
  async function chooseExcel(){
    const input=document.createElement('input');input.type='file';input.accept='.xlsx,.xls,.csv';input.onchange=async()=>{const f=input.files?.[0];if(!f)return;try{const XLSX=await loadXLSX(),wb=XLSX.read(await f.arrayBuffer(),{type:'array',cellDates:true}),ws=wb.Sheets[wb.SheetNames[0]],rows=XLSX.utils.sheet_to_json(ws,{defval:'',raw:true});importPreview(rowsToSlips(rows,XLSX),f.name);}catch(e){alert('Excel 讀取失敗：'+e.message)}};input.click();
  }
  async function exportExcel(){
    const XLSX=await loadXLSX(),rows=[];Object.entries(data.periods||{}).forEach(([period,p])=>(p.slips||[]).forEach(s=>{const r={半年期:period,日期:s.date,工程名稱:s.projectName,業務人員:s.person,工程業績:s.revenue,'分紅%':s.sharePercent,簽核人員:s.approver,備註:s.note,型號:(s.models||[]).map(m=>`${m.model}${m.qty?` x${m.qty}`:''}`).join(' / ')};(s.roles||[]).forEach(x=>r[x.role]=x.name);rows.push(r)}));const wb=XLSX.utils.book_new(),ws=XLSX.utils.json_to_sheet(rows);XLSX.utils.book_append_sheet(wb,ws,'工程獎金');XLSX.writeFile(wb,'半年工程獎金_'+new Date().toISOString().slice(0,10)+'.xlsx');await audit('匯出Excel',`共 ${rows.length} 筆`);
  }
  async function showAudit(){
    try{const r=await dbFetch('/auditLogs.json?orderBy=%22$key%22&limitToLast=100'),o=await r.json()||{},items=Object.values(o).sort((a,b)=>String(b.at).localeCompare(String(a.at)));modal('最近操作紀錄','<div class="auditList">'+(items.length?items.map(x=>`<div><b>${new Date(x.at).toLocaleString('zh-TW')}</b><br>${esc(x.action)}｜${esc(x.by)}<br><small>${esc(x.detail||'')}</small></div>`).join(''):'尚無紀錄')+'</div>');}catch(e){alert('操作紀錄讀取失敗')}
  }
  function modal(title,html,onopen){q('#proModal')?.remove();const w=document.createElement('div');w.id='proModal';w.innerHTML=`<div class="proBox"><button class="proClose">×</button><h3>${esc(title)}</h3>${html}</div>`;document.body.appendChild(w);q('#proModal .proClose').onclick=()=>w.remove();w.onclick=e=>{if(e.target===w)w.remove()};if(onopen)onopen(w);}
  function tools(){
    modal('資料工具',`<div class="toolGrid"><button id="excelImport">📥 Excel 匯入</button><button id="excelExport">📤 匯出 Excel</button><button id="jsonExport">🧰 下載 JSON 備份</button><button id="auditView">🕘 操作紀錄</button></div><p class="toolHint">Excel 匯入會先預覽、檢查重複，正式寫入前會自動建立雲端快照。</p>`,()=>{
      q('#excelImport').onclick=chooseExcel;q('#excelExport').onclick=exportExcel;q('#jsonExport').onclick=()=>{download('bonus-backup_'+new Date().toISOString().replace(/[:.]/g,'-')+'.json',JSON.stringify({exportedAt:new Date().toISOString(),exportedBy:email(),state:data},null,2));audit('匯出JSON','下載完整系統備份')};q('#auditView').onclick=showAudit;
    });
  }
  function installTools(){const a=q('header .actions');if(!a||q('#dataToolsBtn'))return;const b=document.createElement('button');b.id='dataToolsBtn';b.className='hbtn';b.textContent='📦 資料工具';b.onclick=tools;const logout=[...a.querySelectorAll('button')].find(x=>x.textContent.trim()==='登出');logout?a.insertBefore(b,logout):a.appendChild(b);}

  let oldPersist=null;
  function hookPersist(){if(oldPersist||typeof persist!=='function')return;oldPersist=persist;window.persist=function(){queueAudit();window.dispatchEvent(new CustomEvent('haiyi-local-change'));return oldPersist.apply(this,arguments)}}
  const observer=new MutationObserver(()=>{installSearch();applyFilter()});
  (function ready(n=0){try{if(typeof data!=='undefined'&&q('header')){installUserBadge();installTools();hookPersist();installSearch();observer.observe(q('#main'),{childList:true,subtree:false});return}}catch(e){}if(n<80)setTimeout(()=>ready(n+1),250)})(0);
})();