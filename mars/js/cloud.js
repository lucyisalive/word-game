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
  function backupHistory(){
    const raw=localStorage.getItem(BACKUP_KEY);
    if(!raw)return [];
    const parsed=JSON.parse(raw);return Array.isArray(parsed)?parsed:[];
  }
  function archiveBackup(key,raw){
    if(!raw)return;
    const entries=backupHistory();
    if(entries.some(entry=>entry.raw===raw))return;
    entries.push({key,savedAt:Date.now(),raw});
    localStorage.setItem(BACKUP_KEY,JSON.stringify(entries.slice(-8)));
  }
  function preserveExistingBackups(){
    for(const suffix of ["before_cloud_connect","before_cloud_restore","before_cloud_unsynced","before_legacy_import","before_v3"]){
      const key=STORAGE_KEY+"_"+suffix;archiveBackup(key,localStorage.getItem(key));
    }
  }
  function backupLocal(label){
    preserveExistingBackups();
    const raw=localStorage.getItem(STORAGE_KEY)||JSON.stringify(state);
    archiveBackup(STORAGE_KEY,raw);
    localStorage.setItem(STORAGE_KEY+"_before_cloud_"+label,raw);
  }
  function backupBundle(){
    preserveExistingBackups();
    return {game:"duoduo-sync-backups",exportedAt:Date.now(),current:clone(state),backups:backupHistory().map(entry=>({key:entry.key,savedAt:entry.savedAt,state:JSON.parse(entry.raw)}))};
  }
  function hasLocalWork(data){
    return (data.base?.coins||0)>0 || (data.session?.log||[]).length>0 || Object.values(data.wordBank||{}).some(w=>w.source==="custom" || w.progress>0 || w.lastPracticed || w.firstTestDate || w.wrongTotal>0);
  }
  function adopt(data,notify=true){
    if(!valid(data.state))throw new Error("invalid-cloud-save");
    backupLocal("restore");
    const before=state;
    applying=true;
    try{
      localStorage.setItem(STORAGE_KEY,JSON.stringify(data.state));loadState();
      revision=Number(data.revision)||0;dirty=false;writeMeta();
    }catch(error){state=before;localStorage.setItem(STORAGE_KEY,JSON.stringify(before));throw error;}
    finally{applying=false;}
    if(notify && remoteHandler)remoteHandler();
  }
  function listen(){
    if(unsubscribe)unsubscribe();
    const target=ref,stamp=generation;
    unsubscribe=target.onSnapshot(snapshot=>{
      if(stamp!==generation || !snapshot.exists || snapshot.metadata?.hasPendingWrites || snapshot.metadata?.fromCache)return;
      const data=snapshot.data(),next=Number(data.revision)||0;
      if(!valid(data.state) || next<=revision)return;
      if(data.writer===sessionId){revision=next;writeMeta();return;}
      if(dirty){emit("conflict","另一台设备已有新进度。本机未同步的记录已保留，点“读取云端进度”继续。");return;}
      try{adopt(data);emit("synced","已连接家庭码，进度会自动同步。其他设备输入同一码即可继续。");}
      catch{emit("error","云端记录暂时未能保存到本机，请导出本机存档后重试。");}
    },()=>{if(stamp===generation)emit("offline","暂时无法连接云端，进度已保存在本机，联网后会重试。");});
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
        else emit("offline","暂时无法连接云端，进度已保存在本机，联网后会重试。");
      }
      return false;
    }finally{
      busy=false;
      if(stamp===generation && dirty && status.phase!=="conflict"){clearTimeout(saveTimer);saveTimer=setTimeout(()=>flush(),status.phase==="offline"?10000:800);}
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
      await ensureSdk();
      const target=db.collection("families").doc(targetId);
      const snapshot=await timeout(target.get({source:"server"}));
      let data=snapshot.exists?snapshot.data():null;
      if(data && !valid(data.state))throw new Error("invalid-cloud-save");
      // 首次绑定时，本机已经学过或录过词，必须先核对；不能直接用云端盖掉。
      if(data && !allowReplace && !previous.pass && cached.docId!==targetId && hasLocalWork(state)){
        backupLocal("connect");
        emit("unlinked-local","本机有尚未同步的学习记录和词语，已保留。请先导出同步备份并核对合并，再连接家庭码。");
        return false;
      }
      if(!data){
        // 沿用同一家庭码时，可以从旧版云存档自动承接学习记录。
        const legacy=await timeout(db.collection("families").doc(passcodeToDocId(pass)).get({source:"server"}));
        backupLocal("connect");
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
      backupLocal("connect");
      generation++;if(unsubscribe){unsubscribe();unsubscribe=null;}clearTimeout(saveTimer);
      ref=target;ready=true;
      const preservePending=startup && cached.docId===targetId && cached.dirty;
      if(preservePending){
        revision=Number(cached.revision)||0;dirty=true;
        if((Number(data.revision)||0)!==revision)emit("conflict","另一台设备已有新进度。本机离线记录已保留，点“读取云端进度”继续。");
      }else adopt(data,!startup);
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
      emit(error.message==="invalid-cloud-save"?"error":"offline",error.message==="invalid-cloud-save"?"云端记录格式不符，已保留本机进度，请核对家庭码。":"暂时无法连接云端，进度已保存在本机，联网后会重试。");
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
      if(dirty)backupLocal("unsynced");
      adopt(snapshot.data());emit("synced","已读取云端最新进度。");return true;
    }catch{emit("offline","暂时无法读取云端，已保留本机进度，请稍后重试。");return false;}
  }
  async function syncNow(){
    if(!ref)return connect(getPasscode());
    if(status.phase==="conflict")return pull();
    if(dirty)return flush();return pull();
  }
  async function start(){preserveExistingBackups();const pass=getPasscode();if(pass)return connect(pass,{startup:true});emit("local","输入旧版家庭码，即可在不同设备继续学习。");return false;}
  function retry(){if(!getPasscode())return;if(!ref || !ready)connect(getPasscode(),{startup:true});else if(dirty)flush();}
  if(typeof window.addEventListener==="function"){
    window.addEventListener("online",retry);
    window.addEventListener("focus",retry);
    window.addEventListener("pagehide",()=>{if(dirty)flush();});
  }
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)retry();});
  return {start,connect,saved,flush,syncNow,getPasscode,passcodeToDocId,documentId,backupBundle,
    onStatus(fn){statusHandler=fn;fn({...status});},onRemote(fn){remoteHandler=fn;},info:()=>({...status,dirty,revision})};
})();

// 存档模块先于云模块加载，通过显式窗口接口接入后加载的自动同步。
window.WordGameCloudSync=CloudSync;
