// ============================================================================
// tarot/cardData.js —— 78 张塔罗牌数据
// ----------------------------------------------------------------------------
// 结构说明：
//   Major Arcana（大阿卡纳）22 张逐张手写，包含完整的正位/逆位关键词与牌面意象。
//   Minor Arcana（小阿卡纳）56 张由「花色 × 点数」组合生成，
//   花色提供领域基调，点数提供阶段语义，两者拼合即得到一张完整的小牌含义。
// 每张牌的数据字段：
//   id          全局唯一编号 0~77
//   arcana      'major' | 'minor'
//   name        中文牌名
//   en          英文牌名
//   roman       罗马数字（仅大阿卡纳）
//   sigil       符号绘制标识（仅大阿卡纳，对应 CardTextures 中的符号表）
//   suit        花色键（major / wands / cups / swords / pentacles）
//   suitGlyph   花色符号标识（小阿卡纳使用）
//   element     元素属性（火 / 水 / 风 / 土 / 灵）
//   rank        点数（1~14，11~14 为宫廷牌；大阿卡纳为 0）
//   rankLabel   牌面顶部显示的编号文字
//   upright     正位关键词数组
//   reversed    逆位关键词数组
//   essence     一句话牌面意象（用于解读文本的“骨架句”）
// ============================================================================

// ---------------------------------------------------------------------------
// 大阿卡纳：22 张主牌
// ---------------------------------------------------------------------------
export const MAJOR_ARCANA = [
  {
    // 全局编号
    id: 0,
    // 属于大阿卡纳
    arcana: 'major',
    // 中文牌名
    name: '愚者',
    // 英文牌名
    en: 'The Fool',
    // 罗马数字
    roman: '0',
    // 牌面符号
    sigil: 'rose',
    // 所属花色（大阿卡纳统一为 major）
    suit: 'major',
    // 元素属性
    element: '风',
    // 点数（大阿卡纳记 0）
    rank: 0,
    // 顶部编号文字
    rankLabel: '0',
    // 正位关键词
    upright: ['全新的开始', '纵身一跃的勇气', '天真与信任', '未知的旅程'],
    // 逆位关键词
    reversed: ['鲁莽冲动', '裹足不前', '时机未熟', '盲目的乐观'],
    // 画面描述：大阿卡纳本身就是一句成型的画面，与 essence 共用
    scene: null,
    // 牌面意象
    essence: '愚者站在悬崖边缘，行囊轻得只装得下好奇心——他是尚未落笔的可能性本身。',
  },
  {
    id: 1,
    arcana: 'major',
    name: '魔术师',
    en: 'The Magician',
    roman: 'I',
    sigil: 'infinity',
    suit: 'major',
    element: '风',
    rank: 0,
    rankLabel: 'I',
    upright: ['资源就位', '主动创造', '专注的意志', '把想法变成现实'],
    reversed: ['空谈不落地', '能力被浪费', '操弄与欺瞒', '自我怀疑'],
    essence: '桌上四样法器一应俱全，魔术师唯一要做的只是抬手——万物早已备好，只等一个决定。',
  },
  {
    id: 2,
    arcana: 'major',
    name: '女祭司',
    en: 'The High Priestess',
    roman: 'II',
    sigil: 'veil',
    suit: 'major',
    element: '水',
    rank: 0,
    rankLabel: 'II',
    upright: ['内在直觉', '尚未揭晓的真相', '沉静的观察', '潜意识的讯息'],
    reversed: ['忽视直觉', '被表象蒙蔽', '秘密的负担', '与内心失联'],
    essence: '女祭司坐在帷幕之前，那卷律法书她读过却不说——有些答案必须自己想起来。',
  },
  {
    id: 3,
    arcana: 'major',
    name: '皇后',
    en: 'The Empress',
    roman: 'III',
    sigil: 'wheat',
    suit: 'major',
    element: '土',
    rank: 0,
    rankLabel: 'III',
    upright: ['丰饶与滋养', '感官的愉悦', '创作力旺盛', '被爱包围'],
    reversed: ['过度付出', '创造力阻塞', '忽略自我照顾', '依赖与索取'],
    essence: '皇后身边的麦子熟了一轮又一轮，她从不催促生长，只是把土壤照顾好。',
  },
  {
    id: 4,
    arcana: 'major',
    name: '皇帝',
    en: 'The Emperor',
    roman: 'IV',
    sigil: 'crown',
    suit: 'major',
    element: '火',
    rank: 0,
    rankLabel: 'IV',
    upright: ['结构化的秩序', '掌控局面', '责任与担当', '长远的规划'],
    reversed: ['僵化固执', '控制欲过强', '权威失落', '缺乏纪律'],
    essence: '皇帝的宝座由石头凿成，稳固得让人安心，也沉重得让人忘记怎么起身。',
  },
  {
    id: 5,
    arcana: 'major',
    name: '教皇',
    en: 'The Hierophant',
    roman: 'V',
    sigil: 'key',
    suit: 'major',
    element: '土',
    rank: 0,
    rankLabel: 'V',
    upright: ['正统的指引', '既有的规则', '师承与承诺', '被认可的路径'],
    reversed: ['墨守成规', '形式大于内容', '叛逆出格', '被规条束缚'],
    essence: '教皇手里那把钥匙能打开正门，但真正的修行从来发生在门后独自一人的时刻。',
  },
  {
    id: 6,
    arcana: 'major',
    name: '恋人',
    en: 'The Lovers',
    roman: 'VI',
    sigil: 'heart',
    suit: 'major',
    element: '风',
    rank: 0,
    rankLabel: 'VI',
    upright: ['深刻的联结', '忠于内心的选择', '价值一致', '彼此的坦诚'],
    reversed: ['价值观分歧', '逃避选择', '关系失衡', '诱惑与动摇'],
    essence: '恋人牌讲的不只是相爱，而是在两个都舍不得的选项里，终于认清自己是谁。',
  },
  {
    id: 7,
    arcana: 'major',
    name: '战车',
    en: 'The Chariot',
    roman: 'VII',
    sigil: 'chariot',
    suit: 'major',
    element: '水',
    rank: 0,
    rankLabel: 'VII',
    upright: ['坚定的推进', '意志的胜利', '明确的方向感', '克服阻力'],
    reversed: ['失控的冲劲', '方向不明', '内耗与拉扯', '半途而废'],
    essence: '战车由两只方向相反的神兽拉动，驾驭的秘诀不是用力，而是让它们朝同一个念头奔跑。',
  },
  {
    id: 8,
    arcana: 'major',
    name: '力量',
    en: 'Strength',
    roman: 'VIII',
    sigil: 'flame',
    suit: 'major',
    element: '火',
    rank: 0,
    rankLabel: 'VIII',
    upright: ['温柔的坚定', '内在的韧性', '耐心的驯服', '以柔克刚'],
    reversed: ['自我怀疑', '情绪失控', '逞强与硬撑', '耐力耗尽'],
    essence: '少女合上狮子的嘴，靠的不是蛮力——真正强大的人从不需要证明自己强大。',
  },
  {
    id: 9,
    arcana: 'major',
    name: '隐者',
    en: 'The Hermit',
    roman: 'IX',
    sigil: 'lantern',
    suit: 'major',
    element: '土',
    rank: 0,
    rankLabel: 'IX',
    upright: ['向内求索', '独处的价值', '经验的指引', '看清本质'],
    reversed: ['过度封闭', '与外界脱节', '逃避现实', '拒绝求助'],
    essence: '隐者的灯只照亮脚下三尺，但他走得比谁都远——因为他从不浪费光在别处。',
  },
  {
    id: 10,
    arcana: 'major',
    name: '命运之轮',
    en: 'Wheel of Fortune',
    roman: 'X',
    sigil: 'wheel',
    suit: 'major',
    element: '火',
    rank: 0,
    rankLabel: 'X',
    upright: ['周期性的转折', '顺势而为', '新的契机', '时运轮转'],
    reversed: ['逆势而行', '停滞不前', '重复旧模式', '时机不由人'],
    essence: '命运之轮一直在转，唯一不变的是它总会转回来——问题是那时你是否还在原地。',
  },
  {
    id: 11,
    arcana: 'major',
    name: '正义',
    en: 'Justice',
    roman: 'XI',
    sigil: 'scales',
    suit: 'major',
    element: '风',
    rank: 0,
    rankLabel: 'XI',
    upright: ['客观的权衡', '因果分明', '做出公平决断', '为选择负责'],
    reversed: ['偏颇的判断', '逃避责任', '隐情未明', '立场摇摆'],
    essence: '正义的天平不会偏袒任何人，它只是把每一个选择的分量如实呈上。',
  },
  {
    id: 12,
    arcana: 'major',
    name: '倒吊人',
    en: 'The Hanged Man',
    roman: 'XII',
    sigil: 'invertedTriangle',
    suit: 'major',
    element: '水',
    rank: 0,
    rankLabel: 'XII',
    upright: ['主动的等待', '换一个角度', '必要的牺牲', '顿悟前的静默'],
    reversed: ['无谓的拖延', '拒绝转变', '牺牲不被看见', '困在原地'],
    essence: '倒吊人表情平静，因为他发现倒过来看时，世界并没有变，变的是自己紧抓不放的东西。',
  },
  {
    id: 13,
    arcana: 'major',
    name: '死神',
    en: 'Death',
    roman: 'XIII',
    sigil: 'scythe',
    suit: 'major',
    element: '水',
    rank: 0,
    rankLabel: 'XIII',
    upright: ['彻底的结束', '蜕变的关口', '放下旧的自己', '不可逆的转折'],
    reversed: ['抗拒改变', '拖泥带水', '停滞与腐朽', '旧事纠缠'],
    essence: '死神收割的不是生命，而是已经死去却舍不得放手的那部分——收割之后，土地才有空。',
  },
  {
    id: 14,
    arcana: 'major',
    name: '节制',
    en: 'Temperance',
    roman: 'XIV',
    sigil: 'chaliceFlow',
    suit: 'major',
    element: '火',
    rank: 0,
    rankLabel: 'XIV',
    upright: ['耐心调和', '恰到好处的分寸', '长期的磨合', '身心的平衡'],
    reversed: ['过度与失衡', '急于求成', '配合不良', '消耗与透支'],
    essence: '节制天使让水在两杯之间来回流动，从不高低失衡——她最懂什么叫不多不少。',
  },
  {
    id: 15,
    arcana: 'major',
    name: '恶魔',
    en: 'The Devil',
    roman: 'XV',
    sigil: 'invertedStar',
    suit: 'major',
    element: '土',
    rank: 0,
    rankLabel: 'XV',
    upright: ['难以挣脱的执念', '欲望的捆绑', '隐蔽的依赖', '不健康的模式'],
    reversed: ['挣脱枷锁', '看清真相', '戒断成功', '重获自主'],
    essence: '恶魔脚边的锁链松松散散地挂着——原来让两个人留下不走的，从来都不是锁。',
  },
  {
    id: 16,
    arcana: 'major',
    name: '高塔',
    en: 'The Tower',
    roman: 'XVI',
    sigil: 'tower',
    suit: 'major',
    element: '火',
    rank: 0,
    rankLabel: 'XVI',
    upright: ['突如其来的崩解', '根基被击穿', '真相的冲击', '不得不重建'],
    reversed: ['延迟的崩塌', '内部的松脱', '有惊无险', '逃避已现的裂缝'],
    essence: '高塔被雷劈中的那一瞬最可怕，但塔上原本就裂开的缝，早在风暴之前就已经存在。',
  },
  {
    id: 17,
    arcana: 'major',
    name: '星星',
    en: 'The Star',
    roman: 'XVII',
    sigil: 'star8',
    suit: 'major',
    element: '风',
    rank: 0,
    rankLabel: 'XVII',
    upright: ['风暴后的平静', '希望与疗愈', '被照亮的方向', '坦然的给予'],
    reversed: ['信心动摇', '希望渺茫', '疗愈受阻', '过度理想化'],
    essence: '星星出现在高塔倾颓之后：她什么也没说，只是把水倒回池里，把光留在天上。',
  },
  {
    id: 18,
    arcana: 'major',
    name: '月亮',
    en: 'The Moon',
    roman: 'XVIII',
    sigil: 'moon',
    suit: 'major',
    element: '水',
    rank: 0,
    rankLabel: 'XVIII',
    upright: ['尚未清晰的迷雾', '潜意识的低语', '不安与想象', '需要直觉引路'],
    reversed: ['迷雾散去', '误会澄清', '看清幻象', '情绪回声'],
    essence: '月光下的路看起来坑坑洼洼，第二天太阳升起，人们才发现那只是树影。',
  },
  {
    id: 19,
    arcana: 'major',
    name: '太阳',
    en: 'The Sun',
    roman: 'XIX',
    sigil: 'sun',
    suit: 'major',
    element: '火',
    rank: 0,
    rankLabel: 'XIX',
    upright: ['毫无遮拦的明朗', '成功与喜悦', '坦诚的自信', '被看见的成果'],
    reversed: ['光芒被遮蔽', '过度乐观', '喜悦打了折', '自我中心'],
    essence: '太阳底下没有新鲜事，也没有藏得住的事——孩子骑白马走过，一切坦坦荡荡。',
  },
  {
    id: 20,
    arcana: 'major',
    name: '审判',
    en: 'Judgement',
    roman: 'XX',
    sigil: 'ankh',
    suit: 'major',
    element: '火',
    rank: 0,
    rankLabel: 'XX',
    upright: ['清算与觉醒', '过去的回响', '重新被召唤', '做出最终判断'],
    reversed: ['逃避自省', '旧账未了', '迟迟不下决定', '自我批判过重'],
    essence: '号角响起的时刻，人们从土里站起——不是被审判，而是终于敢回望自己做过的一切。',
  },
  {
    id: 21,
    arcana: 'major',
    name: '世界',
    en: 'The World',
    roman: 'XXI',
    sigil: 'wreath',
    suit: 'major',
    element: '灵',
    rank: 0,
    rankLabel: 'XXI',
    upright: ['一个循环的圆满', '整合与完成', '被承认的阶段性成果', '回归与再出发'],
    reversed: ['收尾拖沓', '差临门一脚', '难以真正结束', '成就感缺位'],
    essence: '世界牌里的舞者在花环中起舞，她脚下的路已经走完——而她正把目光投向花环之外。',
  },
];

// ---------------------------------------------------------------------------
// 小阿卡纳：四大花色的基调定义
// ---------------------------------------------------------------------------
export const SUITS = [
  {
    // 花色键，与配色表和符号表对应
    key: 'wands',
    // 中文花色名
    name: '权杖',
    // 英文花色名
    en: 'Wands',
    // 花色符号标识
    glyph: 'staff',
    // 元素
    element: '火',
    // 领域基调：这个花色管的是什么
    domain: '行动、热情与创造',
    // 领域描述句，用于拼接牌义
    domainLine: '它落在「行动」这一域',
    // 花色正面倾向
    positive: '推进力与热度',
    // 花色负面倾向
    negative: '急躁与燃尽',
  },
  {
    key: 'cups',
    name: '圣杯',
    en: 'Cups',
    glyph: 'cup',
    element: '水',
    domain: '情感、关系与直觉',
    domainLine: '它落在「情感」这一域',
    positive: '连结与共情',
    negative: '沉溺与逃避',
  },
  {
    key: 'swords',
    name: '宝剑',
    en: 'Swords',
    glyph: 'sword',
    element: '风',
    domain: '思维、沟通与决断',
    domainLine: '它落在「思维」这一域',
    positive: '清醒与锋利',
    negative: '割裂与消耗',
  },
  {
    key: 'pentacles',
    name: '星币',
    en: 'Pentacles',
    glyph: 'pentacle',
    element: '土',
    domain: '物质、身体与积累',
    domainLine: '它落在「现实」这一域',
    positive: '稳固与产出',
    negative: '停滞与匮乏感',
  },
];

// ---------------------------------------------------------------------------
// 小阿卡纳：点数定义（1~10 为数字牌，11~14 为宫廷牌）
// ---------------------------------------------------------------------------
export const RANKS = [
  {
    // 点数
    rank: 1,
    // 牌面显示编号
    label: 'A',
    // 中文点数名
    name: '王牌',
    // 正位关键词
    upright: ['全新的契机', '纯粹的能量涌现', '值得把握的开端', '天赐的种子'],
    // 逆位关键词
    reversed: ['时机未到', '能量涣散', '错失的开端', '方向尚未成形'],
    // 意象骨架
    essence: '一股最原始的能量喷薄而出，它还没有形状，却已经决定了后面所有的走向。',
  },
  {
    rank: 2,
    label: 'II',
    name: '二',
    upright: ['需要权衡的两个选项', '初显的平衡', '等待的间隙', '双向的可能'],
    reversed: ['摇摆不定', '失衡', '被迫的选择', '信息不足'],
    essence: '两个筹码握在手里，重量差不多——真正的难题不是选哪个，而是承认必须选一个。',
  },
  {
    rank: 3,
    label: 'III',
    name: '三',
    upright: ['初步的成果', '协作与扩展', '看到轮廓', '外部回响'],
    reversed: ['进度受阻', '协作失和', '成果被稀释', '预期落空'],
    essence: '第三样东西出现了，原本一对一的关系变成了结构——结构一开始总是摇摇晃晃。',
  },
  {
    rank: 4,
    label: 'IV',
    name: '四',
    upright: ['稳固的停顿', '既得的保全', '必要的休整', '构筑地基'],
    reversed: ['过度保守', '错失流动', '抓住不放', '倦怠与停滞'],
    essence: '四是桌子的四条腿：稳当，也意味着不再改变姿势——安稳与停滞常常是同一件事。',
  },
  {
    rank: 5,
    label: 'V',
    name: '五',
    upright: ['冲突与失落', '资源的短缺感', '被排除的体验', '必须面对的缺口'],
    reversed: ['裂痕开始愈合', '找回资源', '走出低谷', '学会求助'],
    essence: '五总是打破四的安稳：缺口出现了，而缺口同时也是光进来的地方。',
  },
  {
    rank: 6,
    label: 'VI',
    name: '六',
    upright: ['恢复与修补', '善意的流动', '阶段性的和解', '被给予的支持'],
    reversed: ['旧伤复发', '付出不对等', '停留于怀旧', '难以真正翻篇'],
    essence: '六带来了修复——不是抹掉过去，而是终于可以带着过去继续往前走。',
  },
  {
    rank: 7,
    label: 'VII',
    name: '七',
    upright: ['需要判断的局面', '隐藏的变量', '坚持与取舍', '策略性的思考'],
    reversed: ['判断失误', '自欺欺人', '用力方向错了', '耐心告罄'],
    essence: '七是必须停下来做判断的关口：往前走需要勇气，但看清方向需要诚实。',
  },
  {
    rank: 8,
    label: 'VIII',
    name: '八',
    upright: ['快速的推进', '技能的熟练', '势能的积累', '接近临界点'],
    reversed: ['推进受阻', '重复劳动', '力量分散', '节奏被打乱'],
    essence: '八是力量开始成形的阶段——之前所有的练习，此刻开始连成一条线。',
  },
  {
    rank: 9,
    label: 'IX',
    name: '九',
    upright: ['接近完成', '独自承担的重量', '收获前的最后一段', '内在的满足'],
    reversed: ['差一步', '焦虑与失眠', '过度防备', '成果被高估'],
    essence: '九是收获前的最后一里路，也是心最累的时候——因为看得见终点，反而更难熬。',
  },
  {
    rank: 10,
    label: 'X',
    name: '十',
    upright: ['一个周期的终点', '满载的结果', '责任的重量', '下一轮的开始'],
    reversed: ['不堪重负', '难以收尾', '成果变成负担', '拒绝结束'],
    essence: '十把一条路走到了尽头，值得庆贺，也需要承认：有些东西该留在这一轮里。',
  },
  {
    rank: 11,
    label: '侍从',
    name: '侍从',
    upright: ['好奇的初学者', '新的讯息', '愿意尝试的心', '尚未成熟的热忱'],
    reversed: ['三分钟热度', '幼稚与轻率', '消息延迟', '缺乏准备'],
    essence: '侍从是这条花色之路的入门者：他捧着符号有点手忙脚乱，但眼睛是亮的。',
  },
  {
    rank: 12,
    label: '骑士',
    name: '骑士',
    upright: ['义无反顾的行动', '把能量推出去', '极致的投入', '冒险与迁徙'],
    reversed: ['莽撞冒进', '方向偏执', '中途折返', '过犹不及'],
    essence: '骑士是花色能量的加速器：他一定会动，问题只在于他有没有看清要去向何方。',
  },
  {
    rank: 13,
    label: '王后',
    name: '王后',
    upright: ['成熟的内在掌握', '滋养与包容', '直觉性的智慧', '让人安心的在场'],
    reversed: ['情绪化', '过度介入', '忽视自身需求', '内在匮乏'],
    essence: '王后不靠命令而靠理解运作：她把整个花色的能量收进心里，再从心里给出去。',
  },
  {
    rank: 14,
    label: '国王',
    name: '国王',
    upright: ['成熟的掌控', '为结果负责', '稳定的输出', '被信赖的判断'],
    reversed: ['专断', '控制过度', '僵化', '以权威代替沟通'],
    essence: '国王站在花色能量最成熟的位置：他不再争取掌控，因为他已经掌控。',
  },
];

// ---------------------------------------------------------------------------
// 小阿卡纳的画面描述表
// ---------------------------------------------------------------------------
// 小阿卡纳有 56 张，如果按「花色 × 点数」机械拼接意象句，解读会立刻显出模板感
// （「它落在行动这一域。一股最原始的能量喷薄而出……」——读十张都是一个调子）。
// 因此这 56 句全部手写：每一句都对应韦特牌面上真实画着的场景，
// 让每张牌在解读里都有一句无法被别张牌替换掉的话。
export const MINOR_SCENES = {
  wands: {
    1: '一根新生的木杖从云中伸出的手里长出，枝头鼓着还没展开的芽。',
    2: '一个人站在城墙上，一手握杖，另一根杖被固定在身后，他的眼睛望着海面。',
    3: '三根杖插在崖边，一个人背对海面，看着船队正驶向远处。',
    4: '四根杖撑起一座花环拱门，两个人举着花束从门下走过。',
    5: '五个年轻人各举一根杖互相挥舞，动作很乱，却没有人真的打在谁身上。',
    6: '一个戴桂冠的骑手穿过人群，他手里的杖上系着花环，周围的人也在举杖。',
    7: '一个人站在高地上，把一根杖横在身前，独自面对下方同时刺来的六根。',
    8: '八根杖斜着飞过天空，下面是河流与缓坡，画面上没有一个人。',
    9: '一个头上缠着绷带的人握着一根杖，背后八根杖像篱笆一样立着，等他再往前走。',
    10: '一个人弯着腰，怀里搂着十根杖，前方的城门已经很近了。',
    11: '一个年轻人站在荒漠里，双手捧着一根刚发芽的杖，认真得有点笨拙。',
    12: '骑士的披风被风整个扯开，马的前蹄腾空，他手里的杖还带着火。',
    13: '王后坐在宝座上，一手持杖一手举着向日葵，一只黑猫蹲在她脚边。',
    14: '国王侧身坐在宝座上，脚下趴着一只火蜥蜴，他手里的杖已经长出了叶子。',
  },
  cups: {
    1: '一只圣杯从云中的手里递出来，水从杯口溢出，落进下面浮着睡莲的池子。',
    2: '两个人各自举杯相碰，杯子上方浮起一条双蛇缠绕的杖。',
    3: '三个女子在果园里举杯起舞，脚下的地上散落着刚摘下的果子。',
    4: '一个人坐在树下抱着手臂闭着眼，眼前浮着三只杯子，第四只递到手边他却没有伸手。',
    5: '一个披着黑斗篷的人低头看着地上倒着的三只杯子，身后还稳稳立着两只。',
    6: '一个小孩把装满花的杯子递给另一个更小的孩子，两个人个子都还很矮。',
    7: '云中浮出七只杯子，每一只里装着不同的东西——有城堡、有珠宝，也有一条蛇。',
    8: '一个人背对人群走向远山，身后八只杯子整齐地空着，月亮缺了一块。',
    9: '一个人抱着手臂坐在长桌的末端，身后九只杯子排成一排，他脸上是满足。',
    10: '一对夫妻举着手，十只杯子在空中排成一道彩虹，孩子在旁边转圈。',
    11: '一个年轻人捧着杯子，杯里跳出一条鱼，他惊讶地张着嘴。',
    12: '骑士骑着白马缓缓前行，手里托着杯子，目光并没有看路。',
    13: '王后坐在海边的宝座上，捧着带盖的杯子，正望着它出神。',
    14: '国王坐在波涛之间的宝座上，一手持杯一手持权杖，船在他身后颠簸。',
  },
  swords: {
    1: '一只手从云里握出一把剑，剑尖挑着王冠，山顶的云雾还没有散。',
    2: '一个蒙着眼的女子坐在海边，双手各握一把剑交叉在胸前，背后是一弯月亮。',
    3: '三把剑穿透一颗红心，背景是连绵不断的雨云。',
    4: '一个人躺在石棺上双手合十，墙上挂着三把剑，第四把就摆在他身旁。',
    5: '一个人收起前两把剑，回头看着远处两个正在离开的人，地上还留着三把。',
    6: '一个船夫撑着小船载着六个人渡河，船头插着六把剑。',
    7: '一个人抱走五把剑，回头看着营地里剩下的两把，脚步犹豫。',
    8: '一个女子被八把剑围在中间，蒙着眼，双手被松松地绑着，脚下是泥地。',
    9: '一个人半夜从床上坐起，双手捂着脸，身后的墙上并排挂着九把剑。',
    10: '一个人趴在地上，背上插着十把剑，远处的天边已经开始发亮。',
    11: '一个年轻人站在风口举着剑，姿态很急，像是在防备什么还没出现的东西。',
    12: '骑士俯身策马疾冲，剑举得很高，风向与他一致。',
    13: '王后侧坐在石座上，一手持剑一手向前伸着，神情冷静得像在开庭。',
    14: '国王正面端坐，剑微微倾斜，身后的天空一半晴一半阴。',
  },
  pentacles: {
    1: '一只手从云里托出一枚金币，下方是一座修剪得整整齐齐的花园。',
    2: '一个人耍着两枚金币跳舞，两枚之间连着一条无限循环的带子。',
    3: '一个工匠站在教堂的拱顶上，身旁两个人拿着图纸和他商量。',
    4: '一个人抱着四枚金币坐在城外，城门就在身后，他却搂着不松手。',
    5: '两个人在雪地里走过一扇亮着灯的彩窗，谁也没有抬头。',
    6: '一个人一手持秤一手给跪着的两个人分钱，金币在秤上分得清清楚楚。',
    7: '一个人拄着锄头，看着藤上结出的七枚金币，停了一下。',
    8: '一个工匠坐在凳子上敲打金币，旁边已经挂好了几枚成品。',
    9: '一个女子走在葡萄园里，一只手搁在戴着手套的猎鹰上，园子里结满了果实。',
    10: '一位老人坐在宅邸的院子里，狗趴在他脚边，年轻人正被孩子逗笑。',
    11: '一个年轻人双手托着一枚金币举到眼前，专注地端详，脚下是绿地。',
    12: '骑士骑着一匹静止的黑马，手里托着金币，看着田垄却迟迟没有动。',
    13: '王后坐在长满花草的宝座上，双手轻轻护着膝上的那枚金币。',
    14: '国王坐在葡萄藤缠绕的宝座上，一手按着金币，铠甲下露出华服。',
  },
};

// ---------------------------------------------------------------------------
// 小阿卡纳生成函数：把花色与点数交叉组合成 56 张牌
// ---------------------------------------------------------------------------
function buildMinorArcana() {
  // 存放生成结果
  const cards = [];
  // 小阿卡纳从 id = 22 开始编号
  let id = MAJOR_ARCANA.length;
  // 外层遍历花色，内层遍历点数，保证顺序稳定
  SUITS.forEach((suit) => {
    // 遍历全部 14 个点数
    RANKS.forEach((rankDef) => {
      // 组合出中文牌名，例如「圣杯三」「权杖国王」
      const name = rankDef.rank <= 10 ? `${suit.name}${rankDef.name}` : `${suit.name}${rankDef.name}`;
      // 组合出英文牌名，例如「Three of Cups」
      const en =
        rankDef.rank <= 10
          ? `${numberToWord(rankDef.rank)} of ${suit.en}`
          : `${rankDef.name} of ${suit.en}`;
      // 把生成好的牌推入数组
      cards.push({
        // 自增编号
        id: id++,
        // 属于小阿卡纳
        arcana: 'minor',
        // 中文名
        name,
        // 英文名
        en,
        // 无罗马数字
        roman: '',
        // 无大阿卡纳符号
        sigil: null,
        // 花色键
        suit: suit.key,
        // 花色符号标识
        suitGlyph: suit.glyph,
        // 元素
        element: suit.element,
        // 点数
        rank: rankDef.rank,
        // 顶部编号文字
        rankLabel: rankDef.label,
        // 正位关键词：花色领域 + 点数语义组合
        upright: buildKeywords(suit, rankDef, true),
        // 逆位关键词
        reversed: buildKeywords(suit, rankDef, false),
        // 画面描述：直接取手写的小阿卡纳画面表，保证 56 张各不相同
        scene: MINOR_SCENES[suit.key][rankDef.rank],
        // 意象骨架：花色基调 + 点数语义，与画面描述互补
        essence: `${suit.domainLine}。${rankDef.essence}`,
      });
    });
  });
  // 返回生成结果
  return cards;
}

/**
 * 把一个数字转成英文序数词，用于拼接英文牌名。
 * @param {number} n 1~10
 * @returns {string} 英文单词
 */
function numberToWord(n) {
  // 建立映射表
  const words = ['', 'Ace', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
  // 取映射结果，越界时兜底返回数字字符串
  return words[n] || String(n);
}

/**
 * 组合出小阿卡纳的关键词：把点数语义与花色倾向融合在一起。
 * @param {object} suit 花色定义
 * @param {object} rankDef 点数定义
 * @param {boolean} isUpright 是否为正位
 * @returns {string[]} 关键词数组
 */
function buildKeywords(suit, rankDef, isUpright) {
  // 取基础关键词
  const base = isUpright ? rankDef.upright : rankDef.reversed;
  // 取花色倾向词
  const flavor = isUpright ? suit.positive : suit.negative;
  // 取前三个基础关键词
  const picked = base.slice(0, 3);
  // 把花色倾向词作为最后一个关键词，形成「点数为骨、花色为肉」的组合
  return [...picked, flavor];
}

// ---------------------------------------------------------------------------
// 完整牌库导出
// ---------------------------------------------------------------------------
export const FULL_DECK = [...MAJOR_ARCANA, ...buildMinorArcana()];

/**
 * 按 id 查找一张牌。
 * @param {number} id 牌编号
 * @returns {object|undefined} 卡牌数据
 */
export function getCardById(id) {
  // 线性查找即可，78 条的规模完全不构成性能问题
  return FULL_DECK.find((c) => c.id === id);
}

/**
 * 创建一副洗好的牌。
 * @param {Function} random 随机数函数（可传入带种子的版本以便复现）
 * @returns {object[]} 乱序后的卡牌数组
 */
export function createShuffledDeck(random = Math.random) {
  // 复制一份完整牌库，避免污染原始数据
  const deck = FULL_DECK.slice();
  // Fisher-Yates 洗牌
  for (let i = deck.length - 1; i > 0; i--) {
    // 随机下标
    const j = Math.floor(random() * (i + 1));
    // 交换
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  // 返回洗好的牌
  return deck;
}
