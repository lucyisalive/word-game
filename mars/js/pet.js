"use strict";
/* ============================================================================
   pet.js —— 多多鸟

   为什么是渡渡鸟：
     渡渡鸟 1681 年灭绝。但它不是「不够好」—— 它是完美适应了毛里求斯那个
     没有天敌的世界：不会飞、不怕人，因为几百万年里它根本不需要飞、不需要怕。
     然后人来了。不是它退化了，是世界被换掉了。
     多多星是一颗「没有生命需要为环境让步」的星球，所以渡渡鸟在这儿活得好好的。

   机制上的一条命题：
     **它不产粮、不产钱、不加任何收益。它唯一给你的东西是「命」（氧气）。**
     而氧气是全游戏最贵、钱买不到的东西。
     抱一抱换来的是关键时刻不死 —— 情绪价值为什么叫价值，靠这条闭环。

   ⚠️ 红线：它的负反馈必须是**能花钱结清的账单**，不能是说不清的亏欠。
     「它生气了，扔了垃圾，你花 15 块清掉」—— 办完就翻篇。
     「你没背单词所以它在受苦」—— 这种绝对不做。
   ============================================================================ */

function defaultPet(){
  return {
    name: "多多",
    bond: CONFIG.petBondStart,
    lastTick: null,       // 上一次结算日常衰减的日期
    hugUsedOn: null,      // 今天抱过没有
    missYouUsedOn: null,  // 今天说过「很想你」没有
    fedOn: null,          // 今天喂过没有（只是记录，喂食不限次）
    away: false,          // 离家出走了
    zeroDays: 0,          // 亲密度归零连续几天了
    trash: 0,             // 它扔的垃圾堆，没清理干净会一直在
    lastEvent: null       // 昨天它干了什么（进游戏时告诉孩子）
  };
}

function ensurePet(){
  if(!state.base.pet || typeof state.base.pet !== "object") state.base.pet = defaultPet();
  const d = defaultPet();
  for(const k of Object.keys(d)) if(state.base.pet[k] === undefined) state.base.pet[k] = d[k];
  const p = state.base.pet;
  p.bond = Math.max(0, Math.min(CONFIG.petBondMax, Number(p.bond) || 0));
  if(typeof p.trash !== "number" || isNaN(p.trash)) p.trash = 0;
  if(typeof p.zeroDays !== "number" || isNaN(p.zeroDays)) p.zeroDays = 0;
  return p;
}

/* 心情四档。away 是「它已经走了」，不是心情，但对外统一从这里取。 */
function petMood(){
  const p = ensurePet();
  if(p.away) return "away";
  if(p.bond >= CONFIG.petHappyAt) return "happy";
  if(p.bond < CONFIG.petGrumpyAt) return "grumpy";
  return "ok";
}

const PET_FACE = { happy:"🦤", ok:"🦤", grumpy:"💢", away:"❓" };
const PET_MOOD_TEXT = {
  happy: "心情很好，一直跟着你转",
  ok:    "还行，但有点想你了",
  grumpy:"在闹脾气，不太理你",
  away:  "不见了……"
};

/* ---------------------------------------------------------------------------
   每天第一次打开游戏时结算：亲密度衰减 → 闹脾气搞破坏 → 太久不理就走掉
   （跟 runDailyPayout 一起在 init 里调一次）
   --------------------------------------------------------------------------- */
function petDailyTick(){
  const p = ensurePet();
  const today = todayStr();
  if(p.lastTick === today) return null;
  // 第一次玩：只记下日期，不结算
  if(!p.lastTick){ p.lastTick = today; saveState(); return null; }

  const report = { decayed:0, event:null, ranAway:false, wasAway:p.away };
  if(p.away){ p.lastTick = today; saveState(); return report; }

  p.bond = Math.max(0, p.bond - CONFIG.petDailyDecay);
  report.decayed = CONFIG.petDailyDecay;

  if(p.bond <= 0){
    p.zeroDays++;
    if(p.zeroDays >= CONFIG.petRunAwayAfterDays){
      p.away = true;
      report.ranAway = true;
    }
  }else{
    p.zeroDays = 0;
  }

  // 闹脾气就搞点破坏 —— 但每一样都是能花钱结清的账
  if(!p.away && petMood() === "grumpy"){
    if(Math.random() < 0.5){
      p.trash++;
      report.event = { kind:"trash", text:"它把垃圾扔了一地" };
    }else{
      const take = Math.min(state.base.coins, CONFIG.petStealAmount);
      state.base.coins -= take;
      report.event = { kind:"steal", amount:take, text:`它偷偷花掉了你 ${take} 星球币` };
    }
  }
  p.lastEvent = report.event;
  p.lastTick = today;
  saveState();
  return report;
}

/* ---------------------------------------------------------------------------
   互动
   每个动作都返回 { ok, msg, oxygen? }，由 ui 负责演出来
   --------------------------------------------------------------------------- */

// 🤗 抱一抱：每天一次。**只有它心情好的时候才给氧气** ——
// 这就是「平时对它好 → 关键时刻它救你」那条因果链的落点。
function petHug(){
  const p = ensurePet();
  const today = todayStr();
  if(p.away) return { ok:false, msg:`${p.name}不在……先去把它找回来吧。` };
  if(p.hugUsedOn === today) return { ok:false, msg:"今天已经抱过啦，明天再来～" };

  const moodBefore = petMood();
  p.hugUsedOn = today;
  p.bond = Math.min(CONFIG.petBondMax, p.bond + CONFIG.petHugBond);
  saveState();

  if(moodBefore === "grumpy")
    return { ok:true, oxygen:0, msg:`${p.name}扭头躲开了。它还在生气 —— 先喂喂它吧。` };
  if(moodBefore !== "happy")
    return { ok:true, oxygen:0, msg:`${p.name}靠了过来，但没什么精神。多陪陪它，它心情好的时候会给你氧气。` };

  // 心情好 → 给氧气
  const s = state.session;
  const before = s.oxygen;
  s.oxygen = Math.min(oxygenCap(), s.oxygen + CONFIG.petHugOxygen);
  const gained = s.oxygen - before;
  saveState();
  return gained > 0
    ? { ok:true, oxygen:gained, msg:`${p.name}蹭了蹭你，从羽毛里抖出一小罐氧气。＋${gained} 格！` }
    : { ok:true, oxygen:0, msg:`${p.name}蹭了蹭你。氧气已经满了，它把小罐子又收回去了。` };
}

// 🍃 喂食：花钱，涨得最多，不限次数（钱的出口之一）
function petFeed(){
  const p = ensurePet();
  if(p.away) return { ok:false, msg:`${p.name}不在……` };
  if(state.base.coins < CONFIG.petFeedCost)
    return { ok:false, msg:`星球币不够（要 ${CONFIG.petFeedCost}）。` };
  state.base.coins -= CONFIG.petFeedCost;
  p.bond = Math.min(CONFIG.petBondMax, p.bond + CONFIG.petFeedBond);
  p.fedOn = todayStr();
  p.zeroDays = 0;
  saveState();
  return { ok:true, msg:`${p.name}吃得头一点一点的，尾巴翘起来了。` };
}

// 💬 说「很想你」：不花钱，每天一次。纯粹是话。
function petMissYou(){
  const p = ensurePet();
  const today = todayStr();
  if(p.away) return { ok:false, msg:`${p.name}听不见……` };
  if(p.missYouUsedOn === today) return { ok:false, msg:"今天已经说过啦。" };
  p.missYouUsedOn = today;
  p.bond = Math.min(CONFIG.petBondMax, p.bond + CONFIG.petMissYouBond);
  saveState();
  return { ok:true, msg:`${p.name}歪着头看了你很久。` };
}

// 🧹 清垃圾：它闹脾气扔的，花钱结清，办完就翻篇
function petCleanTrash(){
  const p = ensurePet();
  if(p.trash <= 0) return { ok:false, msg:"没有要清理的。" };
  if(state.base.coins < CONFIG.petTrashCleanCost)
    return { ok:false, msg:`星球币不够（要 ${CONFIG.petTrashCleanCost}）。` };
  state.base.coins -= CONFIG.petTrashCleanCost;
  p.trash--;
  saveState();
  return { ok:true, msg:"收拾干净了。" };
}

/* 🔍 把它找回来。
   ⚠️ 离家出走必须可逆 —— 痛感全在，但门要留着。
   10 岁孩子对「永久失去」的承受力有限，而且宠物真走了，游戏少一根乐趣支柱。 */
function petFetchBack(){
  const p = ensurePet();
  if(!p.away) return { ok:false, msg:"它就在你旁边呀。" };
  if(state.base.coins < CONFIG.petFetchBackCost)
    return { ok:false, msg:`找它要花 ${CONFIG.petFetchBackCost} 星球币，先攒一攒。` };
  state.base.coins -= CONFIG.petFetchBackCost;
  p.away = false;
  p.zeroDays = 0;
  p.bond = CONFIG.petReturnBond;   // 回来了，但还在闹脾气
  saveState();
  return { ok:true, msg:`你在岛的另一头找到了${p.name}。它跟你回来了，但一路上都没看你。` };
}

function petRename(newName){
  const p = ensurePet();
  const n = (newName || "").trim().slice(0, 8);
  if(!n) return false;
  p.name = n;
  saveState();
  return true;
}
