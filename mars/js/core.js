"use strict";
/* ============================================================================
   core.js —— 教学逻辑 + 状态存档 + 音频 + 音节拆分

   规则版本 V3：独立首测跨日计星，答错归零；教学答对即时反馈。
   ============================================================================ */

let state = null;

function todayStr(){
  const d = new Date();
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
}

/* ---------------------------------------------------------------------------
   大小写完全由家长把关。这个函数只负责让音节列表跟单词本身的大小写保持一致
   （把第一块的首字母还原成家长打的那个）—— May → M-ay
   --------------------------------------------------------------------------- */
function applyWordCasing(word, syllables){
  if(!syllables || !syllables.length) return syllables;
  if(word[0] === word[0].toLowerCase()) return syllables;
  const fixed = syllables.slice();
  fixed[0] = word[0] + fixed[0].slice(1);
  return fixed;
}

/* ---------------- 存档 ---------------- */

function defaultBase(){
  return {
    coins: 0,
    ore: 0,
    fuel: 20,
    facilities: [],
    ownedAvatars: [DEFAULT_AVATAR],
    currentAvatar: DEFAULT_AVATAR,
    starHistory: [],
    lastDailyPayout: null
  };
}

function loadState(){
  let raw = null, originalRaw = null;
  try{ originalRaw=localStorage.getItem(STORAGE_KEY); raw=JSON.parse(originalRaw); }catch(e){}
  if(!raw || !raw.wordBank) raw = { wordBank:{}, session:null };
  for(const [word, meaning, syllables] of DEFAULT_WORDS){
    if(!raw.wordBank[word]){
      raw.wordBank[word] = {
        id:word, word, meaning, syllables,
        source:"default", progress:0, needsExplanation:false,
        lastPracticed:null, addedDate:null, priorityDate:null
      };
    }
  }
  state = raw;
  ensureBase();
  migrateRulesV3(originalRaw);
  for(const w of Object.values(state.wordBank)) ensureWordRules(w);
  if(!Array.isArray(state.harvestRewards)) state.harvestRewards=[];
}

function saveState(){
  try{
    state.updatedAt=Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if(typeof CloudSync!=="undefined")CloudSync.saved();
  }
  catch(e){ console.error("存档失败：", e); }
}

// 自愈：老存档缺字段时补齐默认值，永远不因为存档格式而白屏
function ensureBase(){
  if(!state.base || typeof state.base !== "object") state.base = defaultBase();
  const d = defaultBase();
  for(const k of Object.keys(d)){
    if(state.base[k] === undefined || state.base[k] === null) state.base[k] = d[k];
  }
  if(!Array.isArray(state.base.facilities)) state.base.facilities = [];
  if(!Array.isArray(state.base.ownedAvatars) || !state.base.ownedAvatars.length) state.base.ownedAvatars = [DEFAULT_AVATAR];
  if(!Array.isArray(state.base.starHistory)) state.base.starHistory = [];
  for(const k of ["coins","ore","fuel"]){
    if(typeof state.base[k] !== "number" || isNaN(state.base[k])) state.base[k] = d[k];
  }
  if(!state.base.currentAvatar) state.base.currentAvatar = DEFAULT_AVATAR;
}

/* ---------------- 朗读 ---------------- */
function speak(text){
  if(!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "en-US"; u.rate = 0.85;
  window.speechSynthesis.speak(u);
}

/* ---------------- 音效（合成，不用音频文件） ---------------- */
let audioCtx = null;
function getAudioCtx(){
  if(!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if(audioCtx.state === "suspended") audioCtx.resume();
  return audioCtx;
}
function playTone(freq, startTime, duration, type, gainPeak){
  const ctx = getAudioCtx();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(gainPeak, startTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
  osc.connect(gain).connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.05);
}
function playCorrectSound(){
  const now = getAudioCtx().currentTime;
  playTone(523.25, now, 0.12, "triangle", 0.22);
  playTone(659.25, now + 0.09, 0.12, "triangle", 0.22);
  playTone(783.99, now + 0.18, 0.2, "triangle", 0.26);
}
function playWrongSound(){
  // 温和，不刺耳——不是惩罚性的蜂鸣
  const now = getAudioCtx().currentTime;
  playTone(330, now, 0.16, "sine", 0.15);
  playTone(262, now + 0.13, 0.24, "sine", 0.13);
}
// 氧气漏气：下滑的嘶声，越少越低
function playOxygenLeak(remaining){
  const ctx = getAudioCtx();
  const now = ctx.currentTime;
  const base = 520 + remaining * 40;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(base, now);
  osc.frequency.exponentialRampToValueAtTime(base * 0.45, now + 0.45);
  gain.gain.setValueAtTime(0.001, now);
  gain.gain.linearRampToValueAtTime(0.12, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
  osc.connect(gain).connect(ctx.destination);
  osc.start(now); osc.stop(now + 0.55);
}
function playAlarmSound(){
  const now = getAudioCtx().currentTime;
  for(let i=0;i<3;i++) playTone(880, now + i*0.18, 0.1, "square", 0.14);
}
// 稀有晶体还悬着：两下紧张的短促提示，不是惩罚音
function playStakeAlert(){
  const now = getAudioCtx().currentTime;
  playTone(1320, now, 0.07, "square", 0.13);
  playTone(1320, now + 0.14, 0.07, "square", 0.13);
}
// 稀有晶体就在这一下碎了：下坠 + 一记闷响
function playRareLost(){
  const now = getAudioCtx().currentTime;
  [1568, 1175, 880, 622].forEach((f,i)=> playTone(f, now + i*0.07, 0.22, "square", 0.16));
  playTone(160, now + 0.3, 0.55, "sawtooth", 0.15);
}
function playGameOverSound(){
  const now = getAudioCtx().currentTime;
  [523.25, 440, 349.23, 261.63].forEach((f,i)=> playTone(f, now + i*0.16, 0.35, "sawtooth", 0.18));
}
function playStarDing(index){
  const now = getAudioCtx().currentTime;
  const freq = [880, 1046.5, 1318.5][index] || 1318.5;
  playTone(freq, now, 0.35, "triangle", 0.26);
  playTone(freq * 2, now + 0.02, 0.25, "triangle", 0.12);
}
function playCoinJingle(count){
  const now = getAudioCtx().currentTime;
  for(let i=0;i<count;i++){
    const t = now + i * 0.08;
    const freq = 1100 + Math.random() * 500;
    playTone(freq, t, 0.14, "square", 0.11);
    playTone(freq * 1.5, t + 0.02, 0.1, "square", 0.06);
  }
}
function playSparkleSound(){
  const now = getAudioCtx().currentTime;
  playTone(1760, now, 0.3, "triangle", 0.18);
  playTone(2637, now + 0.03, 0.35, "triangle", 0.14);
}
// 晶体成型：低频升起 + 高频叮，比金币隆重得多
function playOreForm(){
  const now = getAudioCtx().currentTime;
  [261.63, 392, 523.25, 659.25, 783.99].forEach((f,i)=> playTone(f, now + i*0.12, 0.5, "triangle", 0.2));
  playTone(2093, now + 0.62, 0.6, "sine", 0.16);
}
function playOreLock(){
  const now = getAudioCtx().currentTime;
  playTone(1568, now, 0.5, "triangle", 0.24);
  playTone(2093, now + 0.06, 0.6, "sine", 0.18);
  playTone(3136, now + 0.12, 0.5, "sine", 0.1);
}
function playSproutSound(){
  const now = getAudioCtx().currentTime;
  playTone(660, now, 0.1, "sine", 0.12);
  playTone(990, now + 0.07, 0.14, "sine", 0.1);
}

/* ============================================================================
   🌬️ 环境音 —— 氛围里最被低估的一半

   全部是合成的，不加载任何音频文件：
     风  = 白噪声过一个缓慢起伏的低通滤波器
     鸟叫 = 几个随机音高的短促正弦，间隔随机
   夜里风更低沉、鸟换成虫鸣。
   ============================================================================ */
let ambience = null;
function startAmbience(){
  if(ambience) return;
  const ctx = getAudioCtx();
  // —— 风：白噪声 ——
  const len = ctx.sampleRate * 3;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for(let i=0;i<len;i++) d[i] = Math.random()*2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf; src.loop = true;
  const filt = ctx.createBiquadFilter();
  filt.type = "lowpass"; filt.frequency.value = 420; filt.Q.value = 0.6;
  const gain = ctx.createGain(); gain.gain.value = 0.028;
  // 风的强弱慢慢起伏，不然是一条死噪声
  const lfo = ctx.createOscillator(), lfoGain = ctx.createGain();
  lfo.frequency.value = 0.07; lfoGain.gain.value = 0.016;
  lfo.connect(lfoGain).connect(gain.gain);
  src.connect(filt).connect(gain).connect(ctx.destination);
  src.start(); lfo.start();
  ambience = { src, filt, gain, lfo, birdTimer:null, night:false };
  scheduleBird();
}
function scheduleBird(){
  if(!ambience) return;
  const wait = 4000 + Math.random()*11000;
  ambience.birdTimer = setTimeout(() => {
    try{ ambience.night ? playCricket() : playAmbientBird(); }catch(e){}
    scheduleBird();
  }, wait);
}
function playAmbientBird(){
  const now = getAudioCtx().currentTime;
  const base = 1500 + Math.random()*900;
  const n = 2 + Math.floor(Math.random()*3);
  for(let i=0;i<n;i++)
    playTone(base * (1 + Math.random()*0.35), now + i*0.11, 0.09, "sine", 0.035);
}
function playCricket(){
  const now = getAudioCtx().currentTime;
  for(let i=0;i<5;i++) playTone(2600, now + i*0.055, 0.03, "triangle", 0.016);
}
// 夜里风更低沉，鸟换成虫鸣
function setAmbienceNight(isNight){
  if(!ambience) return;
  ambience.night = !!isNight;
  ambience.filt.frequency.value = isNight ? 260 : 420;
  ambience.gain.gain.value = isNight ? 0.020 : 0.028;
}
function stopAmbience(){
  if(!ambience) return;
  clearTimeout(ambience.birdTimer);
  try{ ambience.src.stop(); ambience.lfo.stop(); }catch(e){}
  ambience = null;
}

/* ============================================================================
   自动拆音节（启发式，不是词典）
   按元音组边界切，让游戏能给出合理的教学块，不用家长手打连字符。
   ============================================================================ */

// 拼成一个音的双辅音，绝不能从中间切开（tea-cher，不是 teac-her）
const CONSONANT_DIGRAPHS = new Set(["ch","sh","th","ph","wh","ck","ng","qu"]);

function consonantUnits(cluster){
  const units = [];
  let i = 0;
  while(i < cluster.length){
    const pair = cluster.slice(i, i+2);
    if(CONSONANT_DIGRAPHS.has(pair)){ units.push(pair); i += 2; }
    else { units.push(cluster[i]); i += 1; }
  }
  return units;
}

// 只收够短够常见、光看拼写就能可靠判断的后缀。
// 故意不含 -er/-ed/-ly/-est —— 太多普通词碰巧这么结尾却不是「词根+后缀」
// （under、water、bread、winter），剥了会错得比对得多。
const COMMON_SUFFIXES = ["ing"];
function stripKnownSuffix(word){
  for(const suf of COMMON_SUFFIXES){
    if(word.length > suf.length + 1 && word.endsWith(suf)){
      const base = word.slice(0, word.length - suf.length);
      if(/[aeiouy]/.test(base)) return { base, suffix: suf };
    }
  }
  return null;
}

function splitWordCore(word, allowSingleGroupSplit){
  const isVowel = (ch, idx) => "aeiou".includes(ch) || (ch === "y" && idx > 0);
  const groups = [];
  let i = 0;
  while(i < word.length){
    if(isVowel(word[i], i)){
      let j = i;
      while(j < word.length && isVowel(word[j], j)) j++;
      groups.push([i, j]);
      i = j;
    }else i++;
  }
  if(groups.length === 0) return [word];
  // 结尾的不发音 e（cake、grape、hope）不该单独成块，
  // 除非去掉它就没得切了（apple → 只剩 a）
  const last = groups[groups.length - 1];
  const wouldCollapseToUnsplittable = groups.length === 2 && groups[0][0] === 0;
  if(groups.length > 1 && last[0] === word.length - 1 && word[last[0]] === "e" && !wouldCollapseToUnsplittable){
    groups.pop();
  }
  if(groups.length <= 1){
    // 单元音组的词（friend、spring、skip）按「辅音开头 + 韵脚」切，
    // 这正是自然拼读法教单音节词的标准拆法：fr-iend、spr-ing、sk-ip
    if(!allowSingleGroupSplit) return [word];
    const vs = groups[0][0];
    if(vs === 0) return [word];
    return [word.slice(0, vs), word.slice(vs)];
  }
  const chunks = [];
  let cursor = 0;
  for(let g = 0; g < groups.length - 1; g++){
    const thisEnd = groups[g][1];
    const nextStart = groups[g + 1][0];
    const units = consonantUnits(word.slice(thisEnd, nextStart));
    // 单个辅音（或一个整体的双辅音）跟着后一块走（ba-na-na、tea-cher）；
    // 超过一个单元就大致从中间切，但只在单元边界上切，绝不切进双辅音里面
    let splitAt = thisEnd;
    if(units.length > 1){
      const half = Math.floor(units.length / 2);
      for(let u = 0; u < half; u++) splitAt += units[u].length;
    }
    // "ck" 标记的是它前面那个音节的结尾（rock-et、chick-en），
    // 跟 ch/sh/th/ph/wh/ng/qu 开启后一个音节的行为相反
    if(units[units.length - 1] === "ck") splitAt = nextStart;
    chunks.push(word.slice(cursor, splitAt));
    cursor = splitAt;
  }
  chunks.push(word.slice(cursor));
  return chunks;
}

function autoSplitSyllables(rawWord){
  const word = (rawWord || "").toLowerCase().trim();
  if(!word) return [];
  // 词组（get up、look after）不拆音节 —— 按空格拆会切出「get-」和「 up」
  // 这种带空格的碎块，孩子得输入一个前导空格才算对，纯属坑人。
  // 词组直接整条默写，教学上也更合理。
  if(/\s/.test(word)) return [word];
  const suffixSplit = stripKnownSuffix(word);
  if(suffixSplit) return [...splitWordCore(suffixSplit.base, false), suffixSplit.suffix];
  return splitWordCore(word, true);
}

/* V3：跨练习日首测计星；教学与当天复查只做巩固。 */
function ensureWordRules(w){
  w.progress=Math.min(3,Math.max(0,Number(w.progress)||0));
  if(!w.errorSignatures || typeof w.errorSignatures!=="object") w.errorSignatures={};
  if(!Array.isArray(w.errorHistory)) w.errorHistory=[];
  w.repeatedError=!!w.repeatedError;w.oreAwarded=!!w.oreAwarded;
  w.harvestCycle=Number(w.harvestCycle)||0;
  return w;
}
function migrateRulesV3(originalRaw){
  if(state.rulesVersion===3) return;
  if(originalRaw){try{if(!localStorage.getItem(STORAGE_KEY+"_before_v3")) localStorage.setItem(STORAGE_KEY+"_before_v3",originalRaw);}catch(e){console.error("升级备份失败",e);}}
  const old=state.session, audits=old?(old.ltmQueue||[]).slice():[];
  if(old && old.current && old.current.type==="ltm") audits.unshift(old.current.wordId);
  for(const w of Object.values(state.wordBank)){
    ensureWordRules(w);
    if(w.wrongTotal && !w.errorHistory.length) w.legacyWrongCount=w.wrongTotal;
    // 原版没有具体错法明细，保留累计值，不猜测过去的错字。
    if(old && old.date===todayStr()){
      if((old.log||[]).some(l=>l.wordId===w.id) || (old.current && old.current.wordId===w.id)){
        w.firstTestDate=todayStr();w.taughtDate=todayStr();
        if(w.needsExplanation || (old.current && old.current.wordId===w.id && old.current.hadMistake)) w.failedDate=todayStr();
      }
    }
  }
  state.base.legacyRewards=state.base.legacyRewards||{crystals:state.base.crystals||0,rareCrystals:state.base.rareCrystals||0};
  delete state.base.crystals;delete state.base.rareCrystals;
  state.rulesVersion=3;state.harvestRewards=[];state.session=buildDailySession();
  state.session.ltmQueue=[...new Set(audits)].filter(id=>state.wordBank[id] && state.wordBank[id].progress>=3);
  saveState();
}
function buildDailySession(){
  const today=todayStr(),words=Object.values(state.wordBank).filter(w=>w.progress<3 && !w.needsExplanation);
  words.sort((a,b)=>Number(!!b.lastPracticed)-Number(!!a.lastPracticed)
    || Number(b.priorityDate===today)-Number(a.priorityDate===today)
    || (a.lastPracticed||"").localeCompare(b.lastPracticed||""));
  const ids=words.slice(0,CONFIG.wordsPerSession).map(w=>w.id);
  return {date:today,started:false,plan:ids.slice(),learnQueue:ids.slice(),pendingRecheck:[],ltmQueue:[],sequence:[],doneCount:0,totalWords:ids.length,current:null,log:[],oxygen:oxygenCap(),starsLocked:false,perfectWords:[],summarized:false,
    petVisitAt:CONFIG.petVisitAfterMin+Math.floor(Math.random()*(CONFIG.petVisitAfterMax-CONFIG.petVisitAfterMin+1)),petVisitDone:false};
}
function ensureTodaySession(){
  if(!Array.isArray(state.harvestRewards)) state.harvestRewards=[];
  if(!state.session || state.session.date!==todayStr()){
    const previous=state.session,audits=previous?(previous.ltmQueue||[]).slice():[];
    if(previous && previous.current && previous.current.type==="ltm") audits.unshift(previous.current.wordId);
    state.session=buildDailySession();
    state.session.ltmQueue=[...new Set(audits)].filter(id=>state.wordBank[id] && state.wordBank[id].progress>=3);
    saveState();
  }
}
function taskForWord(id){
  const w=ensureWordRules(state.wordBank[id]),today=todayStr();
  const type=w.failedDate===today || w.taughtDate===today?"learn":w.firstTestDate===today?"practice":"test";
  return {wordId:id,type};
}
function borrowExtraWord(s){
  const touched=new Set([...s.plan,...s.sequence,...s.ltmQueue]);
  return Object.values(state.wordBank).find(w=>!touched.has(w.id) && w.progress<3 && !w.needsExplanation && w.firstTestDate!==todayStr())||null;
}
function pickNextTask(s){
  s.pendingRecheck=s.pendingRecheck.filter(p=>state.wordBank[p.wordId] && !state.wordBank[p.wordId].needsExplanation);
  const i=s.pendingRecheck.findIndex(p=>s.sequence.length-p.registeredAt>=CONFIG.recheckGap);
  if(i>=0) return {wordId:s.pendingRecheck.splice(i,1)[0].wordId,type:"recheck"};
  while(s.ltmQueue.length){const id=s.ltmQueue.shift();if(state.wordBank[id] && state.wordBank[id].progress>=3) return {wordId:id,type:"ltm"};}
  while(s.learnQueue.length){const id=s.learnQueue.shift(),w=state.wordBank[id];if(w && w.progress<3 && !w.needsExplanation) return taskForWord(id);}
  if(s.pendingRecheck.length){
    const borrowed=borrowExtraWord(s);
    if(borrowed){s.plan.push(borrowed.id);s.totalWords++;return taskForWord(borrowed.id);}
    return {wordId:s.pendingRecheck.shift().wordId,type:"recheck"};
  }
  return null;
}
function totalRoundsFor(t){const w=state.wordBank[t.wordId];return t.type==="learn" && w.syllables && w.syllables.length>1?w.syllables.length+1:1;}
function isPartialRound(t){const syll=state.wordBank[t.wordId].syllables||[];return t.type==="learn" && syll.length>1 && t.roundIndex<syll.length;}
function expectedAnswerFor(t){const w=state.wordBank[t.wordId];return isPartialRound(t)?w.syllables[t.roundIndex]:w.word;}
function expectedOffsetFor(t){const w=state.wordBank[t.wordId];return isPartialRound(t)?w.syllables.slice(0,t.roundIndex).join("").length:0;}
function roundLabelFor(t){
  const labels={test:"独立整词首测",practice:"整词巩固练习",recheck:"隔词练习复查",ltm:"长时记忆抽查"};
  return labels[t.type] || (isPartialRound(t)?`分段练习 ${t.roundIndex+1}/${state.wordBank[t.wordId].syllables.length}`:"整词教学练习");
}
function tileGroupsFor(t,all){const w=state.wordBank[t.wordId],syll=w.syllables && w.syllables.length?w.syllables:[w.word];return syll.map((chunk,i)=>({chunk,hidden:!!all || !isPartialRound(t) || i===t.roundIndex}));}
// 编辑距离对齐，让分段和整词的相同位置使用相同错误记录。
function spellingErrors(expected,answer,offset){
  const a=[...expected],b=[...answer],dp=Array.from({length:a.length+1},()=>Array(b.length+1).fill(0));
  for(let i=0;i<=a.length;i++) dp[i][0]=i;
  for(let j=0;j<=b.length;j++) dp[0][j]=j;
  for(let i=1;i<=a.length;i++) for(let j=1;j<=b.length;j++) dp[i][j]=Math.min(dp[i-1][j]+1,dp[i][j-1]+1,dp[i-1][j-1]+(a[i-1]===b[j-1]?0:1));
  let i=a.length,j=b.length;const edits=[];
  while(i || j){
    if(i && j && dp[i][j]===dp[i-1][j-1]+(a[i-1]===b[j-1]?0:1)){if(a[i-1]!==b[j-1]) edits.push(["replace",offset+i-1,a[i-1],b[j-1]]);i--;j--;}
    else if(i && dp[i][j]===dp[i-1][j]+1){edits.push(["missing",offset+i-1,a[i-1],""]);i--;}
    else {edits.push(["extra",offset+i,"",b[j-1]]);j--;}
  }
  return [...new Set(edits.map(e=>JSON.stringify(e)))];
}
function recordWrong(id,streak,answer,expected,offset){
  const w=ensureWordRules(state.wordBank[id]),was=w.repeatedError;
  const signatures=spellingErrors(expected==null?w.word:expected,String(answer==null?"":answer),offset||0);
  for(const key of signatures){if(w.errorSignatures[key]) w.repeatedError=true;w.errorSignatures[key]=(w.errorSignatures[key]||0)+1;}
  w.errorHistory.push({date:todayStr(),answer:String(answer||""),expected:expected||w.word,offset:offset||0,signatures});
  w.wrongTotal=(w.wrongTotal||0)+1;w.wrongWorst=Math.max(w.wrongWorst||0,streak);
  w.progress=0;w.failedDate=todayStr();w.firstTestDate=todayStr();w.lastPracticed=todayStr();saveState();
  return !was && w.repeatedError?"lost":w.repeatedError?"gone":"alive";
}
function isInnatelyKnown(w){return !(w.wrongTotal||0) && !w.legacyPartialProgress && !w.legacyErrorHistoryUnknown;}
function oreEligible(w){return !!w && (w.wrongTotal||0)>0 && !w.repeatedError && !w.oreAwarded;}
function addSessionResult(id,result){
  const s=state.session;s.sequence.push(id);
  if(!s.log.some(l=>l.wordId===id && ["passed","practiced","needsExplanation"].includes(l.result)) && ["passed","practiced","needsExplanation"].includes(result)) s.doneCount++;
  s.log.push({wordId:id,result});
}
function completeFirstTestPass(id){
  const w=ensureWordRules(state.wordBank[id]),today=todayStr();
  if(w.firstTestDate===today || w.failedDate===today || w.taughtDate===today || w.progress>=3) return {grew:false,ore:false};
  const before=w.progress;w.firstTestDate=today;w.lastPracticed=today;
  w.progress=before===1 && isInnatelyKnown(w)?3:Math.min(3,before+1);
  addSessionResult(id,"passed");if(!state.session.perfectWords.includes(id)) state.session.perfectWords.push(id);
  let ore=false;
  if(w.progress===3){
    w.harvestCycle++;state.harvestRewards.push({key:id+":"+w.harvestCycle,wordId:id,coins:coinsPerHarvest(),claimed:false});
    if(oreEligible(w)){w.oreAwarded=true;state.base.ore++;ore=true;}
  }
  saveState();return {grew:true,ore,progress:w.progress};
}
function completeLearnPass(id){
  const w=ensureWordRules(state.wordBank[id]),s=state.session;w.taughtDate=todayStr();w.lastPracticed=todayStr();
  if(!s.pendingRecheck.some(p=>p.wordId===id)){s.sequence.push(id);s.pendingRecheck.push({wordId:id,registeredAt:s.sequence.length});s.log.push({wordId:id,result:"learned"});}
}
function completeLearnFail(id){const w=state.wordBank[id];w.needsExplanation=true;w.progress=0;w.failedDate=todayStr();state.session.pendingRecheck=state.session.pendingRecheck.filter(p=>p.wordId!==id);addSessionResult(id,"needsExplanation");}
function completeRecheckPass(id){state.wordBank[id].lastPracticed=todayStr();addSessionResult(id,"practiced");}
function completeRecheckFail(id){completeLearnFail(id);}
function completeLtmPass(id){state.wordBank[id].lastPracticed=todayStr();addSessionResult(id,"ltmPass");}
function completeLtmFail(id){const w=state.wordBank[id];w.progress=0;w.failedDate=todayStr();w.lastPracticed=todayStr();if(!state.session.plan.includes(id)){state.session.plan.push(id);state.session.totalWords++;}addSessionResult(id,"ltmFail");}
function pendingHarvest(){return (state.harvestRewards||[]).find(r=>!r.claimed)||null;}
function claimHarvest(key){
  const reward=(state.harvestRewards||[]).find(r=>r.key===key);
  if(!reward || reward.claimed) return 0;
  reward.claimed=true;state.base.coins+=reward.coins;saveState();return reward.coins;
}
function extendSession(count){
  const s=state.session,touched=new Set([...s.plan,...s.sequence]),words=Object.values(state.wordBank).filter(w=>w.progress<3 && !w.needsExplanation && !touched.has(w.id) && w.firstTestDate!==todayStr());
  words.sort((a,b)=>Number(!!b.lastPracticed)-Number(!!a.lastPracticed));const ids=words.slice(0,count).map(w=>w.id);
  if(!ids.length) return false;s.learnQueue.push(...ids);s.plan.push(...ids);s.totalWords+=ids.length;saveState();return true;
}
