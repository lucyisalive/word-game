"use strict";
/* 与旧版同用 Firebase / Firestore 和家庭码。新版存入同一 families 集合的
   独立版本文档，沿用家庭码算法，旧版客户端的整份保存不会覆盖新版。 */
const CloudSync = (()=>{
  const CONFIG = {
  apiKey: "AIzaSyDqluATsP-ROHTtRCRsXAI3rK-mL_9kjU8",
  authDomain: "game-e-40894.firebaseapp.com",
  projectId: "game-e-40894",
  storageBucket: "game-e-40894.firebasestorage.app",
  messagingSenderId: "321316666980",
  appId: "1:321316666980:web:ec2045d743e75297da2971"
};
  const PASSCODE_KEY="wdg_family_passcode",META_KEY="planet_cloud_sync_v1";
  const BACKUP_KEY=STORAGE_KEY+"_cloud_backup_history";
  const sessionId=Date.now().toString(36)+Math.random().toString(36).slice(2);
  const SDK_ROOT="https://www.gstatic.com/firebasejs/10.13.0/";
  let db=null,ref=null,unsubscribe=null,sdkPromise=null;
  let ready=false,applying=false,busy=false,generation=0,revision=0,dirty=false,change=0,saveTimer=null;
  let remoteQueue=Promise.resolve(),archiveReady=false;
  let remoteHandler=null,statusHandler=null,status={phase:"local",text:"尚未连接家庭码，进度保存在本机。",connected:false};
  const clone=value=>JSON.parse(JSON.stringify(value));
  function getPasscode(){try{return localStorage.getItem(PASSCODE_KEY)||"";}catch{return "";}}
  function readMeta(){try{return JSON.parse(localStorage.getItem(META_KEY))||{};}catch{return {};}}
  function writeMeta(){if(ref)localStorage.setItem(META_KEY,JSON.stringify({docId:ref.id,revision,dirty}));}
  function emit(phase,text){status={phase,text,connected:!!ref};if(statusHandler)statusHandler({...status});}
  function passcodeToDocId(passcode){
    let hash=0xcbf29ce484222325n;
    for(const letter of "wdg:"+passcode.trim()){
      // 旧版按 UTF-16 码元计算；中文和普通英数字均保持原来的定位方式。
      for(let i=0;i<letter.length;i++){hash^=BigInt(letter.charCodeAt(i));hash=(hash*0x100000001b3n)&0xFFFFFFFFFFFFFFFFn;}
    }
    return hash.toString(16).padStart(16,"0");
  }
  function documentId(passcode){return passcodeToDocId(passcode)+"_planet_v3";}
  function valid(data){return !!data && data.rulesVersion===3 && data.wordBank && !Array.isArray(data.wordBank) && data.base && typeof data.wordBank==="object";}
  function freshFamilyState(){
    const previous=state;
    try{
      state={rulesVersion:3,wordBank:{},base:defaultBase(),session:null,harvestRewards:[],updatedAt:Date.now()};
      for(const [word,meaning,syllables] of DEFAULT_WORDS)state.wordBank[word]=ensureWordRules({id:word,word,meaning,syllables:syllables.slice(),source:"default",progress:0,needsExplanation:false,lastPracticed:null,addedDate:null,priorityDate:null});
      state.session=buildDailySession();return clone(state);
    }finally{state=previous;}
  }
  function timeout(promise,ms=8000){let handle;return Promise.race([promise,new Promise((_,reject)=>{handle=setTimeout(()=>reject(new Error("network-timeout")),ms);})]).finally(()=>clearTimeout(handle));}
  function script(src,id){return new Promise((resolve,reject)=>{
    const node=document.createElement("script");node.id=id;node.src=src;node.crossOrigin="anonymous";
    node.onload=resolve;node.onerror=()=>{node.remove();reject(new Error("sdk-unavailable"));};document.head.appendChild(node);
  });}
  async function ensureSdk(){
    if(db)return db;
    if(!sdkPromise)sdkPromise=(async()=>{
      if(!window.firebase?.initializeApp)await timeout(script(SDK_ROOT+"firebase-app-compat.js","family-firebase-app"));
      if(!window.firebase?.firestore)await timeout(script(SDK_ROOT+"firebase-firestore-compat.js","family-firestore"));
      const sdk=window.firebase;
      const app=(sdk.apps||[]).find(a=>a.name==="duoduo-v3")||sdk.initializeApp(CONFIG,"duoduo-v3");
      db=app.firestore();return db;
    })().catch(error=>{sdkPromise=null;throw error;});
    return sdkPromise;
  }
  // 历史快照使用浏览器数据库，避免多份完整存档挤满localStorage。
  // 旧备份必须在数据库事务提交后才移走；失败时保留原件。
  let archiveDbPromise=null,archiveMigration=null;
  function archiveDb(){
    if(!window.indexedDB)return Promise.reject(new Error("backup-database-unavailable"));
    if(!archiveDbPromise)archiveDbPromise=new Promise((resolve,reject)=>{
      const request=window.indexedDB.open("duoduo-learning-backups",1);
      request.onupgradeneeded=()=>{request.result.createObjectStore("snapshots",{keyPath:"id",autoIncrement:true});};
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
      request.onblocked=()=>reject(new Error("backup-database-blocked"));
    }).catch(error=>{archiveDbPromise=null;throw error;});
    return archiveDbPromise;
  }
  async function archiveEntries(entries){
    if(!entries.length)return;
    const db=await archiveDb();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction("snapshots","readwrite"),store=tx.objectStore("snapshots"),request=store.getAll();let cause=null;
      request.onsuccess=()=>{try{
        const rows=request.result,known=new Set(rows.map(row=>row.raw));
        for(const entry of entries){if(!entry.raw || known.has(entry.raw))continue;store.add(entry);known.add(entry.raw);}
        // 最近12份自动快照。旧版搬家等一次性备份不参与日常轮换。
        const rolling=rows.filter(row=>row.rolling);
        for(const row of rolling.slice(0,Math.max(0,rolling.length-10)))store.delete(row.id);
      }catch(error){cause=error;tx.abort();}};
      tx.oncomplete=resolve;tx.onabort=()=>reject(cause||tx.error||new Error("backup-transaction-aborted"));tx.onerror=()=>{};
    });
  }
  async function archiveRows(){
    const db=await archiveDb();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction("snapshots","readonly"),request=tx.objectStore("snapshots").getAll();let rows=[];
      request.onsuccess=()=>{rows=request.result;};tx.oncomplete=()=>resolve(rows);tx.onabort=()=>reject(tx.error);tx.onerror=()=>{};
    });
  }
  function legacyBackups(){
    const aliases=["before_cloud_connect","before_cloud_restore","before_cloud_unsynced","before_legacy_import","before_v3"].map(suffix=>STORAGE_KEY+"_"+suffix);
    const originals=aliases.map(key=>({key,raw:localStorage.getItem(key)})).filter(row=>row.raw);
    const historyRaw=localStorage.getItem(BACKUP_KEY);
    let history=[];try{history=historyRaw?JSON.parse(historyRaw):[];}catch{throw new Error("backup-history-invalid");}
    return {originals,historyRaw,entries:[...(Array.isArray(history)?history:[]),...originals.map(row=>({...row,savedAt:Date.now()}))]};
  }
  async function preserveExistingBackups(){
    if(archiveReady)return;
    if(!archiveMigration)archiveMigration=(async()=>{
      const old=legacyBackups();
      await archiveEntries(old.entries);
      // 只移走已确认归档且未被另一页面改写的旧备份键；不碰主存档、旧游戏或家庭码。
      for(const row of old.originals)if(localStorage.getItem(row.key)===row.raw)localStorage.removeItem(row.key);
      if(old.historyRaw && localStorage.getItem(BACKUP_KEY)===old.historyRaw)localStorage.removeItem(BACKUP_KEY);
      archiveReady=true;
    })().catch(error=>{archiveMigration=null;throw error;});
    return archiveMigration;
  }
  async function backupLocal(label){
    await preserveExistingBackups();
    const current=JSON.stringify(state),saved=localStorage.getItem(STORAGE_KEY);
    const entries=[{key:STORAGE_KEY+"_before_cloud_"+label,savedAt:Date.now(),raw:current,rolling:true}];
    if(saved && saved!==current)entries.push({key:STORAGE_KEY,savedAt:Date.now(),raw:saved,rolling:true});
    await archiveEntries(entries);
  }
  async function backupBundle(){
    await preserveExistingBackups();
    return {game:"duoduo-sync-backups",exportedAt:Date.now(),current:clone(state),backups:(await archiveRows()).map(entry=>({key:entry.key,savedAt:entry.savedAt,state:JSON.parse(entry.raw)}))};
  }
  function failure(error,action){
    const storage=error?.name==="QuotaExceededError" || /backup-|storage/.test(error?.message||"");
    console.error("家庭码同步失败：",action,error?.name,error?.code||error?.message);
    emit(storage?"storage-error":"offline",storage
      ?"本机备份或存储未完成，原记录仍保留，未覆盖云端。请导出当前学习存档后重试。"
      :"暂时无法连接云端，进度保存在本机，联网后重试。");
  }
  function hasLocalWork(data){
    return (data.base?.coins||0)>0 || (data.session?.log||[]).length>0 || Object.values(data.wordBank||{}).some(w=>w.source==="custom" || w.progress>0 || w.lastPracticed || w.firstTestDate || w.wrongTotal>0);
  }
  async function adopt(data,notify=true){
    if(!valid(data.state))throw new Error("invalid-cloud-save");
    const serial=change;
    await backupLocal("restore");
    if(change!==serial)throw new Error("local-changed-during-read");
    const before=state,oldRaw=localStorage.getItem(STORAGE_KEY),oldMeta=localStorage.getItem(META_KEY),oldRevision=revision,oldDirty=dirty;
    applying=true;
    try{
      localStorage.setItem(STORAGE_KEY,JSON.stringify(data.state));loadState();
      revision=Number(data.revision)||0;dirty=false;writeMeta();
    }catch(error){state=before;revision=oldRevision;dirty=oldDirty;if(oldRaw===null)localStorage.removeItem(STORAGE_KEY);else localStorage.setItem(STORAGE_KEY,oldRaw);if(oldMeta===null)localStorage.removeItem(META_KEY);else localStorage.setItem(META_KEY,oldMeta);throw error;}
    finally{applying=false;}
    if(notify && remoteHandler)remoteHandler();
  }
  function listen(){
    if(unsubscribe)unsubscribe();
    const target=ref,stamp=generation;
    unsubscribe=target.onSnapshot(snapshot=>{
      remoteQueue=remoteQueue.then(async()=>{
        if(stamp!==generation || !snapshot.exists || snapshot.metadata?.hasPendingWrites || snapshot.metadata?.fromCache)return;
        const data=snapshot.data(),next=Number(data.revision)||0;
        if(!valid(data.state) || next<=revision)return;
        if(data.writer===sessionId){revision=next;writeMeta();return;}
        if(dirty){emit("conflict","另一台设备已有新进度。本机未同步记录仍保留，请先导出备份并核对，再读取云端。");return;}
        try{await adopt(data);emit("synced","已连接家庭码，进度会自动同步。其他设备输入同一码即可继续。");}
        catch(error){if(error.message==="local-changed-during-read")emit("conflict","读取期间本机有新记录，已保留两边存档，请重新同步。");else failure(error,"读取并保存云端记录");}
      }).catch(error=>failure(error,"接收云端更新"));
    },error=>{if(stamp===generation)failure(error,"监听云端");});
  }

  function saved(){
    if(applying || !ready || !ref)return;
    dirty=true;change++;writeMeta();
    if(status.phase!=="conflict")emit("pending","进度已保存在本机，正在准备同步…");
    clearTimeout(saveTimer);saveTimer=setTimeout(()=>flush(),600);
  }
  async function flush(){
    if(!ready || !ref || !dirty || busy || status.phase==="conflict")return false;
    busy=true;clearTimeout(saveTimer);
    const target=ref,stamp=generation,serial=change,base=revision,payload=clone(state);
    emit("saving","正在保存到云端…");
    try{
      const next=await db.runTransaction(async tx=>{
        const snapshot=await tx.get(target),data=snapshot.exists?snapshot.data():null;
        if((Number(data?.revision)||0)!==base)throw new Error("cloud-conflict");
        const number=base+1;
        tx.set(target,{game:"duoduo-v3",state:payload,revision:number,updatedAt:Date.now(),writer:sessionId});
        return number;
      });
      if(stamp!==generation)return false;
      revision=next;if(change===serial)dirty=false;writeMeta();
      emit(dirty?"pending":"synced",dirty?"本机又有新进度，正在继续同步…":"已保存到云端，换设备输入同一家庭码即可继续。");
      return true;
    }catch(error){
      if(stamp===generation){
        if(error.message==="cloud-conflict")emit("conflict","另一台设备已有新进度。本机未同步的记录已保留，点“读取云端进度”继续。");
        else failure(error,"上传学习记录");
      }
      return false;
    }finally{
      busy=false;
      if(stamp===generation && dirty && !["conflict","storage-error"].includes(status.phase)){clearTimeout(saveTimer);saveTimer=setTimeout(()=>flush(),status.phase==="offline"?10000:800);}
    }
  }
  async function connect(input,{startup=false,allowReplace=false}={}){
    const pass=String(input||"").trim();if(!pass){emit("local","请先输入原来的家庭码。");return false;}
    if(busy){emit("saving","正在保存当前进度，请稍候再连接。");return false;}
    const targetId=documentId(pass),cached=readMeta();
    const previous={ref,ready,revision,dirty,pass:getPasscode()};
    let provisionalBefore=null;
    clearTimeout(saveTimer);
    if(ref && dirty && previous.pass!==pass){await flush();if(dirty)return false;previous.revision=revision;previous.dirty=dirty;}
    emit("connecting","正在读取家庭存档…");
    try{
      await preserveExistingBackups();
      await ensureSdk();
      const target=db.collection("families").doc(targetId);
      const snapshot=await timeout(target.get({source:"server"}));
      let data=snapshot.exists?snapshot.data():null;
      if(data && !valid(data.state))throw new Error("invalid-cloud-save");
      // 首次绑定时，本机已经学过或录过词，必须先核对；不能直接用云端盖掉。
      if(data && !allowReplace && !previous.pass && cached.docId!==targetId && hasLocalWork(state)){
        await backupLocal("connect");
        emit("unlinked-local","本机有尚未同步的学习记录和词语，已保留。请先导出同步备份并核对合并，再连接家庭码。");
        return false;
      }
      if(!data){
        // 沿用同一家庭码时，可以从旧版云存档自动承接学习记录。
        const legacy=await timeout(db.collection("families").doc(passcodeToDocId(pass)).get({source:"server"}));
        await backupLocal("connect");
        provisionalBefore=state;
        if(previous.pass && previous.pass!==pass)state=freshFamilyState();
        if(legacy.exists && legacy.data()?.state?.wordBank){
          applying=true;try{migrateFromLegacy(legacy.data().state);}finally{applying=false;}
        }
        const candidate=clone(state);
        data=await db.runTransaction(async tx=>{
          const current=await tx.get(target);
          if(current.exists)return current.data();
          const initial={game:"duoduo-v3",state:candidate,revision:1,updatedAt:Date.now(),writer:sessionId};
          tx.set(target,initial);return initial;
        });
        if(!valid(data.state))throw new Error("invalid-cloud-save");
      }
      await backupLocal("connect");
      generation++;if(unsubscribe){unsubscribe();unsubscribe=null;}clearTimeout(saveTimer);
      ref=target;ready=true;
      const preservePending=startup && cached.docId===targetId && cached.dirty;
      if(preservePending){
        revision=Number(cached.revision)||0;dirty=true;
        if((Number(data.revision)||0)!==revision)emit("conflict","另一台设备已有新进度。本机离线记录已保留，点“读取云端进度”继续。");
      }else await adopt(data,!startup);
      localStorage.setItem(PASSCODE_KEY,pass);writeMeta();listen();
      if(status.phase!=="conflict"){
        emit(dirty?"pending":"synced",dirty?"正在同步本机离线时的进度…":"已连接家庭码，进度会自动同步。其他设备输入同一码即可继续。");
        if(dirty)await flush();
      }
      return true;
    }catch(error){
      if(provisionalBefore){state=provisionalBefore;localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}
      ref=previous.ref;ready=previous.ready;revision=previous.revision;dirty=previous.dirty;
      if(startup && db && cached.docId===targetId){ref=db.collection("families").doc(targetId);ready=true;revision=Number(cached.revision)||0;dirty=!!cached.dirty;listen();}
      if(error.message==="invalid-cloud-save")emit("error","云端记录格式不符，已保留本机进度，请核对家庭码。");
      else failure(error,"连接家庭码");
      return false;
    }
  }
  async function pull(){
    if(!ref)return connect(getPasscode());
    if(busy)return false;
    try{
      emit("connecting","正在读取最新进度…");
      const snapshot=await timeout(ref.get({source:"server"}));
      if(!snapshot.exists)throw new Error("missing-cloud-save");
      if(dirty)await backupLocal("unsynced");
      await adopt(snapshot.data());emit("synced","已读取云端最新进度。");return true;
    }catch(error){if(error.message==="local-changed-during-read")emit("conflict","读取期间本机有新记录，已保留两边存档，请重新同步。");else failure(error,"读取最新进度");return false;}
  }
  async function syncNow(){
    if(!ref)return connect(getPasscode());
    if(status.phase==="conflict")return pull();
    if(dirty)return flush();return pull();
  }
  async function start(){
    try{await preserveExistingBackups();}catch(error){failure(error,"整理本机备份");return false;}
    const pass=getPasscode();if(pass)return connect(pass,{startup:true});emit("local","输入同一个家庭码，可在不同设备继续学习。");return false;
  }
  function retry(){if(!getPasscode())return;if(!ref || !ready)connect(getPasscode(),{startup:true});else if(dirty)flush();}
  if(typeof window.addEventListener==="function"){
    window.addEventListener("online",retry);
    window.addEventListener("focus",retry);
    window.addEventListener("pagehide",()=>{if(dirty)flush();});
  }
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)retry();});
  return {start,connect,saved,flush,syncNow,getPasscode,passcodeToDocId,documentId,backupBundle,
    onStatus(fn){statusHandler=fn;fn({...status});},onRemote(fn){remoteHandler=fn;},settled:()=>remoteQueue,localSaveFailed:error=>failure(error,"保存本机学习记录"),info:()=>({...status,dirty,revision})};
})();

// 存档模块先于云模块加载，通过显式窗口接口接入后加载的自动同步。
window.WordGameCloudSync=CloudSync;
