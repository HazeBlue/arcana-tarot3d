// ============================================================================
// reading/ReadingEngine.js —— 解读生成引擎
// ----------------------------------------------------------------------------
// 输入：用户的问题 + 三张已选中的牌（含正逆位）
// 输出：一个结构化的解读对象，UI 直接照着渲染即可
//
// 生成流水线：
//   问题分析 → 建立种子随机数 → 逐张牌分层组装 → 先说结论 → 牌与牌之间的张力
//   → 时间与行动窗口 → 建议与提醒 → 能量评估
//
// 解读文本按「三层叠加」组装，这是让结果不像模板的关键：
//   ① 画面层  —— 每张牌一句专属的画面描述（78 张全部手写，无法互相替换）
//   ② 位置层  —— 这张牌落在「现状 / 转折 / 走向」哪一格意味着什么
//   ③ 领域层  —— 把牌义翻译到用户真正的语境里（十个问题类别 × 五个元素）
// 三层之后再叠加点数与元素的行动提示，并单独成段分析牌与牌之间的关系。
//
// 为什么用「种子随机数」而不是纯随机：
//   同一个问题 + 同一组牌，无论刷新多少次措辞都一致，用户截图分享或回看不会对不上；
//   同时不同问题之间的行文依然多样。
// ============================================================================

// 引入语料
import {
  POSITIONS,
  POSITION_LEADS,
  POSITION_TITLES,
  RANK_HINTS,
  ELEMENT_HINTS,
  ELEMENT_DOMINANCE,
  MAJOR_NOTES,
  WINDOW_SPEED,
  VERDICT_OPEN,
  SYNTHESIS_TEMPLATES,
  ENERGY_LEVELS,
  GENERIC_ADVICE,
  ORIENTATION_TEXT,
  pickElementLens,
} from './meanings.js';
// 引入问题分析器
import { analyzeQuestion } from './QuestionAnalyzer.js';
// 引入数学工具（种子哈希与伪随机）
import { hashString, mulberry32 } from '../core/mathUtils.js';

/**
 * 从数组里按随机数挑一项。
 * @param {Array} arr 候选数组
 * @param {Function} rng 随机数函数
 * @returns {*} 被选中的项
 */
function pick(arr, rng) {
  // 空数组兜底
  if (!arr || !arr.length) return undefined;
  // 按下标取
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

/**
 * 从数组里不重复地挑 n 项。
 * @param {Array} arr 候选数组
 * @param {number} n 数量
 * @param {Function} rng 随机数函数
 * @returns {Array} 结果数组
 */
function pickMany(arr, n, rng) {
  // 复制一份避免污染原数组
  const pool = arr.slice();
  // 结果数组
  const out = [];
  // 逐个挑取
  while (out.length < n && pool.length) {
    // 随机下标
    const i = Math.floor(rng() * pool.length) % pool.length;
    // 取出并移除
    out.push(pool.splice(i, 1)[0]);
  }
  // 返回
  return out;
}

/**
 * 从关键词数组里挑一个与 avoid 不同的词。
 * 小阿卡纳的关键词按点数生成，不同花色的同点数牌首词会重复，
 * 直接用首词拼「起点 X → 终点 X」会出现同词对照的尴尬，因此需要一个去重挑选。
 * @param {string[]} list 关键词数组
 * @param {string|null} avoid 需要避开的词
 * @returns {string} 挑中的关键词
 */
function pickDistinct(list, avoid) {
  // 空数组兜底
  if (!list || !list.length) return '';
  // 优先取第一个不等于 avoid 的词
  for (const word of list) {
    if (word !== avoid) return word;
  }
  // 全部相同则退回第一个
  return list[0];
}

/**
 * 填充模板中的占位符。
 * @param {string} tpl 模板字符串
 * @param {object} vars 变量表
 * @returns {string} 填充后的文本
 */
function fill(tpl, vars) {
  // 逐个替换
  return String(tpl || '').replace(/\{(\w+)\}/g, (m, key) => (vars[key] !== undefined ? String(vars[key]) : m));
}

/**
 * 生成一份完整解读。
 * @param {object} params 入参
 * @param {string} params.question 用户的问题
 * @param {Array<{data:object,isReversed:boolean,slot:number}>} params.selection 三张已选牌
 * @returns {object} 解读结果对象
 */
export function generateReading({ question, selection }) {
  // 分析问题
  const analysis = analyzeQuestion(question);

  // ------------------------------------------------------------------
  // 1. 建立种子随机数：保证「同问题 + 同牌组」结果稳定
  // ------------------------------------------------------------------
  // 拼出种子字符串
  const seedStr = [
    // 清洗后的问题文本
    analysis.text,
    // 每张牌的 id 与正逆位
    ...selection.map((s) => `${s.data.id}${s.isReversed ? 'R' : 'U'}`),
  ].join('|');
  // 生成随机数函数
  const rng = mulberry32(hashString(seedStr));

  // 常用变量
  const category = analysis.category;
  // 主题词：优先用命中的具体关键词，否则用类别的主题短语
  const theme = analysis.keywords.length ? `你问的「${analysis.keywords[0]}」` : category.theme;

  // ------------------------------------------------------------------
  // 2. 逐张牌分层组装
  // ------------------------------------------------------------------
  const cards = selection.map((sel, index) => {
    // 取出牌位定义（若牌超过三张则回落到最后一格）
    const position = POSITIONS[index] || POSITIONS[POSITIONS.length - 1];
    // 牌数据
    const data = sel.data;
    // 正逆位
    const reversed = sel.isReversed;
    // 正逆位文案
    const orient = reversed ? ORIENTATION_TEXT.reversed : ORIENTATION_TEXT.upright;
    // 生效的关键词（逆位时取逆位关键词）
    const keywords = reversed ? data.reversed : data.upright;

    // ---- ① 画面层 ----
    // 大阿卡纳没有单独的 scene 字段，回落到它的 essence
    const rawScene = data.scene || data.essence;
    // 逆位时补一句说明：同一个场景，力量的方向变了
    const visual = reversed
      ? `${rawScene}牌面在这里是逆位——场景没变，但那股力量是朝内收着的，或者被什么卡住了。`
      : rawScene;

    // ---- ② 位置层 ----
    const lead = pick(POSITION_LEADS[position.key], rng);

    // ---- ③ 领域层 ----
    // 该类别的第 index 条观察句
    const focus = category.focus[index] || category.focus[0];
    // 元素 × 类别的洞察句
    const lens = pickElementLens(data.element, analysis.primaryKey, rng);
    // 合成「在这件事上」这一段
    const context = `${lead}${focus}${lens}`;

    // ---- 行动提示 ----
    // 元素框架（四个花色 + 大阿卡纳的「灵」）
    const elementHint = ELEMENT_HINTS[data.element]?.[reversed ? 'rev' : 'up'] || '';
    // 点数框架：只对小阿卡纳有意义
    const rankHint = data.arcana === 'minor' ? RANK_HINTS[data.rank]?.[reversed ? 'rev' : 'up'] || '' : '';
    // 大阿卡纳没有点数，改为点出它的核心关键词
    const majorHint =
      data.arcana === 'major' ? `这张主牌的关键词是「${keywords[0]}」，把它当成接下来一段时间的行事基调。` : '';
    // 拼成完整提示。
    // 元素提示是「框架」，点数提示是「具体动作」，直接用「具体到动作上：」把它们串起来，
    // 否则两句独立的建议并列在一起会有明显的堆叠感。
    const tip = rankHint
      ? `${elementHint}具体到动作上：${rankHint}`
      : `${elementHint}${majorHint}`;

    // 返回这张牌的完整解读
    return {
      // 牌位信息
      position,
      // 牌位小标题
      positionTitle: POSITION_TITLES[position.key] || position.label,
      // 牌面数据
      data,
      // 正逆位
      isReversed: reversed,
      // 正逆位文案
      orientation: orient,
      // 生效的关键词
      keywords,
      // 标题行
      headline: `${position.label} · ${data.name}（${orient}）`,
      // 三段内容
      visual,
      context,
      tip,
    };
  });

  // ------------------------------------------------------------------
  // 3. 先说结论：把最想知道的答案放到最前面
  // ------------------------------------------------------------------
  // 统计正位数量
  const uprights = selection.filter((s) => !s.isReversed).length;
  // 取出能量等级
  const level = ENERGY_LEVELS.find((l) => l.uprights === uprights) || ENERGY_LEVELS[1];

  // 开场判断
  const verdictOpen = fill(pick(VERDICT_OPEN[uprights], rng), { theme });

  // 针对提问类型的定向回答
  const directAnswer = (() => {
    // 是非题：给出倾向性判断
    if (analysis.questionType === 'yesno') {
      // 偏肯定
      if (uprights >= 2) {
        return '倾向是「可以」，但需要你先把那张逆位指向的环节处理干净。牌面支持你行动，不支持你省略准备。';
      }
      // 一张正位：偏谨慎
      if (uprights === 1) {
        return '倾向是「先别急」。三张里有两张在提示阻力，贸然推进大概率会消耗掉你本可以用在别处的力气。';
      }
      // 全部逆位
      return '倾向是「暂时不要」。这不是永远不行，而是现在这个时机与方式都不对——等条件变了之后，同样的动作会顺畅得多。';
    }
    // 选择题：不替用户画勾，而是指出取舍的本质
    if (analysis.questionType === 'choice') {
      // 成功提取到两个选项时
      if (analysis.options) {
        return `你摆在桌上的是「${analysis.options.left}」与「${analysis.options.right}」。牌面没有替你画勾，因为这两个选项的差别不在好坏，而在代价——你更愿意承担哪一种，答案就是哪一个。`;
      }
      // 没提取到选项时给泛化表述
      return '牌面没有替你选边，因为真正的分歧不在选项之间，而在你还没决定要为哪个代价买单。';
    }
    // 趋势题：强调趋势可改
    if (analysis.questionType === 'prediction') {
      // 依能量给出趋势描述
      return uprights >= 2
        ? '趋势线是向上的：接下来事情大概率会朝你希望的方向松开，前提是你别在中途频繁换方向。'
        : '趋势线走平甚至向下：如果不主动调整，接下来很可能是现在的延续。好消息是，主动权还在你手里。';
    }
    // 开放题：给出整体定性
    return '这件事的性质更接近「需要调整方式」，而不是「需要更多努力」。方向对了，投入才会产生复利。';
  })();

  // 收尾：点出落点那张牌
  const trendCard = cards[cards.length - 1];
  const verdictClose = `牌阵最后停在《${trendCard.data.name}》上——那就是它给你的落点。`;

  // 组装结论段
  const verdict = {
    paragraphs: [verdictOpen, directAnswer, verdictClose],
  };

  // ------------------------------------------------------------------
  // 4. 三张牌之间的张力
  // ------------------------------------------------------------------
  // ---- 元素构成分析 ----
  const elements = cards.map((c) => c.data.element);
  // 统计每个元素出现的次数
  const tally = {};
  // 逐个统计
  for (const el of elements) tally[el] = (tally[el] || 0) + 1;
  // 按出现次数降序取第一个
  const dominant = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  // 元素分析句
  const elementNote = (() => {
    // 三种元素全不同：三条线并行
    if (Object.keys(tally).length === 3) {
      return `三张牌分别落在「${elements[0]}」「${elements[1]}」「${elements[2]}」三种能量上。这种排布说明这件事牵动的层面比你预想的多，单点突破未必有效——它需要你同时协调几条线。`;
    }
    // 三张同元素：能量高度集中
    if (Object.keys(tally).length === 1) {
      const d = ELEMENT_DOMINANCE[dominant[0]];
      return `三张牌全部落在「${dominant[0]}」元素上，对应${d ? d.color : '同一种能量'}。指向非常清晰，好处是你不会迷失方向；代价是缺少别的视角来平衡它。${d ? d.risk : ''}`;
    }
    // 两强一弱：找出那个少数派的「变量」
    const minor = Object.entries(tally).find(([, n]) => n === 1);
    const d = ELEMENT_DOMINANCE[dominant[0]];
    const dm = minor ? ELEMENT_DOMINANCE[minor[0]] : null;
    return `三张牌以「${dominant[0]}」（${d ? d.color : ''}）为主，另外夹着一张「${minor ? minor[0] : '其他'}」。主导元素决定了这件事的基调，而那张少数派就是唯一的变量。${dm ? dm.risk : ''}`;
  })();

  // ---- 大阿卡纳分量 ----
  const majorCards = cards.filter((c) => c.data.arcana === 'major');
  const majorIndex = cards.findIndex((c) => c.data.arcana === 'major');
  const majorNote = fill(MAJOR_NOTES[Math.min(majorCards.length, 3)], {
    position: majorIndex >= 0 ? cards[majorIndex].position.label : '现状',
  });

  // ---- 现状与走向之间的落差 ----
  const gapNote = (() => {
    // 至少要有三张牌才能谈落差
    if (cards.length < 3) return '';
    // 取首尾两张的关键词。
    // 注意：小阿卡纳的关键词是按点数生成的，同点数的两张牌首词会完全一样
    // （例如「权杖三」与「星币三」的首词都是「初步的成果」）。
    // 如果不做去重，落差句会变成「起点是 X，终点是 X」，读起来像是坏了。
    // 因此这里依次往后找一个不一样的词。
    const kwNow = pickDistinct(cards[0].keywords, null);
    const kwTrend = pickDistinct(cards[2].keywords, kwNow);
    // 生成串联句
    return `把第一张和第三张放在一起看，落差就很清楚了：起点是「${kwNow}」，终点是「${kwTrend}」，中间还夹着一张《${cards[1].data.name}》。它不是装饰，它是这两者之间唯一的那条路。`;
  })();

  // 组装张力段
  const tension = {
    paragraphs: [elementNote, majorNote, gapNote].filter(Boolean),
  };

  // ------------------------------------------------------------------
  // 5. 时间与行动窗口
  // ------------------------------------------------------------------
  // 以「走向」那张牌的元素决定节奏快慢
  const trendElement = trendCard.data.element;
  // 取节奏说明
  const speedNote = WINDOW_SPEED[trendElement] || WINDOW_SPEED['风'];
  // 正逆位决定时间会不会顺延
  const scheduleNote = trendCard.isReversed
    ? '但走向牌是逆位，所以时间大概率会往后推——别按理想时间表安排自己的期待，留出缓冲。'
    : '走向牌是正位，节奏基本如期，你按计划推进就能对上。';
  // 组装时间窗口段
  const windowSection = {
    text: `${speedNote}${scheduleNote}`,
  };

  // ------------------------------------------------------------------
  // 6. 综合结论（作为「先说结论」之外的补充视角）
  // ------------------------------------------------------------------
  // 结论模板
  const synthText = fill(pick(SYNTHESIS_TEMPLATES[uprights], rng), {
    // 提问类型引导语
    lead: analysis.questionTypeConfig.lead,
    // 主题词
    theme,
    // 能量等级名
    level: level.label,
  });
  // ------------------------------------------------------------------
  // 7. 行动建议：优先取领域建议，不足时用通用建议补齐
  // ------------------------------------------------------------------
  // 领域建议池
  const advicePool = [...category.advice];
  // 补齐到至少 3 条
  while (advicePool.length < 3) advicePool.push(...GENERIC_ADVICE);
  // 不重复地挑 3 条
  const advice = pickMany(advicePool, 3, rng);

  // 提醒：从领域提醒池里挑一条
  const caution = pick(category.caution, rng);

  // ------------------------------------------------------------------
  // 8. 能量评估
  // ------------------------------------------------------------------
  // 大阿卡纳的数量（主牌分量更重，略微抬高整体能量读数）
  const majorCount = majorCards.length;
  // 综合能量值：正位比例占八成权重，主牌比例占两成
  const energyValue = (uprights / 3) * 0.8 + (majorCount / 3) * 0.2;

  // ------------------------------------------------------------------
  // 9. 组装最终结果
  // ------------------------------------------------------------------
  return {
    // 原始问题
    question: analysis.raw,
    // 清洗后的问题
    cleanQuestion: analysis.text,
    // 问题类别
    category: {
      // 类别键
      key: analysis.primaryKey,
      // 类别名
      label: category.label,
      // 主题词
      theme,
    },
    // 提问类型
    questionType: {
      // 类型键
      key: analysis.questionType,
      // 类型名
      label: analysis.questionTypeConfig.label,
      // 类型说明
      intro: analysis.questionTypeConfig.intro,
    },
    // 命中的关键词
    keywords: analysis.keywords,
    // 三张牌的解读
    cards,
    // 先说结论
    verdict,
    // 牌与牌之间的关系
    tension,
    // 时间与行动窗口
    window: windowSection,
    // 综合陈述
    synthesis: {
      paragraphs: [synthText],
    },
    // 行动建议
    advice,
    // 需要留意的地方
    caution,
    // 能量评估
    energy: {
      // 0~1 的数值
      value: energyValue,
      // 百分比
      percent: Math.round(energyValue * 100),
      // 等级名
      label: level.label,
      // 等级说明
      caption: level.caption,
      // 正位数量
      uprights,
      // 大阿卡纳数量
      majors: majorCount,
    },
  };
}
