"use strict";
/* ============================================================================
   data.js —— 所有可调数值、词库、设施表都在这里
   改这个文件就能改游戏手感，不用碰任何逻辑代码。
   ============================================================================ */

const CONFIG = {

  /* ---------- 一局的规模 ---------- */
  wordsPerSession: 15,      // 一局几个词
  extendCount: 5,           // 「再练几个」一次加几个
  lowBankWarnAt: 15,        // 今日词数少于这个值就提示「词库快空啦」

  /* ---------- 🫧 氧气（生命值） ---------- */
  oxygenMax: 16,            // 每局开局几格氧气（第一版没有任何补氧途径，所以给得宽；
                            //  宠物和补给舱上线后可以往下调）
  oxygenLowAt: 3,           // 剩几格开始闪红报警

  /* ---------- ⭐ 星星评分 ----------
     设计意图：氧气管「能不能活下来」，星星管「打得漂不漂亮」，这是两件事。
     所以「收获分」的保底必须压低 —— 否则只要做完就自动三星，
     星星又会退化成天天满星，跟旧版一个毛病。
     满分 106：氧气 36 + 收获 30 + 零失误 40                                   */
  scorePerOxygen: 3,        // 每格剩余氧气得几分（12 格 = 36）
  scorePerHarvest: 2,       // 每收获一个词得几分（15 个 = 30）
  scorePerPerfect: 5,       // 每个零失误掌握的词得几分
  perfectCap: 8,            // 零失误最多算几个（8 个 = 40）
  starThresholds: [35, 55, 75],   // [1星门槛, 2星门槛, 3星门槛]

  /* ---------- 🪙 经济 ---------- */
  coinPerCorrect: 1,        // 试玩起始值：无植物生长的正确动作立即给币，可按试玩调整
  coinPerHarvest: 10,       // 试玩沿用原收获数额，可按试玩调整

  /* ⛽ 燃料：机器越多烧得越快，这是主要的钱坑。
     一台设施 6 格 × 5 币 = 30 币/天。
     ⚠️ 设施的日产出必须**大于**它的燃料钱，否则造了反而亏，没人会造。 */
  fuelPrice: 5,             // 一格燃料多少币
  fuelPerFacilityPerDay: 6, // 每台设施每天烧几格燃料
  fuelBuyBatch: 20,         // 「加燃料」按钮一次买几格



  /* ---------- 🦤 多多鸟 ----------
     它不产粮、不产钱、不加任何收益。它唯一给你的东西是「命」（氧气）——
     而氧气是这个游戏里最贵、钱买不到的东西。
     「情绪价值为什么叫价值」这一课，靠这条闭环。                          */
  petBondMax: 10,
  petBondStart: 6,
  petDailyDecay: 1,       // 一天不理它，亲密度掉几点
  petHappyAt: 7,          // 亲密度 ≥ 这个数 = 开心（抱一抱才有氧气）
  petGrumpyAt: 3,         // 亲密度 < 这个数 = 闹脾气（开始搞破坏）
  petHugBond: 1,          // 抱一抱涨几点亲密度
  petHugOxygen: 1,        // 抱一抱回几格氧气（只在它开心时）
  petMissYouBond: 1,      // 说「很想你」涨几点（每天一次）
  petFeedCost: 25,        // 喂一次多少星球币
  petFeedBond: 3,         // 喂一次涨几点
  petTrashCleanCost: 15,  // 清理它扔的垃圾多少钱
  petStealAmount: 12,     // 它偷偷花掉多少钱
  /* 🦤 来串门：平时它不在场 —— 一直在就不稀罕了。
     一局里随机挑一个时刻跑出来，头上冒抱抱符号，有倒计时。
     没在窗口里抓住它，它就走了，今天的氧气也就没了。          */
  petVisitAfterMin: 3,    // 答完第几个任务之后才可能来（随机区间）
  petVisitAfterMax: 8,
  petVisitSeconds: 22,    // 出现之后给几秒去抱它

  petRunAwayAfterDays: 3, // 亲密度归零后，再过几天它就离家出走
  petFetchBackCost: 120,  // 把它找回来多少钱
  petReturnBond: 3,       // 找回来之后从几点开始（还在闹脾气）

  /* ---------- ⏱️ 答题 ---------- */
  secsPerLetter: 6,         // 每个字母给几秒（限时 = 词长 × 这个数）
  wrongStreakLimit: 3,      // 普通轮次连错几次判「需要讲解」
  ltmStreakLimit: 1,        // 长时记忆抽查只给几次机会
  recheckGap: 2,            // 隔词复查要隔开几个别的任务
};

/* ============================================================================
   🏭 设施表
   新设施解锁待定；现有设施效果与已建记录保留。
   ============================================================================ */

const FACILITIES = [
  {
    id: "irrigator",
    icon: "💧",
    name: "自动灌溉机",
    unlockPending: true,
    desc: "每天自动产出 60 星球币（扣掉燃料净赚 30）",
    effect: { dailyCoins: 60 }
  },
  {
    id: "oxygenizer",
    icon: "🫧",
    name: "制氧机",
    unlockPending: true,
    desc: "每天开局多 2 格氧气 —— 买的是命，不是钱",
    effect: { bonusOxygen: 2 }
  },
  {
    id: "greenhouse",
    icon: "🌱",
    name: "高产温室",
    unlockPending: true,
    desc: "每次收获的星球币翻倍",
    effect: { harvestMultiplier: 2 }
  }

];

/* ============================================================================
   🧑‍🚀 头像（用星球币买）
   ============================================================================ */

const AVATAR_CATALOG = [
  { emoji: "🧑‍🚀", cost: 0 },
  { emoji: "👩‍🚀", cost: 30 },
  { emoji: "🛸", cost: 60 },
  { emoji: "🤖", cost: 90 },
  { emoji: "🪐", cost: 120 },
  { emoji: "🚀", cost: 160 },
  { emoji: "🌌", cost: 200 },
  { emoji: "☄️", cost: 260 },
  { emoji: "🛰️", cost: 320 },
  { emoji: "👽", cost: 400 },
  { emoji: "🦖", cost: 500 },
  { emoji: "👑", cost: 700 }
];
const DEFAULT_AVATAR = AVATAR_CATALOG[0].emoji;

/* ============================================================================
   📖 默认词库
   格式：[英文, 中文, [音节]]
   ⚠️ 大小写原样保留（May 是专有名词，首字母必须大写）
   ============================================================================ */

const DEFAULT_WORDS = [
  // —— 家长提供的真实词表 ——
  ["friend","朋友",["fr","iend"]],
  ["May","五月",["M","ay"]],
  ["kitchen","厨房",["kit","chen"]],
  ["ride","骑",["r","ide"]],
  ["skip","跳绳",["sk","ip"]],
  ["button","纽扣",["but","ton"]],
  ["pupil","小学生",["pu","pil"]],
  ["guest","客人",["gu","est"]],
  ["neck","脖子",["n","eck"]],
  ["dream","梦想",["dr","eam"]],
  ["pencil","铅笔",["pen","cil"]],
  ["spring","春天",["spr","ing"]],
  ["face","脸",["f","ace"]],
  ["puppets","玩偶",["pup","pets"]],
  ["family","家庭",["fa","mi","ly"]],
  ["butter","黄油",["but","ter"]],
  // —— 内置示例词 ——
  ["teacher","老师",["tea","cher"]],
  ["student","学生",["stu","dent"]],
  ["mother","妈妈",["mo","ther"]],
  ["father","爸爸",["fa","ther"]],
  ["sister","姐妹",["sis","ter"]],
  ["brother","兄弟",["bro","ther"]],
  ["apple","苹果",["ap","ple"]],
  ["orange","橙子",["or","ange"]],
  ["banana","香蕉",["ba","na","na"]],
  ["grape","葡萄",["gr","ape"]],
  ["water","水",["wa","ter"]],
  ["flower","花",["flow","er"]],
  ["happy","开心的",["hap","py"]],
  ["sunny","晴朗的",["sun","ny"]],
  ["rainy","下雨的",["rain","y"]],
  ["cloudy","多云的",["cloud","y"]],
  ["windy","有风的",["win","dy"]],
  ["school","学校",["sch","ool"]],
  ["book","书",["bo","ok"]],
  ["cloud","云",["cl","oud"]]
];

const STORAGE_KEY = "planet_state_v1";

// 旧版《单词默写闯关》的存档键。两个键不一样，所以新旧两个游戏可以并存，
// 孩子继续玩旧版、家长同时测新版，谁也覆盖不了谁。
// 家长设置里的「从旧版搬家」会读这个键，把单词连同掌握进度一起搬过来。
const LEGACY_STORAGE_KEY = "wdg_state_v2";
