(function(){
  const SAFETY_DB_URL=(firebase.app().options.databaseURL||'').replace(/\/$/,'');
  const LOCAL_BACKUP_KEY='haiyi_bonus_local_backups_v1';
  const KEEP_DAILY=30;
  const KEEP_LOCAL=20;

  function pad(n){return String(n).padStart(2,'0');}
  function stamp(d=new Date()){
    return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  }
  function dayKey(d=new Date()){
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  }
  function cloneState(){return JSON.parse(JSON.stringify(data));}
  function currentEmail(){return (firebase.auth().currentUser&&firebase.auth().currentUser.email)||'unknown';}

  function setCloudStatus(text,ok){
    let el=document.getElementById('cloudSafetyStatus');
    if(!el){
      const anchor=document.getElementById('saveState');
      if(!anchor||!anchor.parentElement)return;
      el=document.createElement('span');
      el.id='cloudSafetyStatus';
      el.style.cssText='font-family:var(--mono);font-size:11px;margin-left:4px;color:'+(ok?'#A9C5AF':'#E7B0A9');
      anchor.insertAdjacentElement('afterend',el);
    }
    el.style.color=ok?'#A9C5AF':'#E7B0A9';
    el.textContent=text;
  }

  function saveLocalBackup(reason){
    try{
      const list=JSON.parse(localStorage.getItem(LOCAL_BACKUP_KEY)||'[]');
      list.unshift({createdAt:new Date().toISOString(),createdBy:currentEmail(),reason,state:cloneState()});
      localStorage.setItem(LOCAL_BACKUP_KEY,JSON.stringify(list.slice(0,KEEP_LOCAL)));
    }catch(e){}
  }

  async function authedFetch(path,options){
    const u=firebase.auth().currentUser;
    if(!u)throw new Error('尚未登入');
    const token=await u.getIdToken();
    const sep=path.includes('?')?'&':'?';
    return fetch(`${SAFETY_DB_URL}${path}${sep}auth=${encodeURIComponent(token)}`,options);
  }

  async function createCloudBackup(reason,type='manual'){
    saveLocalBackup(reason);
    const payload={createdAt:new Date().toISOString(),createdBy:currentEmail(),reason,state:cloneState()};
    const key=stamp();
    const r=await authedFetch(`/backups/${type}/${key}.json`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    if(!r.ok)throw new Error('備份失敗 HTTP '+r.status);
    setCloudStatus('☁ 雲端已同步',true);
    return key;
  }

  async function createDailyBackup(){
    try{
      const key=dayKey();
      const chk=await authedFetch(`/backups/daily/${key}.json`);
      if(chk.ok){
        const existing=await chk.json();
        if(!existing){
          const payload={createdAt:new Date().toISOString(),createdBy:currentEmail(),reason:'每日自動備份',state:cloneState()};
          await authedFetch(`/backups/daily/${key}.json`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
          saveLocalBackup('每日自動備份');
        }
      }
      const listRes=await authedFetch('/backups/daily.json');
      if(listRes.ok){
        const obj=await listRes.json()||{};
        const keys=Object.keys(obj).sort().reverse();
        for(const old of keys.slice(KEEP_DAILY)){
          await authedFetch(`/backups/daily/${encodeURIComponent(old)}.json`,{method:'DELETE'});
        }
      }
      setCloudStatus('☁ 雲端已同步',true);
    }catch(e){
      saveLocalBackup('每日本機備援');
      setCloudStatus('⚠ 本機備援',false);
    }
  }

  async function heartbeat(){
    try{
      const r=await authedFetch('/state.json?shallow=true');
      setCloudStatus(r.ok?'☁ 雲端已同步':'⚠ 本機備援',r.ok);
    }catch(e){setCloudStatus('⚠ 本機備援',false);}
  }

  function requireTypedConfirm(message){
    return prompt(message+'\n\n為避免誤刪，請輸入「刪除」確認：')==='刪除';
  }

  async function guardedDeleteSlip(btn){
    const id=btn.getAttribute('data-delete-slip');
    if(!requireTypedConfirm('確定刪除此獎金單？'))return;
    try{await createCloudBackup('刪除獎金單前自動備份','before-delete');}catch(e){if(!confirm('雲端備份失敗，但本機備份已建立。仍要繼續刪除嗎？'))return;}
    currentPeriod().slips=currentSlips().filter(s=>s.id!==id);persist();renderMain();renderHeader();
  }

  async function guardedReset(){
    if(!requireTypedConfirm('確定清空目前半年期全部獎金單？'))return;
    try{await createCloudBackup('清空半年期前自動備份','before-delete');}catch(e){if(!confirm('雲端備份失敗，但本機備份已建立。仍要繼續清空嗎？'))return;}
    data.periods[data.current]={slips:[]};persist();render();
  }

  async function guardedDeletePeriod(){
    if(data.order.length<=1)return;
    if(!requireTypedConfirm(`確定刪除「${periodLabel(data.current)}」整個半年期？`))return;
    try{await createCloudBackup('刪除半年期前自動備份','before-delete');}catch(e){if(!confirm('雲端備份失敗，但本機備份已建立。仍要繼續刪除嗎？'))return;}
    data.order=data.order.filter(id=>id!==data.current);delete data.periods[data.current];data.current=data.order[data.order.length-1];persist();render();
  }

  function flattenCloudBackups(obj){
    const out=[];
    for(const [type,group] of Object.entries(obj||{})){
      for(const [key,b] of Object.entries(group||{})){
        if(b&&b.state)out.push({...b,type,key});
      }
    }
    return out.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
  }

  function openRestoreModal(items){
    let old=document.getElementById('backupRestoreModal');if(old)old.remove();
    const wrap=document.createElement('div');wrap.id='backupRestoreModal';
    wrap.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.48);z-index:99999;display:flex;align-items:center;justify-content:center;padding:18px';
    const box=document.createElement('div');box.style.cssText='background:#fff;color:#1F2A44;width:min(680px,100%);max-height:80vh;overflow:auto;border-radius:10px;padding:18px;box-shadow:0 12px 40px rgba(0,0,0,.25)';
    box.innerHTML='<h3 style="margin:0 0 10px">備份與還原</h3><div style="font-size:12px;color:#5B6358;margin-bottom:12px">每日自動備份保留最近 30 天；刪除前也會自動建立快照。</div>';
    const manual=document.createElement('button');manual.className='hbtn';manual.style.cssText='color:#1F2A44;border-color:#CBCFC2;margin-right:8px';manual.textContent='立即建立備份';manual.onclick=async()=>{manual.disabled=true;try{await createCloudBackup('手動雲端備份','manual');alert('備份完成');wrap.remove();}catch(e){alert('雲端備份失敗，已建立本機備援');}finally{manual.disabled=false;}};
    const close=document.createElement('button');close.className='hbtn';close.style.cssText='color:#1F2A44;border-color:#CBCFC2';close.textContent='關閉';close.onclick=()=>wrap.remove();
    box.append(manual,close);
    const list=document.createElement('div');list.style.marginTop='14px';
    if(!items.length)list.innerHTML='<div style="padding:14px;background:#f4f5f0;border-radius:6px">目前尚無雲端備份。</div>';
    items.slice(0,60).forEach(b=>{
      const row=document.createElement('div');row.style.cssText='display:flex;gap:10px;align-items:center;justify-content:space-between;padding:10px 4px;border-top:1px solid #E0E2DA';
      const info=document.createElement('div');
      const dt=b.createdAt?new Date(b.createdAt).toLocaleString('zh-TW'):b.key;
      info.innerHTML=`<div style="font-weight:600;font-size:13px">${esc(dt)}</div><div style="font-size:11px;color:#687064">${esc(b.reason||b.type)}｜${esc(b.createdBy||'')}</div>`;
      const restore=document.createElement('button');restore.className='hbtn';restore.style.cssText='color:#A63D2E;border-color:#D8B7B1;flex:0 0 auto';restore.textContent='還原';
      restore.onclick=async()=>{
        if(prompt('還原會覆蓋目前資料。請輸入「還原」確認：')!=='還原')return;
        restore.disabled=true;
        try{
          await createCloudBackup('還原前自動備份','before-restore');
          data=ensureShape(JSON.parse(JSON.stringify(b.state)));
          persist();render();
          alert('已還原完成');wrap.remove();
        }catch(e){alert('還原失敗：'+e.message);}finally{restore.disabled=false;}
      };
      row.append(info,restore);list.appendChild(row);
    });
    box.appendChild(list);wrap.appendChild(box);document.body.appendChild(wrap);
  }

  async function showBackups(){
    try{
      const r=await authedFetch('/backups.json');
      const obj=r.ok?await r.json():{};
      openRestoreModal(flattenCloudBackups(obj));
    }catch(e){alert('目前無法讀取雲端備份，請確認網路連線。');}
  }

  function installButton(){
    const actions=document.querySelector('header .actions');
    if(!actions||document.getElementById('safetyBackupBtn'))return;
    const b=document.createElement('button');b.id='safetyBackupBtn';b.className='hbtn';b.textContent='🛡 備份／還原';b.onclick=showBackups;
    const logout=[...actions.querySelectorAll('button')].find(x=>x.textContent.trim()==='登出');
    if(logout)actions.insertBefore(b,logout);else actions.appendChild(b);
  }

  document.addEventListener('click',function(ev){
    const slip=ev.target.closest&&ev.target.closest('[data-delete-slip]');
    const reset=ev.target.closest&&ev.target.closest('#resetBtn');
    const period=ev.target.closest&&ev.target.closest('#deletePeriodBtn');
    if(!slip&&!reset&&!period)return;
    ev.preventDefault();ev.stopPropagation();ev.stopImmediatePropagation();
    if(slip)guardedDeleteSlip(slip);else if(reset)guardedReset();else guardedDeletePeriod();
  },true);

  window.addEventListener('offline',()=>setCloudStatus('⚠ 本機備援',false));
  window.addEventListener('online',heartbeat);

  (function waitReady(attempt=0){
    try{
      if(typeof data!=='undefined'&&typeof persist==='function'&&document.querySelector('header')){
        installButton();
        createDailyBackup();
        heartbeat();
        setInterval(heartbeat,30000);
        return;
      }
    }catch(e){}
    if(attempt<80)setTimeout(()=>waitReady(attempt+1),250);
  })();
})();
