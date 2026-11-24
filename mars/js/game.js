"use strict";
/* ============================================================================
   game.js —— 游戏层：氧气、星球币、晶体、农场、设施、星星评分、批量导入

   ⚠️ 红线：这一层的任何输赢，都不能影响单词的掌握进度。
      氧气耗尽 = 这一局的游戏输了，但答错的词该明天重来还是明天重来，
      该送实验室还是送实验室 —— 那是 core.js 管的事，这里绝不插手。
   ============================================================================ */

/* ---------------------------------------------------------------------------
   🫧 氧气
   --------------------------------------------------------------------------- */

function loseOxygen(){
  const s = state.session;
  s.oxygen = Math.max(0, s.oxygen - 1);
  if(s.oxygen === 0){
    // 耗尽过一次就锁死 —— 重开也救不回今天的星星
    s.starsLocked = true;
  }
  saveState();
  return s.oxygen;
}

function isOutOfOxygen(){
  return state.session.oxygen <= 0;
}

// 重新开局：只重置游戏层，教学进度一个字都不动
function restartRun(){
  const s = state.session;
  s.oxygen = oxygenCap();
  s.starsLocked = true;   // 今天已经废了，重开也是 0 星
  // 保留未完成题目和连错次数，重开不能绕过三连错门槛。
  saveState();
}

/* ---------------------------------------------------------------------------
   🏭 设施
   --------------------------------------------------------------------------- */

function facilityById(id){ return FACILITIES.find(f=>f.id===id); }
function hasFacility(id){ return state.base.facilities.includes(id); }

function facilityEffect(key, fallback){
  let v = fallback;
  for(const id of state.base.facilities){
    const f = facilityById(id);
    if(f && f.effect && f.effect[key] !== undefined) v = f.effect[key];
  }
  return v;
}

// 解锁条件尚未确定。保留已建设施，新设施暂不开放。
function canBuildFacility(f){ return false; }
function buildFacility(id){ return false; }

function claimHarvest(key){
  const reward=(state.harvestRewards || []).find(r=>r.key===key);
  if(!reward || reward.claimed) return 0;
  reward.claimed=true;state.base.coins+=reward.coins;saveState();return reward.coins;
}
function returnCurrentToQueue(){
  const s=state.session,t=s.current;
  if(t && state.wordBank[t.wordId] && !state.wordBank[t.wordId].needsExplanation && state.wordBank[t.wordId].progress<3 && !s.learnQueue.includes(t.wordId)) s.learnQueue.unshift(t.wordId);
  s.current=null;
}

/* ---------------------------------------------------------------------------
   🪙 经济
   --------------------------------------------------------------------------- */

function buyFuel(){
  const cost = CONFIG.fuelPrice * CONFIG.fuelBuyBatch;
  if(state.base.coins < cost) return false;
  state.base.coins -= cost;
  state.base.fuel += CONFIG.fuelBuyBatch;
  saveState();
  return true;
}

// 一次收获给多少星球币（高产温室会翻倍）
function coinsPerHarvest(){
  return Math.round(CONFIG.coinPerHarvest * facilityEffect("harvestMultiplier", 1));
}

/* 制氧机加成：开局多几格氧气。
   ⚠️ 氧气上限也要跟着涨，否则抱一抱补的氧气会被旧上限截掉。 */
function bonusStartOxygen(){
  if(!state || !state.base) return 0;
  return facilityEffect("bonusOxygen", 0);
}
function oxygenCap(){
  return CONFIG.oxygenMax + bonusStartOxygen();
}

function dailyFuelNeed(){
  return state.base.facilities.length * CONFIG.fuelPerFacilityPerDay;
}

/* 每天第一次打开游戏时，结算「昨晚」的自动产出。
   设施要烧燃料，燃料不够就当天不运转 —— 但绝不会损坏。 */
function runDailyPayout(){
  const b = state.base;
  const today = todayStr();
  if(b.lastDailyPayout === today) return null;
  // 第一次玩：只记下日期，不发钱（基地昨天还不存在）
  if(!b.lastDailyPayout){
    b.lastDailyPayout = today;
    saveState();
    return null;
  }

  const need = dailyFuelNeed();
  const fueled = b.fuel >= need;
  const report = { facilityIncome:0, fuelUsed:0, fueled };

  if(fueled){
    b.fuel -= need;
    report.fuelUsed = need;
    for(const id of b.facilities){
      const f = facilityById(id);
      if(f && f.effect.dailyCoins) report.facilityIncome += f.effect.dailyCoins;
    }
  }

  b.coins += report.facilityIncome;
  b.lastDailyPayout = today;
  saveState();
  return report;
}

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
   ⭐ 星星评分
   --------------------------------------------------------------------------- */

function computeScore(s){
  const oxy     = Math.max(0, s.oxygen) * CONFIG.scorePerOxygen;
  const harvest = s.log.filter(l=>l.result==="passed").length * CONFIG.scorePerHarvest;
  const perfect = Math.min(s.perfectWords.length, CONFIG.perfectCap) * CONFIG.scorePerPerfect;
  return { oxy, harvest, perfect, total: oxy + harvest + perfect };
}

function starsForSession(s){
  if(s.starsLocked) return 0;
  const t = computeScore(s).total;
  const th = CONFIG.starThresholds;
  if(t >= th[2]) return 3;
  if(t >= th[1]) return 2;
  if(t >= th[0]) return 1;
  return 0;
}

function starTierColorFor(stars){
  if(stars >= 3) return "star-gold";
  if(stars === 2) return "star-silver";
  return "star-blue";
}

// 记录今天的成绩（一天只记一次）
function recordStarHistory(stars, score){
  const b = state.base;
  const today = todayStr();
  const existing = b.starHistory.find(h=>h.date===today);
  if(existing){ existing.stars = stars; existing.score = score; }
  else b.starHistory.push({ date: today, stars, score });
  saveState();
}

// 当前连续三星天数 / 历史最高
function starStreaks(){
  const h = state.base.starHistory;
  let current = 0;
  for(let i=h.length-1;i>=0;i--){
    if(h[i].stars >= 3) current++; else break;
  }
  let best = 0, run = 0;
  for(const rec of h){
    if(rec.stars >= 3){ run++; if(run > best) best = run; }
    else run = 0;
  }
  return { current, best };
}

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
      if(sameDay){for(const field of ["oxygen","starsLocked","petVisitDone","petVisitAt"])fresh[field]=previous[field];}
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
