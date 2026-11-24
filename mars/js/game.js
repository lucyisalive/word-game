"use strict";
/* ============================================================================
   game.js —— 游戏层：氧气、多多钱、植物显示与词库导入

   ⚠️ 红线：这一层的任何输赢，都不能影响单词的掌握进度。
      氧气耗尽只暂停当前题，补给后原题继续。
      该送实验室还是送实验室 —— 那是 core.js 管的事，这里绝不插手。
   ============================================================================ */

/* ---------------------------------------------------------------------------
   🫧 氧气
   --------------------------------------------------------------------------- */

// 每个作答轮次有独立氧气，旧的16格字段不再参与判定。
function oxygenLetters(task){
  return Math.max(1,(expectedAnswerFor(task).match(/[a-z]/gi)||[]).length);
}
function ensureQuestionOxygen(task){
  if(!task)return null;
  const key=task.type+":"+(task.roundIndex||0);
  if(task.oxygenKey!==key || !Number.isFinite(task.oxygenRemainingMs) || !Number.isFinite(task.oxygenDurationMs)){
    task.oxygenKey=key;task.oxygenDurationMs=oxygenLetters(task)*CONFIG.secsPerLetter*1000;
    task.oxygenRemainingMs=task.oxygenDurationMs;task.oxygenDraft="";
  }
  task.oxygenRemainingMs=Math.max(0,Math.min(task.oxygenDurationMs,task.oxygenRemainingMs));
  return task;
}
function resetQuestionOxygen(task){
  if(!task)return;
  delete task.oxygenKey;ensureQuestionOxygen(task);
}
function isOutOfOxygen(){
  const t=ensureQuestionOxygen(state.session?.current);
  return !!t && t.oxygenRemainingMs<=0;
}
function buyQuestionOxygen(){
  const t=state.session?.current;
  if(!t || !isOutOfOxygen() || state.base.coins<CONFIG.oxygenCanCost)return false;
  const draft=t.oxygenDraft;
  state.base.coins-=CONFIG.oxygenCanCost;
  resetQuestionOxygen(t);t.oxygenDraft=draft;t.oxygenRefills=(t.oxygenRefills||0)+1;
  saveState();return true;
}
function parentSupplyOxygen(){
  const t=state.session?.current;
  if(!t || !isOutOfOxygen() || state.base.coins>=CONFIG.oxygenCanCost)return false;
  const draft=t.oxygenDraft;
  resetQuestionOxygen(t);t.oxygenDraft=draft;t.parentOxygenRefills=(t.parentOxygenRefills||0)+1;
  saveState();return true;
}

function returnCurrentToQueue(){
  const s=state.session,t=s.current;
  if(t && state.wordBank[t.wordId] && !state.wordBank[t.wordId].needsExplanation && state.wordBank[t.wordId].progress<3 && !s.learnQueue.includes(t.wordId)) s.learnQueue.unshift(t.wordId);
  s.current=null;
}

function coinsPerHarvest(){ return CONFIG.coinPerHarvest; }

/* ---------------------------------------------------------------------------
   🌾 农场缩略带：每个词一格，格子的状态从 session.log 推出来
   --------------------------------------------------------------------------- */

/* 地里长成什么样，跟这个词的**掌握进度**走，不是跟"今天过没过"走。

   ⚠️ 这里原来是错的：只要今天复查通过就直接显示成熟，
      于是一个要学三天的词，第一天就长成了结满果子的样子 ——
      孩子完全看不出"我还差两天"。

   现在：
     progress 1 → 🌱 小苗      （第一天掌握）
     progress 2 → 🌿 中苗      （第二天掌握）
     progress 3 → 🌾 成熟可收  （第三天掌握 / 或本来就会一天直达）      */
function plotStatusFor(wordId){
  const w=state.wordBank[wordId];
  return !w || w.progress===0 ? "empty" : w.progress===1 ? "sown" : w.progress===2 ? "sprout" : "ripe";
}

// 这个词今天通过之后，是不是长到了「可以收获」的程度
function isRipeNow(wordId){ return plotStatusFor(wordId) === "ripe"; }

const PLOT_ICON = {
  empty:"", sown:"🌰", seedling:"🌱", sprout:"🌱", grown:"🌿", ripe:"🌾", wilted:"🥀", dead:"🧪"
};

/* ---------------------------------------------------------------------------
   📋 批量粘贴导入
   解析策略：扫到第一个中文字符，前面全算英文，后面全算中文。
   不按空格切 —— 那会把 "get up 起床" 这种词组切坏。
   --------------------------------------------------------------------------- */

const CJK_RE = /[一-鿿㐀-䶿豈-﫿]/;

function parseWordList(text){
  const ok = [], bad = [];
  const lines = (text || "").split(/\r?\n/);
  for(const rawLine of lines){
    let line = rawLine.trim();
    if(!line) continue;
    // 剥掉行首编号：1. / 1、/ (1) / １．
    line = line.replace(/^[（(\[]?\s*\d+\s*[\.、,，)）\]:：]\s*/, "").trim();
    // 剥掉音标：/frend/ 或 [frend]
    line = line.replace(/\/[^\/]{1,30}\//g, " ").replace(/\[[^\]]{1,30}\]/g, " ");
    const m = line.match(CJK_RE);
    if(!m){ bad.push(rawLine.trim()); continue; }
    const cut = line.indexOf(m[0]);
    let english = line.slice(0, cut);
    let chinese = line.slice(cut).trim();
    // 去掉英文尾巴上的分隔符（空格、逗号、破折号、冒号……），保留字母/撇号/连字符/空格
    english = english.replace(/[\s\-—–:：,，.。、|/\\]+$/, "").trim();
    if(!/[a-zA-Z]/.test(english) || !chinese){ bad.push(rawLine.trim()); continue; }
    // ⚠️ 绝不转小写 —— May 的首字母大写是正确答案
    const syllables = applyWordCasing(english, autoSplitSyllables(english));
    ok.push({ word: english, meaning: chinese, syllables });
  }
  return { ok, bad };
}

// 把解析结果写进词库。已存在的词跳过，绝不覆盖它攒下来的掌握进度。
function importWords(items){
  const today = todayStr();
  let added = 0, skipped = 0;
  for(const it of items){
    const exists = Object.values(state.wordBank).find(w=>w.word.toLowerCase() === it.word.toLowerCase());
    if(exists){ skipped++; continue; }
    const id = "w_" + it.word.toLowerCase().replace(/[^a-z0-9]/g,"") + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2,5);
    state.wordBank[id] = {
      id, word: it.word, meaning: it.meaning, syllables: it.syllables,
      source: "custom", progress: 0, needsExplanation: false,
      lastPracticed: null, addedDate: today, priorityDate: null
    };
    added++;
  }
  saveState();
  return { added, skipped };
}



/* ---------------------------------------------------------------------------
   📦 从旧版《单词默写闯关》搬家

   只搬单词和掌握进度 —— 旧版的金币/奖杯不搬，新版经济完全不一样。
   两边的单词数据结构本来就一致，所以基本是直接搬。
   --------------------------------------------------------------------------- */

// 读旧版存档。同源时（两个游戏都是双击打开的本地文件）能直接读到；
// 读不到就返回 null，让家长手动粘 JSON。
function readLegacyState(){
  try{
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  }catch(e){ return null; }
}

function parseLegacyBlob(text){
  try{
    const parsed = JSON.parse((text || "").trim());
    const obj = parsed && parsed.state && parsed.state.wordBank ? parsed.state : parsed;
    if(obj && obj.wordBank && typeof obj.wordBank === "object" && !Array.isArray(obj.wordBank)) return obj;
  }catch(e){}
  return null;
}

/* 合并规则（永远只往好的方向走，绝不倒退）：
   - 新词库里没有的     → 整个搬过来，进度一起带
   - 两边都有的         → 取更高的 progress、更晚的 lastPracticed
                          needsExplanation 只要有一边是 true 就保留 true
                          （宁可让家长再讲一遍，也别让卡住的词偷偷溜回轮换） */
function migrateFromLegacy(legacy){
  if(!legacy || !legacy.wordBank || Array.isArray(legacy.wordBank)) return null;
  const entries=Object.entries(legacy.wordBank).filter(([,w])=>w && typeof w.word==="string" && w.word.trim() && typeof w.meaning==="string" && w.meaning.trim());
  if(!entries.length) return null;
  // 备份成功后才开始修改；提交失败时恢复内存，不留下半次迁移。
  const original=state,before=JSON.stringify(state),backupKey=STORAGE_KEY+"_before_legacy_import";
  try{
    if(!localStorage.getItem(backupKey)) localStorage.setItem(backupKey,before);
    state=JSON.parse(before);
    const key=word=>String(word).trim().replace(/\s+/g," ").toLowerCase();
    const letters=text=>String(text).replace(/\s+/g,"");
    const byWord=new Map(Object.values(state.wordBank).map(w=>[key(w.word),w]));
    const idMap={};let added=0,merged=0,progressKept=0;
    const today=todayStr(),oldSession=legacy.session||{};
    const touchedToday=new Set(oldSession.date===today ? [...(oldSession.sequence||[]),...(oldSession.log||[]).map(l=>l.wordId),oldSession.current?.wordId] : []);
    for(const [legacyId,lw] of entries){
      const progress=Math.min(3,Math.max(0,Math.floor(Number(lw.progress)||0)));
      let w=byWord.get(key(lw.word));
      const beforeProgress=w ? Number(w.progress)||0 : 0;
      if(w){merged++;}
      else{
        let id="legacy_"+encodeURIComponent(legacyId);
        while(state.wordBank[id]) id+="_";
        const chunks=!/\s/.test(lw.word) && Array.isArray(lw.syllables) && lw.syllables.length && lw.syllables.every(x=>typeof x==="string" && x && x===x.trim()) && letters(lw.syllables.join(""))===letters(lw.word) ? lw.syllables.slice() : [lw.word];
        w={id,word:lw.word,meaning:lw.meaning,syllables:chunks,source:lw.source==="custom"?"custom":"default",progress:0,addedDate:lw.addedDate||null,priorityDate:null};
        state.wordBank[id]=w;byWord.set(key(lw.word),w);added++;
      }
      idMap[legacyId]=w.id;if(lw.id)idMap[lw.id]=w.id;
      w.progress=Math.max(beforeProgress,progress);
      if(w.progress>beforeProgress)progressKept++;
      w.needsExplanation=!!w.needsExplanation || (!!lw.needsExplanation && w.progress<3);
      for(const field of ["lastPracticed","lastAttemptDate"]){if(typeof lw[field]==="string" && lw[field]>(w[field]||""))w[field]=lw[field];}
      if(!w.addedDate && lw.addedDate)w.addedDate=lw.addedDate;
      if(lw.priorityDate===today && !w.priorityDate)w.priorityDate=today;
      w.wrongTotal=Math.max(Number(w.wrongTotal)||0,Number(lw.wrongTotal)||0);
      w.wrongWorst=Math.max(Number(w.wrongWorst)||0,Number(lw.wrongWorst)||0);
      w.legacyId=legacyId;
      // 旧版进行中词缺少错误次数，不能因此被当成“从未错过”走快通道。
      if(progress>0 && progress<3)w.legacyPartialProgress=true;
      if(!("wrongTotal" in lw) && (lw.lastPracticed || lw.lastAttemptDate || progress || lw.needsExplanation))w.legacyErrorHistoryUnknown=true;
      if(lw.lastPracticed===today || lw.lastAttemptDate===today || touchedToday.has(legacyId) || touchedToday.has(lw.id)){
        w.firstTestDate=today;
        if(progress===0)w.taughtDate=today;
        if(progress===0 && (lw.lastAttemptDate===today || lw.needsExplanation))w.failedDate=today;
      }
      ensureWordRules(w);
    }
    const previous=state.session;
    const fresh=buildDailySession();
    const sameDay=previous && previous.date===today;
    const active=sameDay && (previous.started || previous.current || previous.log.length || previous.sequence.length);
    const available=id=>state.wordBank[id] && state.wordBank[id].progress<3 && !state.wordBank[id].needsExplanation;
    if(!active){
      if(sameDay){for(const field of [])fresh[field]=previous[field];}
      state.session=fresh;
    }else{
      const s=previous,completed=new Set([...s.sequence,...s.log.map(l=>l.wordId)]);
      s.learnQueue=s.learnQueue.filter(available);s.pendingRecheck=s.pendingRecheck.filter(p=>available(p.wordId));
      if(s.current && !available(s.current.wordId) && s.current.type!=="ltm")s.current=null;
      const protectedIds=new Set([...completed,...s.pendingRecheck.map(p=>p.wordId),s.current?.wordId]);
      s.plan=s.plan.filter(id=>protectedIds.has(id)||available(id));
      const targetSize=Math.max(CONFIG.wordsPerSession,s.totalWords);
      for(const id of fresh.plan){if(s.plan.length>=targetSize)break;if(!s.plan.includes(id)){s.plan.push(id);s.learnQueue.push(id);}}
      s.learnQueue=[...new Set(s.learnQueue)].filter(id=>!completed.has(id) && id!==s.current?.wordId && !s.pendingRecheck.some(p=>p.wordId===id));
      s.totalWords=s.plan.length;
    }
    const audits=[...(previous?.ltmQueue||[]),...(oldSession.ltmQueue||[]),...(legacy.priorityReviewQueue||[])];
    if(oldSession.current?.type==="ltm")audits.push(oldSession.current.wordId);
    state.session.ltmQueue=[...new Set(audits.map(id=>idMap[id]||id))].filter(id=>state.wordBank[id]?.progress>=3);
    const all=Object.values(state.wordBank),sourceWords=entries.map(([,w])=>w);
    const report={added,merged,progressKept,skipped:Object.keys(legacy.wordBank).length-entries.length,total:all.length,mastered:all.filter(w=>w.progress>=3).length,inProgress:all.filter(w=>w.progress<3).length,needsHelp:all.filter(w=>w.needsExplanation).length,sourceTotal:entries.length,sourceMastered:sourceWords.filter(w=>Number(w.progress)>=3).length,historyDays:(legacy.wallet?.trophies||[]).length};
    state.legacyImport={source:"单词游戏 旧版本",sourceUpdatedAt:legacy.updatedAt||null,importedAt:Date.now(),backupKey,report,idMap,session:JSON.parse(JSON.stringify(oldSession)),practiceHistory:JSON.parse(JSON.stringify(legacy.wallet?.trophies||[]))};
    state.updatedAt=Date.now();
    localStorage.setItem(STORAGE_KEY,JSON.stringify(state));
    if(window.WordGameCloudSync)window.WordGameCloudSync.saved();
    return report;
  }catch(error){state=original;throw error;}
}

/* ---------------------------------------------------------------------------
   📖 词库概况
   --------------------------------------------------------------------------- */

function bankStats(){
  const all = Object.values(state.wordBank);
  return {
    total: all.length,
    mastered: all.filter(w=>w.progress>=3).length,
    needsHelp: all.filter(w=>w.needsExplanation).length,
    available: all.filter(w=>w.progress<3 && !w.needsExplanation).length
  };
}
