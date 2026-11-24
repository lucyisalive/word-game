"use strict";
/* ============================================================================
   ui.js —— 渲染、事件、流程串联
   ============================================================================ */

const el = {};
["doneCountLabel","totalCountLabel","pendingCountLabel","coinCountLabel","oreCountLabel",
 "lowBankBanner","roundLabel","tileRow","meaningBadge","bridgeBar","pauseBtn",
 "answerInput","hintText","starToastEl","miniCheckEl","startScreen","todayWordList","startBtn",
 "summaryScreen","summaryBody","scoreBreakdown","closeSummaryBtn","doneScreen","extendBtn",
 "gotoFarmBtn","errorList","errorEmpty","ltmList","ltmEmpty","bankSummary","gearBtn",
 "parentOverlay","addCustomBtn","resetTodayBtn","resetAllBtn","closeParentBtn","wordTableBody",
 "confettiCanvas","avatarBadge","coinBurstZone","starRow","farmBtn","farmOverlay","closeFarmBtn",
 "avatarGrid","customRows","addRowBtn","oxygenRow","oxygenTank","oxygenText",
 "gameOverOverlay",
 "gameOverStats","restartRunBtn","starWall","streakLine","importText","previewImportBtn",
 "importPreview","payoutReport","baseSummary","fuelInfo","buyFuelBtn",
 "facilityGrid","stage","legacyStatus","legacyScanBtn","legacyManualBtn","legacyManualBox",
 "legacyText","legacyImportBtn","stakeBanner","world3d","viewBtns",
 "petBtn","petOverlay","closePetBtn","petTitle","petFace","petMoodLine","petBondBar",
 "petBondText","petMsg","petActions","petBubble","petBubbleIcon","petBubbleFill","petCallBanner"
].forEach(id => { el[id] = document.getElementById(id); });

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
let timerHandle = null;
let timerDeadline = 0;

function clearTimer(){
  if(timerHandle){ clearInterval(timerHandle); timerHandle = null; }
}
function startTimer(durationMs){
  clearTimer();
  timerDeadline = Date.now() + durationMs;
  el.bridgeBar.style.width = "100%";
  el.bridgeBar.style.background = "#4caf50";
  timerHandle = setInterval(()=>{
    const remain = timerDeadline - Date.now();
    const ratio = Math.max(0, remain / durationMs);
    el.bridgeBar.style.width = (ratio*100)+"%";
    el.bridgeBar.style.background = ratio > 0.5 ? "#4caf50" : ratio > 0.2 ? "#ffca28" : "#e53935";
    if(remain <= 0){ clearTimer(); handleTimeout(); }
  }, 100);
}

// 手动暂停：切去别的窗口时冻结倒计时，别让孩子白白掉氧气
let isPaused = false, pausedRemainingMs = 0, pausedLabelBackup = "", pausedHintBackup = "";
function pauseGame(){
  if(isPaused) return;
  if(!state.session || !state.session.current || el.answerInput.disabled){
    alert("现在没有正在计时的题目，没法暂停。");
    return;
  }
  isPaused = true;
  pausedRemainingMs = Math.max(500, timerDeadline - Date.now());
  clearTimer();
  setAnswerDisabled(true);
  el.pauseBtn.textContent = "▶";
  el.pauseBtn.title = "继续计时";
  pausedLabelBackup = el.roundLabel.textContent;
  pausedHintBackup = el.hintText.textContent;
  el.roundLabel.textContent = "⏸ 已暂停";
  el.hintText.textContent = "点右上角 ▶ 恢复计时";
}
function resumeGame(){
  if(!isPaused) return;
  isPaused = false;
  el.pauseBtn.textContent = "⏸";
  el.pauseBtn.title = "暂停计时";
  el.roundLabel.textContent = pausedLabelBackup;
  el.hintText.textContent = pausedHintBackup;
  setAnswerDisabled(false);
  el.answerInput.focus();
  startTimer(pausedRemainingMs);
}
el.pauseBtn.addEventListener("click", ()=>{ isPaused ? resumeGame() : pauseGame(); });

/* 打开任何弹窗（多多 / 基地 / 家长设置）都自动暂停计时。
   ⚠️ 这是个真踩过的坑：孩子跑去抱一下多多鸟，回来发现题目超时、氧气掉了 ——
   完全说不通。去看宠物、去基地花钱，都不该被计时惩罚。 */
let autoPaused = false;
function canPauseNow(){
  return state.session && state.session.current && !el.answerInput.disabled;
}
function pauseForModal(){
  if(isPaused || !canPauseNow()) return;
  autoPaused = true;
  pauseGame();
}
function resumeFromModal(){
  if(!autoPaused) return;
  autoPaused = false;
  if(isPaused) resumeGame();
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
  el.oreCountLabel.textContent = state.base.ore;
  el.avatarBadge.textContent = state.base.currentAvatar;
}

function renderOxygen(poppedIndex){
  const s = state.session;
  const max = oxygenCap();
  const left = Math.max(0, Math.min(max, s.oxygen));
  el.oxygenTank.innerHTML = "";
  for(let i=0;i<max;i++){
    const cell = document.createElement("div");
    cell.className = "oxyCell" + (i < left ? "" : " spent");
    if(poppedIndex === i) cell.classList.add("popping");
    el.oxygenTank.appendChild(cell);
  }
  el.oxygenText.textContent = `${left} / ${max}`;
  el.oxygenRow.classList.toggle("low", left > 0 && left <= CONFIG.oxygenLowAt);
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
  hideStakeBanner();
  el.startScreen.style.display = "none";
  el.summaryScreen.style.display = "none";
  el.doneScreen.style.display = "none";

  el.gameOverOverlay.style.display = "none";
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
  el.answerInput.value = "";
  el.answerInput.placeholder = partial ? "输入缺少的字母" : "输入完整单词";
  el.hintText.textContent = partial
    ? "✏️ 只输入缺少的字母（注意大小写）　|　Enter 提交　|　留空 Enter 重听"
    : "✏️ 这一关请输入完整单词（注意大小写）　|　Enter 提交　|　留空 Enter 重听";
  el.answerInput.focus();
  el.pauseBtn.disabled = false;
  refreshHeaderStats();
  renderOxygen();
  renderFarmStrip();
  const duration=word.word.length * CONFIG.secsPerLetter * 1000;
  if(fromCloud){timerDeadline=Date.now()+duration;pauseGame();}
  else{speak(word.word);startTimer(duration);}
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
  maybeStartPetVisit();     // 🦤 随机某个时刻它会跑来
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

/* 答错之后、重答之前，把还悬着的赌注顶到脸上。
   这是整局里刺激浓度最该拉满的一秒：刚栽了一跤，马上要重来，
   冕素矿石资格会在这里变化 —— 给不给这个信息，直接决定它有没有行为效果。 */
function showStakeBanner(stake){
  const b=el.stakeBanner;
  if(stake==="gone"){b.style.display="none";return;}
  b.className=stake==="lost"?"lost":"alive";
  b.textContent=stake==="lost"?"这处错法重复了，本词不再获得冕素矿石。已经获得的矿石保留。":"改正后不重复这处错法，记牢时可得冕素矿石。";
  el.hintText.style.visibility="hidden";b.style.display="block";b.classList.add("show");
}

function hideStakeBanner(){
  el.stakeBanner.style.display = "none";
  el.stakeBanner.classList.remove("show");
  el.hintText.style.visibility = "";
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
  if(!isTimeout && !val){speak(state.wordBank[t.wordId].word);return;}
  clearTimer();setAnswerDisabled(true);
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
        if(growth.ore){pulse(el.oreCountLabel);playOreForm();}
        armHarvest(t.wordId,growth.ore);
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
  const stake=recordWrong(t.wordId,t.wrongStreak,val,expected,offset);
  if(!state.wordBank[t.wordId].oreAwarded) showStakeBanner(stake);
  const w=state.wordBank[t.wordId],failed=t.wrongStreak>=CONFIG.wrongStreakLimit;
  if(originalType==="ltm") completeLtmFail(t.wordId);
  if(failed){completeLearnFail(t.wordId);s.current=null;}
  else if(originalType==="test" || originalType==="ltm"){
    w.taughtDate=todayStr();
    s.current={wordId:t.wordId,type:"learn",roundIndex:0,hadMistake:true,
      wrongStreak:(w.syllables || []).length>1?0:t.wrongStreak};
  }
  const before=s.oxygen;loseOxygen();saveState();renderFarmStrip();renderSidebar();
  playWrongSound();renderOxygen(before-1);
  if(!w.oreAwarded) showStakeBanner(stake);
  later(()=>playOxygenLeak(s.oxygen),120);
  if(s.oxygen>0 && s.oxygen<=CONFIG.oxygenLowAt) later(playAlarmSound,500);
  revealFullWord(val,()=>{
    if(state.session!==s) return;
    if(s.oxygen<=0){showGameOver();return;}
    if(failed) goNextOrFinish();else renderRound();
  },revealTask);
}
function handleTimeout(){submitAnswer(el.answerInput.value,true);}

let awaitingHarvest=false,harvestRewardKey=null;
let petBannerStamp=0;
function playGrowSound(big){
  const now=getAudioCtx().currentTime,seq=big?[392,523.25,659.25,783.99]:[330,415.3,523.25];
  seq.forEach((f,i)=>playTone(f,now+i*0.09,0.2,"triangle",0.17));
}
function armGrowth(stage){
  const s=state.session;clearTimer();setAnswerDisabled(true);
  const sown=stage==="sown";
  el.roundLabel.textContent=sown?"🌰 播种了！":"🌱 长出小苗了！";
  el.hintText.textContent="下个练习日，再独立试一次";
  el.petCallBanner.className="harvest";
  el.petCallBanner.textContent=sown?"🌰 播种了！下次练习再测":"🌱 长出小苗了！";
  el.petCallBanner.style.display="block";const stamp=++petBannerStamp;
  playGrowSound(!sown);
  setTimeout(()=>{if(state.session!==s) return;if(stamp===petBannerStamp) el.petCallBanner.style.display="none";goNextOrFinish();},1800);
}
function armHarvest(wordId,ore){
  const reward=(state.harvestRewards || []).find(r=>r.wordId===wordId && !r.claimed);
  if(!reward){goNextOrFinish();return;}
  awaitingHarvest=true;harvestRewardKey=reward.key;clearTimer();hideAllOverlays();
  setAnswerDisabled(true);el.roundLabel.textContent="🌾 成熟了！";
  el.meaningBadge.textContent=state.wordBank[wordId]?.meaning||"作物成熟";
  el.tileRow.innerHTML="";el.answerInput.value="";
  if(World.isReady())World.focusPlot(state.session.plan.indexOf(wordId),state.session.plan.length);
  el.hintText.textContent="点击收获，或按 Enter";
  el.petCallBanner.className="harvest";el.petCallBanner.innerHTML="";
  const label=document.createElement("span");label.textContent=ore?"🪨 冕素矿石 +1，已入库！ ":"🌾 成熟了！ ";
  const button=document.createElement("button");button.className="marioBtn small";
  button.textContent=`收获 +${reward.coins} 金币`;button.addEventListener("click",collectHarvest);
  el.petCallBanner.append(label,button);el.petCallBanner.style.display="block";petBannerStamp++;
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
  el.petCallBanner.style.display="none";
  if(amount) showCoinFeedback(amount,"收获到账！");
  renderFarmStrip();const s=state.session;
  setTimeout(()=>{if(state.session===s) goNextOrFinish();},1000);
}


function showGameOver(){
  clearTimer();
  const s = state.session;
  const harvested = s.log.filter(l=>l.result==="passed").length;
  el.gameOverStats.innerHTML =
    `已经收进仓库的：<b>🌾 ${harvested} 个词</b>　<b>🪙 ${state.base.coins} 星球币</b><br>` +
    `已获得的金币和矿石保留；答错词的星级已归零。`;
  setAnswerDisabled(true);
  el.answerInput.value = "";
  hideAllOverlays();
  el.gameOverOverlay.style.display = "flex";
  renderOxygen();
  playGameOverSound();
}

el.restartRunBtn.addEventListener("click", ()=>{
  restartRun();
  renderOxygen();
  hideAllOverlays();
  if(state.session.current) renderRound(); else goNextOrFinish();
});

/* ============================================================================
   键盘：收获 都是「没东西可打，只按 Enter」的时刻。
   挂在 document 上 —— 手一滑点走了焦点，也不能把孩子困在没反应的屏幕上。
   ============================================================================ */
document.addEventListener("keydown", (e)=>{
  if(e.key !== "Enter") return;
  if(el.parentOverlay.classList.contains("show") || el.farmOverlay.classList.contains("show")
     || el.petOverlay.classList.contains("show")) return;
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

const STAR_POLY = "50,2 61.17,34.63 95.65,35.17 68.07,55.87 78.21,88.83 50,69 21.79,88.83 31.93,55.87 4.35,35.17 38.83,34.63";
function renderStars(stars){
  el.starRow.innerHTML = "";
  for(let i=0;i<3;i++){
    const slot = document.createElement("span");
    slot.className = "starSlot";
    slot.innerHTML = `<svg viewBox="0 0 100 100" class="starSVG"><polygon points="${STAR_POLY}" class="starPoly"/></svg>`;
    el.starRow.appendChild(slot);
  }
  const slots = el.starRow.querySelectorAll(".starSlot");
  const tier = starTierColorFor(stars);
  for(let i=0;i<stars;i++){
    setTimeout(()=>{
      slots[i].classList.add(tier, "lit", "pop");
      playStarDing(i);
    }, 500 + i * 450);
  }
}

function showSummary(){
  const s = state.session;
  const wordOf = id => state.wordBank[id] ? state.wordBank[id].word : id;
  const passed   = s.log.filter(l=>l.result==="passed").map(l=>wordOf(l.wordId));
  const needsHelp= s.log.filter(l=>l.result==="needsExplanation").map(l=>wordOf(l.wordId));
  const retry    = s.log.filter(l=>l.result==="retryTomorrow").map(l=>wordOf(l.wordId));
  const sc = computeScore(s);
  const stars = starsForSession(s);

  renderStars(stars);

  const th = CONFIG.starThresholds;
  el.scoreBreakdown.innerHTML = `
    <div>🫧 剩余氧气　<b>${Math.max(0,s.oxygen)}</b> 格 × ${CONFIG.scorePerOxygen} = <b>${sc.oxy}</b> 分</div>
    <div>🌾 收获的词　<b>${s.log.filter(l=>l.result==="passed").length}</b> 个 × ${CONFIG.scorePerHarvest} = <b>${sc.harvest}</b> 分</div>
    <div>🎯 一次过的词　<b>${Math.min(s.perfectWords.length, CONFIG.perfectCap)}</b> 个 × ${CONFIG.scorePerPerfect} = <b>${sc.perfect}</b> 分</div>
    <div class="scoreTotal">总分 ${sc.total} 　→ 　${"★".repeat(stars)}${"☆".repeat(3-stars)}
      ${s.starsLocked ? '<br><span style="color:#c62828;font-size:12px;">（今天氧气耗尽过，星星已锁死为 0）</span>'
                      : `<br><span style="font-size:12px;color:#8a7a68;">三星需要 ${th[2]} 分</span>`}
    </div>`;

  el.summaryBody.innerHTML = `
    <p>🌾 今日收获 <b>${s.doneCount}</b> / ${s.totalWords}</p>
    <p>✅ 今日独立答对：${passed.length ? passed.join("、") : "无"}</p>
    <p>✏️ 今日练习完成：${s.log.filter(l=>l.result==="practiced").map(l=>wordOf(l.wordId)).join("、") || "无"}</p>
    <p>📦 新进记忆箱：${s.log.filter(l=>l.result==="passed" && state.wordBank[l.wordId].progress===3).map(l=>wordOf(l.wordId)).join("、") || "无"}</p>
    
    <p>🧪 送去实验室（等家长讲解）：${needsHelp.length ? needsHelp.join("、") : "无"}</p>`;

  hideAllOverlays();
  el.summaryScreen.style.display = "flex";

  if(!s.summarized){
    s.summarized = true;
    recordStarHistory(stars, sc.total);
    saveState();
    if(stars > 0) fireConfetti();
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
el.gotoFarmBtn.addEventListener("click", ()=> openFarm());

/* ============================================================================
   侧边栏
   ============================================================================ */

function renderStarWall(){
  const h = state.base.starHistory.slice(-21);
  el.starWall.innerHTML = "";
  h.forEach(rec=>{
    const d = document.createElement("div");
    d.className = "wallDay s" + rec.stars;
    d.textContent = rec.stars > 0 ? "★".repeat(rec.stars) : "·";
    d.title = `${rec.date}　${rec.stars} 星　${rec.score} 分`;
    el.starWall.appendChild(d);
  });
  const st = starStreaks();
  el.streakLine.innerHTML = h.length
    ? `连续三星：<b>${st.current}</b> 天　|　历史最高：<b>${st.best}</b> 天`
    : `还没有记录，今天就是第 1 天～`;
}

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
  renderStarWall();
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
   🦤 多多来串门

   平时它不在场 —— 一直在就不稀罕了。
   一局里随机某个时刻它跑出来，头顶冒抱抱符号 + 倒计时。
   **没在窗口里抓住它，它就走了**，今天这格氧气也就没了。
   ============================================================================ */
let petVisit = null;        // { endsAt, raf }

function maybeStartPetVisit(){
  const s = state.session;
  if(!s || s.petVisitDone || petVisit) return;
  if(s.sequence.length < s.petVisitAt) return;
  if(petMood() === "away") { s.petVisitDone = true; return; }
  if(ensurePet().hugUsedOn === todayStr()){ s.petVisitDone = true; return; }
  startPetVisit();
}

function startPetVisit(){
  const s = state.session;
  s.petVisitDone = true;
  saveState();
  if(!World.isReady()) return;
  World.setPetMood(petMood());
  World.showPet();
  petVisit = { endsAt: Date.now() + CONFIG.petVisitSeconds*1000 };
  const p = ensurePet();
  el.petCallBanner.className = "";
  el.petCallBanner.textContent = petMood() === "grumpy"
    ? `💢 ${p.name}来了，但一脸不高兴……`
    : `🦤 ${p.name}跑来了！快去抱抱它`;
  el.petCallBanner.style.display = "block";
  petBannerStamp++;
  el.petBubble.style.display = "block";
  el.petBubbleIcon.textContent = petMood() === "grumpy" ? "💢" : "🤗";
  playBirdChirpIfAny();
  tickPetVisit();
}

function playBirdChirpIfAny(){
  try{ playStakeAlert(); }catch(e){}
}

function tickPetVisit(){
  if(!petVisit) return;
  const left = petVisit.endsAt - Date.now();
  if(left <= 0){ endPetVisit(false); return; }
  const ratio = left / (CONFIG.petVisitSeconds*1000);
  el.petBubbleFill.style.width = (ratio*100) + "%";
  el.petBubbleFill.classList.toggle("urgent", ratio < 0.35);
  const pos = World.petScreenPos();
  if(pos){
    el.petBubble.style.display = "block";
    el.petBubble.style.left = pos.x + "px";
    el.petBubble.style.top  = pos.y + "px";
  }else{
    el.petBubble.style.display = "none";
  }
  petVisit.raf = requestAnimationFrame(tickPetVisit);
}

function endPetVisit(hugged){
  if(!petVisit) return;
  if(petVisit.raf) cancelAnimationFrame(petVisit.raf);
  petVisit = null;
  el.petBubble.style.display = "none";
  World.hidePet();
  if(!hugged){
    // 没抓住 —— 不额外扣任何东西，但那格氧气确实错过了
    el.petCallBanner.className = "gone";
    el.petCallBanner.textContent = `${ensurePet().name}等了一会儿，自己走了……`;
    petBannerStamp++;
    playWrongSound();
  }
  const stamp = petBannerStamp;
  setTimeout(()=>{ if(stamp === petBannerStamp) el.petCallBanner.style.display = "none"; }, hugged ? 2200 : 2600);
}

// 点它 = 抱它。一局就这么一两次，不打断打字的流程。
function hugFromVisit(){
  if(!petVisit) return;
  const r = petHug();
  el.petCallBanner.className = r.oxygen > 0 ? "" : "gone";
  el.petCallBanner.textContent = r.msg;
  el.petCallBanner.style.display = "block";
  petBannerStamp++;
  if(r.oxygen > 0){
    renderOxygen();
    playSparkleSound();
    pulse(el.oxygenText);
  }else{
    playCorrectSound();
  }
  endPetVisit(true);
  updatePetBadge();
}

// 在 3D 画面上点到多多，就是抱它
el.world3d.addEventListener("click", e => {
  if(!petVisit) return;
  if(World.hitPet(e.clientX, e.clientY)) hugFromVisit();
});

/* ============================================================================
   🦤 多多（面板）
   ============================================================================ */
let petDailyReport = null;

function renderPet(msg, tone){
  const p = ensurePet();
  const mood = petMood();
  el.petTitle.textContent = `🦤 ${p.name}`;
  el.petFace.textContent = mood === "away" ? "🕳️" : "🦤";
  el.petFace.className = mood;
  el.petMoodLine.textContent = mood === "away"
    ? `${p.name}${PET_MOOD_TEXT.away}`
    : `${p.name}${PET_MOOD_TEXT[mood]}`;
  const pct = Math.round((p.bond / CONFIG.petBondMax) * 100);
  el.petBondBar.style.width = pct + "%";
  el.petBondText.innerHTML = mood === "away"
    ? `<span style="color:#c62828;">它已经走了。花 ${CONFIG.petFetchBackCost} 星球币可以去把它找回来。</span>`
    : `亲密度 ${p.bond} / ${CONFIG.petBondMax}　`
      + (mood === "happy"
          ? `<b style="color:#2e7d32;">抱一抱能给你 ${CONFIG.petHugOxygen} 格氧气</b>`
          : `<span style="color:#a06a20;">亲密度到 ${CONFIG.petHappyAt} 抱一抱才有氧气</span>`)
      + (p.trash > 0 ? `　<span style="color:#c62828;">🗑️ 有 ${p.trash} 堆垃圾没清</span>` : "");

  if(msg){ el.petMsg.textContent = msg; el.petMsg.className = tone || ""; }
  else if(petDailyReport && (petDailyReport.event || petDailyReport.ranAway)){
    el.petMsg.className = "warn";
    el.petMsg.textContent = petDailyReport.ranAway
      ? `你太久没理${p.name}了。今天醒来，它不在了。`
      : `昨天${petDailyReport.event.text}。`;
  }else if(!el.petMsg.textContent){
    el.petMsg.className = "";
    el.petMsg.textContent = mood === "happy"
      ? `${p.name}在田边一颠一颠地跟着你。`
      : mood === "grumpy" ? `${p.name}背对着你，一动不动。`
      : mood === "away" ? "" : `${p.name}偶尔抬头看看你。`;
  }

  // 按钮该不该能点
  el.petActions.querySelectorAll("[data-pet]").forEach(b => {
    const a = b.dataset.pet;
    if(a === "fetch") b.style.display = mood === "away" ? "" : "none";
    else if(a === "clean") b.style.display = p.trash > 0 ? "" : "none";
    else b.disabled = (mood === "away");
  });

  updatePetBadge();
  if(World.isReady()){ World.setPetMood(mood); World.syncTrash(p.trash); }
  // 注意：setPetMood 不负责让它出现 —— 只有「来串门」才出现（见 startPetVisit）
}

// 顶部按钮：闹脾气会抖，有事没办会挂个小红点
function updatePetBadge(){
  const p = ensurePet(), mood = petMood();
  el.petBtn.textContent = mood === "away" ? "❓" : "🦤";
  el.petBtn.classList.toggle("grumpy", mood === "grumpy" || mood === "away");
  const hugAvailable = mood === "happy" && p.hugUsedOn !== todayStr();
  el.petBtn.classList.toggle("needs", hugAvailable || p.trash > 0 || mood === "away");
  el.petBtn.title = mood === "away" ? `${p.name}不见了` : `${p.name}・${PET_MOOD_TEXT[mood]}`;
}

function openPet(){
  pauseForModal();
  el.petMsg.textContent = "";
  renderPet();
  el.petOverlay.classList.add("show");
}
el.petBtn.addEventListener("click", openPet);
el.closePetBtn.addEventListener("click", ()=>{ el.petOverlay.classList.remove("show"); resumeFromModal(); });

el.petActions.addEventListener("click", e => {
  const a = e.target.dataset.pet;
  if(!a) return;
  let r = null;
  if(a === "hug")        r = petHug();
  else if(a === "miss")  r = petMissYou();
  else if(a === "feed")  r = petFeed();
  else if(a === "clean") r = petCleanTrash();
  else if(a === "fetch") r = petFetchBack();
  else if(a === "rename"){
    const n = prompt("给它起个名字：", ensurePet().name);
    if(n && petRename(n)) renderPet("好，以后就叫这个名字了。");
    return;
  }
  if(!r) return;
  petDailyReport = null;                       // 互动过了，昨天那条播报就不再顶着
  if(r.oxygen > 0){
    renderOxygen();
    playSparkleSound();
    renderPet(r.msg, "gift");
  }else{
    if(r.ok) playCorrectSound(); else playWrongSound();
    renderPet(r.msg, r.ok ? "" : "warn");
  }
  refreshHeaderStats();
});

/* ============================================================================
   🏡 基地界面
   ============================================================================ */
let lastPayoutReport = null;

function openFarm(){
  pauseForModal();
  renderFarm();
  el.farmOverlay.classList.add("show");
}
el.farmBtn.addEventListener("click", openFarm);
el.closeFarmBtn.addEventListener("click", ()=>{ el.farmOverlay.classList.remove("show"); resumeFromModal(); });

function renderFarm(){
  const b = state.base;

  // 昨夜产出报告
  if(lastPayoutReport){
    const r = lastPayoutReport;
    el.payoutReport.style.display = "block";
    el.payoutReport.innerHTML = r.fueled
      ? `🌙 <b>昨夜的自动产出</b><br>
         🏭 设施 → <b>+${r.facilityIncome}</b> 🪙　⛽ 烧掉 ${r.fuelUsed} 格燃料`
      : `🌙 <b>昨夜</b><br>⚠️ <b>燃料不够，设施全停转了</b>（设施没坏，加上燃料就能继续跑）`;
  }else{
    el.payoutReport.style.display = "none";
  }

  el.baseSummary.innerHTML = `
    <div class="baseStat"><span class="bsVal">${b.coins}</span><span class="bsLabel">🪙 星球币</span></div>
    <div class="baseStat"><span class="bsVal">${b.ore}</span><span class="bsLabel">🪨 冕素矿石</span></div>
    <div class="baseStat"><span class="bsVal">${b.fuel}</span><span class="bsLabel">⛽ 燃料</span></div>`;

  // 燃料
  const need = dailyFuelNeed();
  const days = need > 0 ? Math.floor(b.fuel / need) : "∞";
  el.fuelInfo.innerHTML = `
    现有燃料 <b>${b.fuel}</b> 格　|　每天要烧 <b>${need}</b> 格（${b.facilities.length} 台设施）<br>
    <div id="fuelBarWrap"><div id="fuelBar" style="width:${Math.min(100, need? (b.fuel/(need*10))*100 : 100)}%"></div></div>
    还够撑 <b>${days}</b> 天` + (need > 0 && b.fuel < need ? `　<span style="color:#c62828;font-weight:800;">⚠️ 不够了，设施今晚会停转</span>` : "");
  const fuelCost = CONFIG.fuelPrice * CONFIG.fuelBuyBatch;
  el.buyFuelBtn.textContent = `加 ${CONFIG.fuelBuyBatch} 格燃料（🪙 ${fuelCost}）`;
  el.buyFuelBtn.disabled = b.coins < fuelCost;

  // 设施
  el.facilityGrid.innerHTML = "";
  FACILITIES.forEach(f=>{
    const built = hasFacility(f.id);
    const can = canBuildFacility(f);
    const card = document.createElement("div");
    card.className = "facilityCard" + (built ? " built" : can ? "" : " locked");
    const costHtml = built ? `<span class="facBuilt">✅ 已建成，正在运转</span>`
      : `<span class="facCost">尚未开放</span>`;
    card.innerHTML = `
      <div class="facHead"><span class="facIcon">${f.icon}</span>${f.name}</div>
      <div class="facDesc">${f.desc}</div>
      ${costHtml}`;
    if(!built){
      const btn = document.createElement("button");
      btn.className = "marioBtn small";
      btn.textContent = "尚未开放";
      btn.disabled = !can;
      btn.addEventListener("click", ()=>{
        if(buildFacility(f.id)){
          playOreLock();
          try{ World.syncFacilityArt(); }catch(e){}   // 设施立刻立到田边
          refreshHeaderStats();
          renderFarm();
        }
      });
      card.appendChild(btn);
    }
    el.facilityGrid.appendChild(card);
  });

  renderAvatars();
}

el.buyFuelBtn.addEventListener("click", ()=>{
  if(buyFuel()){ playCoinJingle(3); refreshHeaderStats(); renderFarm(); }
});

function renderAvatars(){
  const b = state.base;
  el.avatarGrid.innerHTML = "";
  AVATAR_CATALOG.forEach(a=>{
    const owned = b.ownedAvatars.includes(a.emoji);
    const equipped = b.currentAvatar === a.emoji;
    const affordable = b.coins >= a.cost;
    const slot = document.createElement("div");
    slot.className = "avatarSlot" + (equipped ? " equipped" : "") + (!owned && !affordable ? " locked" : "");
    slot.innerHTML = `${a.emoji}<span class="cost">${owned ? (equipped ? "已佩戴" : "点击佩戴") : "🪙 " + a.cost}</span>`;
    slot.addEventListener("click", ()=>{
      if(owned){ b.currentAvatar = a.emoji; }
      else if(affordable){ b.coins -= a.cost; b.ownedAvatars.push(a.emoji); b.currentAvatar = a.emoji; playCoinJingle(3); }
      else return;
      saveState();
      refreshHeaderStats();
      renderFarm();
    });
    el.avatarGrid.appendChild(slot);
  });
}

/* ============================================================================
   ⚙ 家长设置
   ============================================================================ */

el.gearBtn.addEventListener("click", ()=>{
  pauseForModal();
  renderParentTable();
  renderLtmBox();
  if(state.legacyImport?.report) showMigrationReport(state.legacyImport.report);
  if(typeof CloudSync!=="undefined")renderFamilySyncStatus(CloudSync.info());
  if(!el.customRows.children.length){ addCustomRow(); addCustomRow(); addCustomRow(); }
  el.parentOverlay.classList.add("show");
});
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
  el.petCallBanner.style.display="none";
  const s=state.session;
  if(!s){safeInit();}
  else if(s.oxygen<=0){showGameOver();}
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

// 这个词现在算总账的话会拿到什么矿石 —— 让家长看得见门槛松紧，好照着调
function oreForecastHtml(w){
  if(w.oreAwarded) return "🪨 已获得（不重发）";
  if(w.repeatedError) return "有重复错法，不发矿石";
  if(w.legacyErrorHistoryUnknown && !(w.wrongTotal||0)) return "旧版无错误明细，按后续新记录判断";
  return (w.wrongTotal || 0)>0?"🪨 记牢后可获得":"尚未错过，不发矿石";
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
      <td style="white-space:nowrap;">${oreForecastHtml(w)}</td>
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
  if(!confirm("这会清空所有学习记录、自定义单词，以及整个基地（星球币、矿石和设施）。确定吗？")) return;
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
  el.petCallBanner.style.display="none";
  ensureTodaySession();
  lastPayoutReport = runDailyPayout();
  // 温室只初始化一次；素材或场景异常不阻塞答题。
  if(!World.isReady()){
    try{
      if(World.init(el.world3d)) applyTimeOfDay(World.timeOfDayPreset());
    }catch(err){
      console.error("温室场景加载异常，答题仍可继续：", err);
    }
  }
  World.resize();
  petDailyReport = petDailyTick();
  refreshHeaderStats();
  renderOxygen();
  renderFarmStrip();
  renderSidebar();
  renderPet();
  const s = state.session;
  if(s.oxygen>0 && pendingHarvest()){
    armHarvest(pendingHarvest().wordId);
  }else if(!s.started){
    showStartScreen();
  }else if(s.oxygen <= 0){
    showGameOver();
  }else if(s.current){
    renderRound();
  }else{
    const next = pickNextTask(s);
    if(next) startTask(next); else finishOrRest();
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
    renderParentTable();renderLtmBox();el.parentOverlay.classList.add("show");
  }
}
launchGame();
