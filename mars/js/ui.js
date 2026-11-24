"use strict";
/* ============================================================================
   ui.js —— 渲染、事件、流程串联
   ============================================================================ */

const el = {};
["app", "planetName", "statsBar", "doneCountLabel", "totalCountLabel", "pendingCountLabel", "oxygenRow", "oxygenLabel", "oxygenText", "oxygenTank", "coinCountLabel", "headerBtns", "pauseBtn", "gearBtn", "lowBankBanner", "layout", "stage", "world3d", "gradeLayer", "viewBtns", "journalBtn", "centerArea", "roundLabel", "meaningBadge", "tileRow", "inputRow", "answerInput", "replayBtn", "submitBtn", "hintText", "coinBurstZone", "starToastEl", "miniCheckEl", "growthBanner", "startScreen", "todayWordList", "startBtn", "summaryScreen", "summaryBody", "closeSummaryBtn", "doneScreen", "extendBtn", "gameOverOverlay", "gameOverStats", "restartRunBtn", "askParentOxygenBtn", "oxygenAlertHalo", "confettiCanvas", "sidebar", "closeJournalBtn", "errorEmpty", "errorList", "bankSummary", "parentOverlay", "closeParentBtn", "familySyncStatus", "familyCodeInput", "connectFamilyBtn", "syncNowBtn", "parentOxygenSection", "parentOxygenBtn", "legacyStatus", "legacyScanBtn", "legacyManualBtn", "exportProgressBtn", "legacyManualBox", "legacyText", "legacyImportBtn", "importText", "previewImportBtn", "importPreview", "customRows", "addRowBtn", "addCustomBtn", "wordTable", "wordTableBody", "ltmEmpty", "ltmList", "resetTodayBtn", "resetAllBtn"].forEach(id => { el[id] = document.getElementById(id); });

function setAnswerDisabled(disabled){
  el.answerInput.disabled=disabled;
  document.getElementById("replayBtn").disabled=disabled;
  const button=document.getElementById("submitBtn");
  button.disabled=disabled && !awaitingHarvest;
  button.textContent=awaitingHarvest?"收获":"提交 ↵";
}

/* ============================================================================
   计时
   ============================================================================ */
let timerHandle=null,timerStartedAt=null,timerTask=null,lastTimerSave=0;
function checkpointOxygen(){
  if(timerStartedAt===null || !timerTask || state?.session?.current!==timerTask)return;
  const now=Date.now();
  timerTask.oxygenRemainingMs=Math.max(0,timerTask.oxygenRemainingMs-Math.max(0,now-timerStartedAt));
  timerTask.oxygenDraft=el.answerInput.value;
  timerStartedAt=now;
}
function clearTimer(){
  checkpointOxygen();
  if(timerHandle!==null)clearInterval(timerHandle);
  timerHandle=null;timerStartedAt=null;timerTask=null;
}
function startTimer(){
  clearTimer();
  const t=ensureQuestionOxygen(state.session.current);
  if(!t || isOutOfOxygen()){if(t)handleTimeout();return;}
  timerTask=t;timerStartedAt=Date.now();lastTimerSave=Date.now();
  timerHandle=setInterval(()=>{
    if(state.session.current!==t){clearTimer();return;}
    checkpointOxygen();renderOxygen();
    if(t.oxygenRemainingMs<=0){clearTimer();handleTimeout();return;}
    if(Date.now()-lastTimerSave>=5000){lastTimerSave=Date.now();saveState();}
  },100);
}
window.WordGameOxygenClock={checkpoint:checkpointOxygen};
let questionAudioId=0,questionAudioPending=false;
function playQuestionAudio(){
  clearTimer();
  const task=state.session.current,stamp=++questionAudioId;
  questionAudioPending=true;
  const ready=()=>{
    if(stamp!==questionAudioId)return;
    questionAudioPending=false;
    if(state.session.current!==task || isPaused || el.answerInput.disabled || document.hidden || el.parentOverlay.classList.contains("show"))return;
    startTimer();
  };
  try{speak(state.wordBank[task.wordId].word,ready);}catch(e){ready();}
}
let isPaused=false,pausedLabelBackup="",pausedHintBackup="",autoPaused=false;
function pauseGame(){
  if(isPaused || !state.session?.current || el.answerInput.disabled)return;
  clearTimer();isPaused=true;setAnswerDisabled(true);
  el.pauseBtn.textContent="▶";el.pauseBtn.title="继续计时";
  pausedLabelBackup=el.roundLabel.textContent;pausedHintBackup=el.hintText.textContent;
  el.roundLabel.textContent="⏸ 已暂停";el.hintText.textContent="点右上角 ▶ 继续，氧气已停表";
  renderOxygen();saveState();
}
function resumeGame(){
  if(!isPaused)return;
  if(isOutOfOxygen()){showGameOver();return;}
  isPaused=false;el.pauseBtn.textContent="Ⅱ";el.pauseBtn.title="暂停计时";
  el.roundLabel.textContent=pausedLabelBackup;el.hintText.textContent=pausedHintBackup;
  setAnswerDisabled(false);el.answerInput.focus();if(!questionAudioPending)startTimer();
}
el.pauseBtn.addEventListener("click",()=>{isPaused?resumeGame():pauseGame();});
function pauseForModal(){
  if(isPaused || !state.session?.current || el.answerInput.disabled)return;
  autoPaused=true;pauseGame();
}
function resumeFromModal(){
  if(!autoPaused)return;
  autoPaused=false;
  if(isPaused && !document.hidden)resumeGame();
}
function pauseForBackground(){
  autoPaused=false;pauseGame();
}
document.addEventListener("visibilitychange",()=>{if(document.hidden)pauseForBackground();});
if(typeof window.addEventListener==="function"){
  window.addEventListener("blur",pauseForBackground);
  window.addEventListener("pagehide",()=>{pauseForBackground();saveState();});
}

/* ============================================================================
   顶部状态 / 氧气 / 农场缩略带
   ============================================================================ */

function refreshHeaderStats(){
  const s = state.session;
  el.doneCountLabel.textContent = s ? s.doneCount : 0;
  el.totalCountLabel.textContent = s ? s.totalWords : 0;
  el.pendingCountLabel.textContent = s ? s.pendingRecheck.length : 0;
  el.lowBankBanner.style.display = (s && s.totalWords < CONFIG.lowBankWarnAt) ? "block" : "none";
  el.coinCountLabel.textContent = state.base.coins;
}

function renderOxygen(){
  const t=ensureQuestionOxygen(state.session?.current);
  const left=t?t.oxygenRemainingMs:0,ratio=t?left/t.oxygenDurationMs:1;
  el.oxygenText.textContent=t?Math.ceil(left/1000)+"秒":"待答题";
  el.oxygenTank.style.setProperty("--oxygen-left",(ratio*100)+"%");
  el.oxygenRow.classList.toggle("low",!!t && left>0 && left<=CONFIG.oxygenLowSeconds*1000);
  el.oxygenRow.classList.toggle("empty",!!t && left<=0);
  el.oxygenTank.setAttribute("role","progressbar");
  el.oxygenTank.setAttribute("aria-label","本题剩余氧气时间");
  el.oxygenTank.setAttribute("aria-valuemin","0");
  el.oxygenTank.setAttribute("aria-valuemax",t?Math.ceil(t.oxygenDurationMs/1000):0);
  el.oxygenTank.setAttribute("aria-valuenow",Math.ceil(left/1000));
}

/* 田地只读取单词星级。动画仅作用于刚刚答对的那个词。 */
function renderFarmStrip(anim){
  if(!World.isReady()) return;
  const s=state.session;
  const statuses=s.plan.map(id=>plotStatusFor(id));
  const growId=anim && (anim.grow!=null?anim.grow:anim.sprout);
  const growIdx=growId!=null?s.plan.indexOf(growId):-1;
  if(World.setWords)World.setWords(s.plan.map(id=>({meaning:state.wordBank[id]?.meaning||""})));
  World.syncPlots(statuses,{animatedIndex:growIdx});
  if(growIdx>=0)World.grow(growIdx,statuses[growIdx]);
  const curId=s.current?s.current.wordId:null;
  World.focusPlot(curId!=null?s.plan.indexOf(curId):-1,s.plan.length);
  if(World.forceRender)World.forceRender();
}

/* 🎨 时段：3D 光照 + 画面色调 + 环境音，三样一起切。
   氛围不是单一手段做出来的，是这三层叠出来的。 */
function applyTimeOfDay(key){
  World.setTime(key);
  el.stage.className = el.stage.className.replace(/\bt-\w+\b/g, "").trim();
  el.stage.classList.add("t-" + key);
  try{ setAmbienceNight(key === "night"); }catch(e){}
}

/* 视角按钮 */
if(el.viewBtns){
  el.viewBtns.addEventListener("click", e => {
    const v = e.target.dataset.view;
    if(v) World.setView(v);
  });
}

function pulse(node){
  node.classList.remove("pulse");
  void node.offsetWidth;
  node.classList.add("pulse");
}

/* ============================================================================
   题目渲染
   ============================================================================ */

function renderTiles(groups, revealAll, wrongSet){
  el.tileRow.innerHTML = "";
  let charIndex = 0;
  groups.forEach(g=>{
    const gEl = document.createElement("div");
    gEl.className = "tile-group";
    for(const ch of g.chunk){
      const t = document.createElement("div");
      const isHidden = !revealAll && g.hidden;
      const isWrong = revealAll && wrongSet && wrongSet.has(charIndex);
      t.className = "tile " + (isWrong ? "revealWrong" : revealAll ? "reveal" : (isHidden ? "blank" : "filled"));
      t.textContent = isHidden ? "" : ch;
      gEl.appendChild(t);
      charIndex++;
    }
    el.tileRow.appendChild(gEl);
  });
}

function hideAllOverlays(){
  el.startScreen.style.display = "none";
  el.summaryScreen.style.display = "none";
  el.doneScreen.style.display = "none";

  el.gameOverOverlay.style.display = "none";
  el.stage.classList.remove("oxygenEmpty");
  if(isPaused){
    isPaused = false;
    el.pauseBtn.textContent = "⏸";
    el.pauseBtn.title = "暂停计时";
  }
  el.pauseBtn.disabled = true;
}

function renderRound(fromCloud=false){
  const s = state.session;
  const task = s.current;
  const word = state.wordBank[task.wordId];
  if(!word){
    // 这个任务指向的词已经不在词库里了 —— 别为一个坏词把整页搞崩，跳过就是
    console.warn("跳过一个找不到的单词任务：", task);
    s.current = null;
    saveState();
    const next = pickNextTask(s);
    if(next) startTask(next); else finishOrRest();
    return;
  }
  const partial = isPartialRound(task);
  hideAllOverlays();
  el.roundLabel.textContent = roundLabelFor(task);
  el.meaningBadge.textContent = word.meaning;
  renderTiles(tileGroupsFor(task, false), false);
  setAnswerDisabled(false);
  const oxygen=ensureQuestionOxygen(task);
  el.answerInput.value=oxygen.oxygenDraft||"";
  el.answerInput.placeholder = partial ? "输入缺少的字母" : "输入完整单词";
  el.hintText.textContent = partial
    ? "✏️ 只输入缺少的字母（注意大小写）　|　Enter 提交　|　留空 Enter 重听"
    : "✏️ 这一关请输入完整单词（注意大小写）　|　Enter 提交　|　留空 Enter 重听";
  el.answerInput.focus();
  el.pauseBtn.disabled = false;
  refreshHeaderStats();
  renderOxygen();
  renderFarmStrip();
  if(isOutOfOxygen()){showGameOver();return;}
  if(fromCloud || document.hidden || el.parentOverlay.classList.contains("show")){pauseGame();}
  else{playQuestionAudio();}
}

function startTask(task){
  task.roundIndex = 0;
  task.wrongStreak = 0;
  // 这一遍有没有出过错（任何一轮）—— 用来判断能不能走「零失误直达掌握」
  task.hadMistake = false;
  state.session.current = task;
  saveState();
  renderRound();
}

function goNextOrFinish(){
  const reward=pendingHarvest();
  if(reward){ armHarvest(reward.wordId); return; }
  state.session.current = null;
  saveState();
  renderSidebar();
  renderFarmStrip();
  const next = pickNextTask(state.session);
  if(next) startTask(next);
  else finishOrRest();
}

/* ============================================================================
   答题判定
   ============================================================================ */

function revealFullWord(wrongVal, callback, snapshot){
  const task = snapshot || state.session.current;
  const word = state.wordBank[task.wordId];
  const expected = expectedAnswerFor(task);
  const offset = expectedOffsetFor(task);
  const wrongSet = new Set();
  const typed = (wrongVal || "");
  for(let i=0;i<expected.length;i++){
    if(typed[i] !== expected[i]) wrongSet.add(offset + i);
  }
  setAnswerDisabled(true);
  el.roundLabel.textContent = "正确答案是：";
  renderTiles([{chunk:word.word, hidden:false}], true, wrongSet);
  speak(word.word);
  // 错得越多看得越久，一个字母的手滑不该跟整个瞎猜占用一样长的屏幕时间
  setTimeout(callback, Math.max(1, wrongSet.size) * 2000);
}

function showToast(text){
  el.starToastEl.textContent = text;
  el.starToastEl.classList.remove("show");
  void el.starToastEl.offsetWidth;
  el.starToastEl.classList.add("show");
}

function playMiniCheck(){
  const stageRect = el.stage.getBoundingClientRect();
  const tilesRect = el.tileRow.getBoundingClientRect();
  el.miniCheckEl.style.left = (tilesRect.right - stageRect.left + 36) + "px";
  el.miniCheckEl.style.top = (tilesRect.top + tilesRect.height / 2 - stageRect.top) + "px";
  el.miniCheckEl.classList.remove("show");
  void el.miniCheckEl.offsetWidth;
  el.miniCheckEl.classList.add("show");
  el.tileRow.querySelectorAll(".tile-group").forEach(g=>{
    g.classList.remove("pulse"); void g.offsetWidth; g.classList.add("pulse");
  });
}

function requeueCurrentTask(){ returnCurrentToQueue(); saveState(); }

function correctCoinAmount(){return CONFIG.coinPerCorrect;}
function showCoinFeedback(amount, text){
  refreshHeaderStats();pulse(el.coinCountLabel);spawnCoinBurst();
  showToast(`🪙 +${amount} ${text || "答对了！"}`);
}

function submitAnswer(rawVal,isTimeout){
  const s=state.session,t=s.current;
  if(!t || el.answerInput.disabled) return;
  const val=String(rawVal || "").trim();
  if(!isTimeout && !val){playQuestionAudio();return;}
  clearTimer();t.oxygenDraft="";setAnswerDisabled(true);
  const expected=expectedAnswerFor(t),offset=expectedOffsetFor(t);
  const later=(fn,ms)=>setTimeout(()=>{if(state.session===s) fn();},ms);
  if(val===expected){
    const w=state.wordBank[t.wordId];
    t.wrongStreak=0;
    let growth=null,amount=0;
    if(t.type==="test") growth=completeFirstTestPass(t.wordId);
    if(!growth || !growth.grew){amount=correctCoinAmount();state.base.coins+=amount;}
    if(t.type==="learn" && t.roundIndex<totalRoundsFor(t)-1){
      t.roundIndex++;saveState();
      playCorrectSound();playMiniCheck();showCoinFeedback(amount);
      later(renderRound,650);return;
    }
    if(t.type==="learn") completeLearnPass(t.wordId);
    else if(t.type==="ltm") completeLtmPass(t.wordId);
    else if(!growth || !growth.grew) completeRecheckPass(t.wordId);
    s.current=null;saveState();
    playCorrectSound();playMiniCheck();refreshHeaderStats();renderSidebar();
    if(growth && growth.grew){
      renderFarmStrip({grow:t.wordId});
      if(growth.progress===3){
        armHarvest(t.wordId);
      }else armGrowth(growth.progress===1?"sown":"sprout");
    }else{
      renderFarmStrip();
      showCoinFeedback(amount,t.type==="learn"?"练好了，稍后再试一次":t.type==="ltm"?"抽查通过":"今天练好了");
      later(goNextOrFinish,1100);
    }
    return;
  }
  const revealTask={...t},originalType=t.type;
  t.wrongStreak=(t.wrongStreak || 0)+1;t.hadMistake=true;
  recordWrong(t.wordId,t.wrongStreak,val,expected,offset);
  const w=state.wordBank[t.wordId],failed=t.wrongStreak>=CONFIG.wrongStreakLimit;
  if(originalType==="ltm") completeLtmFail(t.wordId);
  if(failed){completeLearnFail(t.wordId);s.current=null;}
  else if(originalType==="test" || originalType==="ltm"){
    w.taughtDate=todayStr();
    s.current={wordId:t.wordId,type:"learn",roundIndex:0,hadMistake:true,
      wrongStreak:(w.syllables || []).length>1?0:t.wrongStreak};
  }
  resetQuestionOxygen(s.current);saveState();renderFarmStrip();renderSidebar();
  playWrongSound();renderOxygen();
  revealFullWord(val,()=>{
    if(state.session!==s) return;
    if(failed) goNextOrFinish();else renderRound();
  },revealTask);
}
function handleTimeout(){
  const t=state.session?.current;
  if(!t)return;
  clearTimer();ensureQuestionOxygen(t);t.oxygenRemainingMs=0;t.oxygenDraft=el.answerInput.value;
  const events=state.session.oxygenEvents||(state.session.oxygenEvents=[]);
  events.push({wordId:t.wordId,type:t.type,roundIndex:t.roundIndex||0,letters:oxygenLetters(t),allowedMs:t.oxygenDurationMs,typedLetters:(t.oxygenDraft.match(/[a-z]/gi)||[]).length,at:Date.now()});
  if(events.length>200)events.shift();
  saveState();showGameOver(true);
}

let awaitingHarvest=false,harvestRewardKey=null;
let growthBannerStamp=0;
function playGrowSound(big){
  const now=getAudioCtx().currentTime,seq=big?[392,523.25,659.25,783.99]:[330,415.3,523.25];
  seq.forEach((f,i)=>playTone(f,now+i*0.09,0.2,"triangle",0.17));
}
function armGrowth(stage){
  const s=state.session;clearTimer();setAnswerDisabled(true);
  const sown=stage==="sown";
  el.roundLabel.textContent=sown?"🌰 播种了！":"🌱 长出小苗了！";
  el.hintText.textContent="下个练习日，再独立试一次";
  el.growthBanner.className="harvest";
  el.growthBanner.textContent=sown?"🌰 播种了！下次练习再测":"🌱 长出小苗了！";
  el.growthBanner.style.display="block";const stamp=++growthBannerStamp;
  playGrowSound(!sown);
  setTimeout(()=>{if(state.session!==s) return;if(stamp===growthBannerStamp) el.growthBanner.style.display="none";goNextOrFinish();},1800);
}
function armHarvest(wordId){
  const reward=(state.harvestRewards || []).find(r=>r.wordId===wordId && !r.claimed);
  if(!reward){goNextOrFinish();return;}
  awaitingHarvest=true;harvestRewardKey=reward.key;clearTimer();hideAllOverlays();
  setAnswerDisabled(true);el.roundLabel.textContent="🌾 成熟了！";
  el.meaningBadge.textContent=state.wordBank[wordId]?.meaning||"作物成熟";
  el.tileRow.innerHTML="";el.answerInput.value="";
  if(World.isReady())World.focusPlot(state.session.plan.indexOf(wordId),state.session.plan.length);
  el.hintText.textContent="点击收获，或按 Enter";
  el.growthBanner.className="harvest";el.growthBanner.innerHTML="";
  const label=document.createElement("span");label.textContent="🌾 成熟了！ ";
  const button=document.createElement("button");button.className="marioBtn small";
  button.textContent=`收获 +${reward.coins} 多多钱`;button.addEventListener("click",collectHarvest);
  el.growthBanner.append(label,button);el.growthBanner.style.display="block";growthBannerStamp++;
}
function spawnCoinBurst(){
  const zone=el.coinBurstZone;
  for(let i=0;i<5;i++){
    const coin=document.createElement("div");coin.className="burstCoin";
    coin.style.setProperty("--bx",Math.round(Math.random()*140-70)+"px");coin.style.animationDelay=(i*80)+"ms";
    zone.appendChild(coin);setTimeout(()=>coin.remove(),1300);
  }
  playCoinJingle(5);
}
function collectHarvest(){
  if(!awaitingHarvest) return;
  awaitingHarvest=false;setAnswerDisabled(true);const amount=claimHarvest(harvestRewardKey);harvestRewardKey=null;
  el.growthBanner.style.display="none";
  if(amount) showCoinFeedback(amount,"收获到账！");
  renderFarmStrip();const s=state.session;
  setTimeout(()=>{if(state.session===s) goNextOrFinish();},1000);
}


function playOxygenAlert(){
  try{
    const now=getAudioCtx().currentTime;
    for(let i=0;i<4;i++)playTone(i%2?620:520,now+i*0.25,0.13,"sine",0.12);
  }catch(e){console.warn("氧气提示音暂不可用",e);}
}
function showGameOver(sound=false){
  clearTimer();hideAllOverlays();setAnswerDisabled(true);
  el.stage.classList.add("oxygenEmpty");
  const canBuy=state.base.coins>=CONFIG.oxygenCanCost;
  el.gameOverStats.textContent="现有 "+state.base.coins+" 多多钱。已输入的内容和学习进度都保留。";
  el.restartRunBtn.textContent="买氧气罐（"+CONFIG.oxygenCanCost+" 多多钱）";
  el.restartRunBtn.disabled=!canBuy;
  el.askParentOxygenBtn.style.display=canBuy?"none":"";
  el.gameOverOverlay.style.display="flex";renderOxygen();renderParentOxygen();
  if(sound)playOxygenAlert();
}
function continueWithOxygen(){
  el.stage.classList.remove("oxygenEmpty");el.gameOverOverlay.style.display="none";
  renderRound();refreshHeaderStats();renderParentOxygen();
}
el.restartRunBtn.addEventListener("click",()=>{
  if(!buyQuestionOxygen())return;
  continueWithOxygen();
  try{playCoinJingle(1);}catch(e){console.warn("补给提示音暂不可用",e);}
});
el.askParentOxygenBtn.addEventListener("click",openParentSettings);
function renderParentOxygen(){
  const needed=!!state.session?.current && isOutOfOxygen() && state.base.coins<CONFIG.oxygenCanCost;
  el.parentOxygenSection.style.display=needed?"":"none";
}
el.parentOxygenBtn.addEventListener("click",()=>{
  if(!confirm("请家长确认：余额不足，为当前题补一罐氧气？这不会增加或扣除多多钱。"))return;
  if(!parentSupplyOxygen())return;
  el.parentOverlay.classList.remove("show");continueWithOxygen();
});

/* ============================================================================
   键盘：收获 都是「没东西可打，只按 Enter」的时刻。
   挂在 document 上 —— 手一滑点走了焦点，也不能把孩子困在没反应的屏幕上。
   ============================================================================ */
document.addEventListener("keydown", (e)=>{
  if(e.key !== "Enter") return;
  if(el.parentOverlay.classList.contains("show")) return;
  if(awaitingHarvest){ e.preventDefault(); collectHarvest(); }
});

el.answerInput.addEventListener("keydown", (e)=>{
  if(e.key !== "Enter") return;
  if(awaitingHarvest) return;
  const v = el.answerInput.value;
  el.answerInput.value = "";
  submitAnswer(v, false);
});

/* 鼠标操作与键盘提交共用同一个答题入口。 */
document.getElementById("submitBtn").addEventListener("click",()=>{
  if(awaitingHarvest){collectHarvest();return;}
  const value=el.answerInput.value;el.answerInput.value="";submitAnswer(value,false);
});
document.getElementById("replayBtn").addEventListener("click",()=>{
  if(!state.session?.current || el.answerInput.disabled)return;
  submitAnswer("",false);el.answerInput.focus();
});
const journalBtn=document.getElementById("journalBtn");
function toggleJournal(open){
  document.getElementById("sidebar").classList.toggle("open",open);
  journalBtn.setAttribute("aria-expanded",String(open));
}
journalBtn.addEventListener("click",()=>toggleJournal(!document.getElementById("sidebar").classList.contains("open")));
document.getElementById("closeJournalBtn").addEventListener("click",()=>toggleJournal(false));
document.addEventListener("keydown",e=>{if(e.key==="Escape")toggleJournal(false);});

/* ============================================================================
   开始 / 结算 / 休息
   ============================================================================ */

function showStartScreen(){
  const s = state.session;
  el.todayWordList.innerHTML = "";
  s.plan.forEach(id=>{
    const w = state.wordBank[id];
    if(!w) return;
    const li = document.createElement("li");
    li.textContent = w.meaning;
    el.todayWordList.appendChild(li);
  });
  hideAllOverlays();
  el.startScreen.style.display = "flex";
  refreshHeaderStats();
  renderOxygen();
  renderFarmStrip();
}

function showSummary(){
  const s = state.session;
  const wordOf = id => state.wordBank[id] ? state.wordBank[id].word : id;
  const passed   = s.log.filter(l=>l.result==="passed").map(l=>wordOf(l.wordId));
  const needsHelp= s.log.filter(l=>l.result==="needsExplanation").map(l=>wordOf(l.wordId));
  const retry    = s.log.filter(l=>l.result==="retryTomorrow").map(l=>wordOf(l.wordId));
  el.summaryBody.innerHTML = `
    <p>🌾 今日完成 <b>${s.doneCount}</b> / ${s.totalWords}</p>
    <p>✅ 今日独立答对：${passed.length ? passed.join("、") : "无"}</p>
    <p>✏️ 今日练习完成：${s.log.filter(l=>l.result==="practiced").map(l=>wordOf(l.wordId)).join("、") || "无"}</p>
    <p>📦 新进记忆箱：${s.log.filter(l=>l.result==="passed" && state.wordBank[l.wordId].progress===3).map(l=>wordOf(l.wordId)).join("、") || "无"}</p>
    
    <p>🧪 送去实验室（等家长讲解）：${needsHelp.length ? needsHelp.join("、") : "无"}</p>`;

  hideAllOverlays();
  el.summaryScreen.style.display = "flex";

  if(!s.summarized){
    s.summarized = true;
    saveState();
    fireConfetti();
  }
  renderSidebar();
}

// 队列空了就走这里：大庆祝一天只放一次（s.summarized 把着），
// 之后再打开、或者加练完，落到安静的「还想再来点吗」休息态
function finishOrRest(){
  if(!state.session.summarized) showSummary();
  else renderDoneState();
}

function renderDoneState(){
  hideAllOverlays();
  clearTimer();
  el.roundLabel.textContent = "今天完成啦";
  el.tileRow.innerHTML = "";
  el.meaningBadge.textContent = "🎉";
  setAnswerDisabled(true);
  el.answerInput.value = "";
  el.doneScreen.style.display = "flex";
  refreshHeaderStats();
  renderFarmStrip();
}

el.startBtn.addEventListener("click", ()=>{
  getAudioCtx();   // 借这次真实点击解锁音频
  try{ startAmbience(); }catch(e){}   // 环境音也只能在这一刻起（浏览器不许自动播）
  state.session.started = true;
  saveState();
  el.startScreen.style.display = "none";
  const next = pickNextTask(state.session);
  if(next) startTask(next); else finishOrRest();
});
el.closeSummaryBtn.addEventListener("click", ()=>{
  el.summaryScreen.style.display = "none";
  renderDoneState();
});
// 按钮上的数字跟着 CONFIG 走，别写死 —— 改了配置按钮还骗人就尴尬了
el.extendBtn.textContent = `再种 ${CONFIG.extendCount} 个！`;
el.extendBtn.addEventListener("click", ()=>{
  if(!extendSession(CONFIG.extendCount)){
    alert("词库里能练的词都练过啦，让家长在设置里批量导入几个新词吧！");
    return;
  }
  hideAllOverlays();
  renderFarmStrip();
  const next = pickNextTask(state.session);
  if(next) startTask(next); else finishOrRest();
});

/* ============================================================================
   侧边栏
   ============================================================================ */

function renderSidebar(){
  const list = Object.values(state.wordBank).filter(w=>w.needsExplanation);
  el.errorList.innerHTML = "";
  el.errorEmpty.style.display = list.length ? "none" : "block";
  list.forEach(w=>{
    const li = document.createElement("li");
    li.innerHTML = `<span>${w.word}（${w.meaning}）</span>`;
    const btn = document.createElement("button");
    btn.textContent = "已讲解，重新学";
    btn.addEventListener("click", ()=>{
      w.needsExplanation = false;
      // 错误账本不清零：一个需要现实中重新讲解的词，
      // 绝不可能再被算成「本来就会」而跳过教学。
      saveState();
      renderSidebar();
      renderParentTable();
    });
    li.appendChild(btn);
    el.errorList.appendChild(li);
  });
  const st = bankStats();
  el.bankSummary.innerHTML =
    `共 <b>${st.total}</b> 个词　已掌握 <b>${st.mastered}</b> 个<br>` +
    `还能练的：<b>${st.available}</b> 个` +
    (st.available < CONFIG.wordsPerSession ? `　<span style="color:#c62828;">（不够明天用了）</span>` : "");
  renderLtmBox();
}

// 长时记忆箱：确认掌握过 3 天的词。家长点「年检一下」会插一道单次抽查。
function renderLtmBox(){
  const list = Object.values(state.wordBank).filter(w=>w.progress>=3)
                     .sort((a,b)=>a.word.localeCompare(b.word));
  el.ltmList.innerHTML = "";
  el.ltmEmpty.style.display = list.length ? "none" : "block";
  const queue = (state.session && state.session.ltmQueue) || [];
  list.forEach(w=>{
    const li = document.createElement("li");
    li.innerHTML = `<span>${w.word}（${w.meaning}）</span>`;
    const btn = document.createElement("button");
    const queued = queue.includes(w.id);
    btn.textContent = queued ? "已排队" : "年检一下";
    btn.disabled = queued;
    btn.addEventListener("click", ()=>{
      if(!state.session.ltmQueue) state.session.ltmQueue = [];
      if(!state.session.ltmQueue.includes(w.id)){
        state.session.ltmQueue.push(w.id);
        saveState();
        renderLtmBox();
      }
    });
    li.appendChild(btn);
    el.ltmList.appendChild(li);
  });
}

/* ============================================================================
   ⚙ 家长设置
   ============================================================================ */

function openParentSettings(){
  pauseForModal();
  renderParentTable();
  renderLtmBox();
  renderParentOxygen();
  if(state.legacyImport?.report) showMigrationReport(state.legacyImport.report);
  if(typeof CloudSync!=="undefined")renderFamilySyncStatus(CloudSync.info());
  if(!el.customRows.children.length){ addCustomRow(); addCustomRow(); addCustomRow(); }
  renderParentOxygen();el.parentOverlay.classList.add("show");
}
el.gearBtn.addEventListener("click", openParentSettings);
el.closeParentBtn.addEventListener("click", ()=>{ el.parentOverlay.classList.remove("show"); resumeFromModal(); });

function renderFamilySyncStatus(info){
  document.getElementById("familySyncStatus").textContent=info.text;
  document.getElementById("connectFamilyBtn").disabled=["connecting","saving"].includes(info.phase);
  const sync=document.getElementById("syncNowBtn");
  sync.disabled=!info.connected || ["connecting","saving"].includes(info.phase);
  sync.textContent=info.phase==="conflict"?"读取云端进度":"立即同步";
}
function refreshFromFamilyCloud(){
  const parentOpen=el.parentOverlay.classList.contains("show");
  clearTimer();isPaused=false;autoPaused=false;
  awaitingHarvest=false;
  el.growthBanner.style.display="none";
  const s=state.session;
  if(!s){safeInit();}
  else if(s.current && isOutOfOxygen()){showGameOver();}
  else if(pendingHarvest()){armHarvest(pendingHarvest().wordId);}
  else if(s.current){renderRound(true);}
  else{showStartScreen();el.startBtn.textContent=s.started?"继续学习":"开始今天的任务";}
  renderOxygen();renderFarmStrip();renderSidebar();refreshHeaderStats();
  renderParentTable();renderLtmBox();
  if(state.legacyImport?.report)showMigrationReport(state.legacyImport.report);
  else el.legacyStatus.innerHTML="";
  if(parentOpen){pauseForModal();el.parentOverlay.classList.add("show");}
}
if(typeof CloudSync!=="undefined"){
  CloudSync.onStatus(renderFamilySyncStatus);
  CloudSync.onRemote(refreshFromFamilyCloud);
}
document.getElementById("connectFamilyBtn").addEventListener("click",async()=>{
  if(typeof CloudSync==="undefined")return;
  const field=document.getElementById("familyCodeInput");
  if(!field.value.trim()){document.getElementById("familySyncStatus").textContent="请输入原来的家庭码。";field.focus();return;}
  const connected=await CloudSync.connect(field.value);
  if(connected)field.value="";
});
document.getElementById("syncNowBtn").addEventListener("click",()=>{
  if(typeof CloudSync!=="undefined")CloudSync.syncNow();
});

/* ---- 📦 从旧版搬家 ---- */

function showMigrationReport(r){
  if(!r){
    el.legacyStatus.innerHTML = `<p class="pvBad">❌ 没能读出旧版存档，格式不对。</p>`;
    return;
  }
  el.legacyStatus.innerHTML = `
    <p style="color:#2e7d32;font-weight:800;">✅ 搬家完成</p>
    <div class="previewBox">
      新搬进来 <b>${r.added}</b> 个词<br>
      两边都有、合并进度的 <b>${r.merged}</b> 个<br>
      带着掌握进度过来的 <b>${r.progressKept}</b> 个<br>
      现在词库共 <b>${r.total}</b> 个词，其中已掌握 <b>${r.mastered}</b> 个<br>
      进行中 <b>${r.inProgress}</b> 个，其中需讲解 <b>${r.needsHelp}</b> 个<br>
      旧版练习日记录 <b>${r.historyDays}</b> 条已保留，迁移前进度已自动备份
      ${r.skipped ? `<br><span class="pvBad">跳过 ${r.skipped} 条残缺记录</span>` : ""}
    </div>`;
}

function reportMigration(r){
  if(!r){showMigrationReport(r);return;}
  const wasOpen=el.parentOverlay.classList.contains("show");
  clearTimer();isPaused=false;autoPaused=false;
  safeInit();
  if(wasOpen){pauseForModal();el.parentOverlay.classList.add("show");}
  renderParentTable();renderLtmBox();renderSidebar();refreshHeaderStats();
  showMigrationReport(r);
}

function importLegacyProgress(legacy){
  try{reportMigration(migrateFromLegacy(legacy));}
  catch(error){console.error("学习进度迁移未保存：",error);el.legacyStatus.textContent="导入未保存，原进度已保留。请检查浏览器存储空间后重试。";}
}

document.getElementById("exportProgressBtn").addEventListener("click",()=>{
  const blob=new Blob([JSON.stringify(state,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob),link=document.createElement("a");
  link.href=url;link.download=`多多星_学习存档_${Date.now()}.json`;
  document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
});

el.legacyScanBtn.addEventListener("click", ()=>{
  const legacy = readLegacyState();
  if(!legacy){
    el.legacyStatus.innerHTML = `
      <p class="pvBad">⚠️ 这个页面读不到旧版存档。</p>
      <p class="subtle">
        浏览器的存档是<b>按来源隔离</b>的：如果旧版是双击打开的本地文件、而新版是从
        <code>localhost</code> 打开的（或者反过来），两边就互相看不见。<br>
        点右边的「改用手动粘贴」，一样能搬。
      </p>`;
    el.legacyManualBox.style.display = "block";
    return;
  }
  const n = Object.keys(legacy.wordBank || {}).length;
  if(!confirm(`检测到旧版存档，里面有 ${n} 个词。\n\n要把它们连同掌握进度一起搬过来吗？\n（只会往好的方向合并，不会让现有进度倒退）`)) return;
  importLegacyProgress(legacy);
});

el.legacyManualBtn.addEventListener("click", ()=>{
  el.legacyManualBox.style.display = el.legacyManualBox.style.display === "none" ? "block" : "none";
});

el.legacyImportBtn.addEventListener("click", ()=>{
  const legacy = parseLegacyBlob(el.legacyText.value);
  if(!legacy){
    el.legacyStatus.innerHTML = `<p class="pvBad">❌ 粘进来的东西不像旧版存档。应该是一整段以 <code>{"wordBank":</code> 开头的文字。</p>`;
    return;
  }
  const n = Object.keys(legacy.wordBank).length;
  if(!confirm(`读到 ${n} 个词。要把它们连同掌握进度一起搬过来吗？`)) return;
  importLegacyProgress(legacy);
  el.legacyText.value = "";
});

/* ---- 批量粘贴导入 ---- */
let pendingImport = null;

el.previewImportBtn.addEventListener("click", ()=>{
  const res = parseWordList(el.importText.value);
  pendingImport = res.ok;
  if(!res.ok.length && !res.bad.length){
    el.importPreview.innerHTML = `<p class="subtle">还没粘进来东西呢。</p>`;
    return;
  }
  const rows = res.ok.map(it=>
    `<div class="pvRow pvOk">✅ <b>${it.word}</b> — ${it.meaning} <span style="color:#999;">（${it.syllables.join("-")}）</span></div>`
  ).join("");
  const badRows = res.bad.map(l=>`<div class="pvRow pvBad">❌ 没认出来：${l}</div>`).join("");
  el.importPreview.innerHTML = `
    <p>识别出 <b>${res.ok.length}</b> 个词${res.bad.length ? `，<span style="color:#c62828;">${res.bad.length} 行没认出来</span>` : ""}。
       音节是自动拆的，导入后可以在下面的表格里单独调整。</p>
    <div class="previewBox">${rows}${badRows}</div>
    <div class="rowBtns">
      <button class="marioBtn small" id="confirmImportBtn">确认导入这 ${res.ok.length} 个词</button>
    </div>`;
  const btn = document.getElementById("confirmImportBtn");
  if(btn) btn.addEventListener("click", doImport);
});

function doImport(){
  if(!pendingImport || !pendingImport.length) return;
  const r = importWords(pendingImport);
  pendingImport = null;
  el.importText.value = "";
  el.importPreview.innerHTML =
    `<p style="color:#2e7d32;font-weight:800;">✅ 导入完成：新增 ${r.added} 个词` +
    (r.skipped ? `，跳过 ${r.skipped} 个已存在的（它们的掌握进度没被动过）` : "") + `。</p>`;
  renderParentTable();
  renderSidebar();
  refreshHeaderStats();
}

/* ---- 一个一个加 ---- */
function addCustomRow(){
  const row = document.createElement("div");
  row.className = "customRow";
  row.innerHTML = `
    <input class="cwEnglish" placeholder="英文单词">
    <input class="cwChinese" placeholder="中文意思">
    <input class="cwSyll" placeholder="音节（自动）">
    <button class="smallBtn cwRemove" type="button">×</button>`;
  const eng = row.querySelector(".cwEnglish");
  const syll = row.querySelector(".cwSyll");
  eng.addEventListener("input", ()=>{
    if(syll.dataset.touched === "1") return;
    const word = eng.value.trim();
    syll.value = word ? autoSplitSyllables(word).join("-") : "";
  });
  syll.addEventListener("input", ()=>{ syll.dataset.touched = "1"; });
  row.querySelector(".cwRemove").addEventListener("click", ()=> row.remove());
  el.customRows.appendChild(row);
}
el.addRowBtn.addEventListener("click", ()=> addCustomRow());

el.addCustomBtn.addEventListener("click", ()=>{
  const today = todayStr();
  let savedCount = 0;
  el.customRows.querySelectorAll(".customRow").forEach(row=>{
    const rawWordOriginal = row.querySelector(".cwEnglish").value.trim();
    const meaning = row.querySelector(".cwChinese").value.trim();
    const syllStr = row.querySelector(".cwSyll").value.trim().toLowerCase();
    if(!rawWordOriginal || !meaning) return;
    const rawWord = rawWordOriginal.toLowerCase();
    let syllables = [rawWord];
    if(syllStr){
      const chunks = syllStr.split("-").map(s=>s.trim()).filter(Boolean);
      if(chunks.join("") === rawWord) syllables = chunks;
    }
    // 大小写完全按家长打的来，不做任何自动纠正
    syllables = applyWordCasing(rawWordOriginal, syllables);
    const existing = Object.values(state.wordBank).find(w=>w.word.toLowerCase()===rawWord);
    if(existing){
      existing.meaning = meaning;
      if(syllables.length>1) existing.syllables = syllables;
      existing.word = rawWordOriginal;
      existing.priorityDate = today;
    }else{
      const id = "w_"+rawWord.replace(/[^a-z0-9]/g,"")+"_"+Date.now().toString(36)+Math.random().toString(36).slice(2,5);
      state.wordBank[id] = {
        id, word: rawWordOriginal, meaning, syllables, source:"custom",
        progress:0, needsExplanation:false, lastPracticed:null,
        addedDate: today, priorityDate: today
      };
    }
    savedCount++;
  });
  if(savedCount === 0){ alert("每行至少要填英文和中文意思才能保存。"); return; }
  el.customRows.innerHTML = "";
  addCustomRow(); addCustomRow(); addCustomRow();
  saveState();
  renderParentTable();
  renderSidebar();
  alert(`已保存 ${savedCount} 个词，会在下次生成今日任务时优先安排。\n（如果今天的任务已经开始了，用「重置今日进度」重新生成）`);
});

/* ---- 词表 ---- */
// 让家长改坏掉的自动拆分，而不用删了重加（重加会把进度清零）
function adjustSyllables(wordId){
  const w = state.wordBank[wordId];
  if(!w) return;
  const current = (w.syllables && w.syllables.length ? w.syllables : [w.word]).join("-");
  const input = prompt(`重新划分「${w.word}」的音节，用 - 分隔（比如 doc-tor）：`, current);
  if(input === null) return;
  const chunks = input.split("-").map(s=>s.trim()).filter(Boolean);
  if(!chunks.length || chunks.join("").toLowerCase() !== w.word.toLowerCase()){
    alert("音节拼起来必须正好是这个词本身，请检查后重试。");
    return;
  }
  w.syllables = applyWordCasing(w.word, chunks.map(c=>c.toLowerCase()));
  saveState();
  renderParentTable();
}

function renderParentTable(){
  el.wordTableBody.innerHTML = "";
  // 已掌握的词在「长时记忆箱子」那一节，这张表专门放还在进行中的
  Object.values(state.wordBank).filter(w=>w.progress<3)
    .sort((a,b)=>(b.wrongTotal||0)-(a.wrongTotal||0) || a.word.localeCompare(b.word)).forEach(w=>{
    const tr = document.createElement("tr");
    const dots = [0,1,2].map(i=>`<span class="dot ${i<w.progress?"on":""}"></span>`).join("");
    const total = w.wrongTotal || 0, worst = w.wrongWorst || 0;
    tr.innerHTML = `
      <td>${w.word}</td><td>${w.meaning}</td>
      <td>${w.source==="custom"?"自定义":"内置"}</td>
      <td>${w.progress}星 ${dots}</td>
      <td style="white-space:nowrap;">${total ? `错 <b>${total}</b> 次<br>本题最多 <b>${worst}</b> 连错` : "—"}</td>
      <td>${w.needsExplanation ? "🧪 需讲解" : "—"}</td><td></td>`;
    const btn = document.createElement("button");
    btn.className = "smallBtn";
    btn.textContent = "调整音节";
    btn.addEventListener("click", ()=> adjustSyllables(w.id));
    tr.lastElementChild.appendChild(btn);
    el.wordTableBody.appendChild(tr);
  });
}

el.resetTodayBtn.addEventListener("click", ()=>{
  if(!confirm("确定要重置今天的任务吗？（保留星级、当天首测和错误记录，不会同日重复加星）")) return;
  state.session = buildDailySession();
  saveState();
  clearTimer();
  el.parentOverlay.classList.remove("show");
  safeInit();
});
el.resetAllBtn.addEventListener("click", ()=>{
  if(!confirm("这会清空所有学习记录、自定义单词，以及整个基地（多多钱、矿石和设施）。确定吗？")) return;
  localStorage.removeItem(STORAGE_KEY);
  clearTimer();
  el.parentOverlay.classList.remove("show");
  loadState();
  ensureTodaySession();
  safeInit();
});

/* ============================================================================
   彩带
   ============================================================================ */
function fireConfetti(){
  const canvas = el.confettiCanvas;
  canvas.width = el.stage.clientWidth;
  canvas.height = el.stage.clientHeight;
  const ctx = canvas.getContext("2d");
  const colors = ["#ff7043","#ffd54f","#4caf50","#42a5f5","#ab47bc","#ffffff"];
  const confetti = Array.from({length:160}, ()=>({
    x: Math.random()*canvas.width,
    y: -20 - Math.random()*canvas.height*0.5,
    r: 3+Math.random()*4,
    c: colors[Math.floor(Math.random()*colors.length)],
    vy: 2+Math.random()*3, vx: -1.5+Math.random()*3, rot: Math.random()*360
  }));
  function makeBurst(cx, cy){
    return Array.from({length:40}, ()=>{
      const angle = Math.random()*Math.PI*2, speed = 2+Math.random()*5;
      return { x:cx, y:cy, r:2+Math.random()*2.5,
        c: colors[Math.floor(Math.random()*colors.length)],
        vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed, life: 1 };
    });
  }
  let bursts = [...makeBurst(canvas.width*0.3, canvas.height*0.35), ...makeBurst(canvas.width*0.7, canvas.height*0.3)];
  let frames = 0;
  function tick(){
    ctx.clearRect(0,0,canvas.width,canvas.height);
    confetti.forEach(p=>{
      p.x += p.vx; p.y += p.vy; p.rot += 6;
      ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot*Math.PI/180);
      ctx.fillStyle = p.c; ctx.fillRect(-p.r,-p.r,p.r*2,p.r*2); ctx.restore();
    });
    bursts.forEach(p=>{
      p.x += p.vx; p.y += p.vy; p.vy += 0.08; p.life -= 0.018;
      ctx.save(); ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.c; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2); ctx.fill(); ctx.restore();
    });
    frames++;
    if(frames === 45) bursts = bursts.concat(makeBurst(canvas.width*0.5, canvas.height*0.25));
    if(frames < 170) requestAnimationFrame(tick);
    else ctx.clearRect(0,0,canvas.width,canvas.height);
  }
  tick();
}

/* ============================================================================
   启动
   ============================================================================ */

function init(){
  awaitingHarvest=false;setAnswerDisabled(true);
  el.growthBanner.style.display="none";
  ensureTodaySession();
  // 温室只初始化一次；素材或场景异常不阻塞答题。
  if(!World.isReady()){
    try{
      if(World.init(el.world3d)) applyTimeOfDay(World.timeOfDayPreset());
    }catch(err){
      console.error("温室场景加载异常，答题仍可继续：", err);
    }
  }
  World.resize();
  refreshHeaderStats();
  renderOxygen();
  renderFarmStrip();
  renderSidebar();
  const s = state.session;
  if(pendingHarvest()){
    armHarvest(pendingHarvest().wordId);
  }else if(!s.started){
    showStartScreen();
  }else if(s.current && isOutOfOxygen()){
    showGameOver();
  }else if(s.current){
    renderRound(true);
  }else{
    showStartScreen();el.startBtn.textContent="继续学习";
  }
}

// 别让一个意外的 bug 把页面永远冻住：启动抛错就丢掉当前那道题再试一次，
// 还不行就给一句看得懂、能操作的提示，而不是一片死屏
function safeInit(){
  try{
    init();
  }catch(err){
    console.error("初始化失败，尝试自动恢复：", err);
    try{
      if(state && state.session) state.session.current = null;
      saveState();
      init();
    }catch(err2){
      console.error("自动恢复也失败了：", err2);
      setAnswerDisabled(false);
      el.roundLabel.textContent = "遇到问题了";
      el.hintText.textContent = "请点右上角 ⚙ 打开家长设置，点「重置今日进度」";
    }
  }
}

async function launchGame(){
  loadState();
  if(typeof CloudSync!=="undefined"){
    el.hintText.textContent="正在读取学习进度…";
    await CloudSync.start();
  }
  safeInit();
  // 新设备第一次打开线上版时，直接把家庭码入口放到家长面前。
  if(typeof CloudSync!=="undefined" && !CloudSync.getPasscode() && typeof location!=="undefined" && !["localhost","127.0.0.1"].includes(location.hostname)){
    openParentSettings();
  }
}
launchGame();
