// ============================================================================
// reading/ReadingEngine.js —— 解读生成引擎
// ----------------------------------------------------------------------------
// 输入：用户的问题 + 三张已选中的牌（含正逆位）
// 输出：一个结构化的解读对象，供 UI 直接渲染
//
//   生成流水线：
//     问题分析 → 建立种子随机数 → 逐张牌组装段落 → 综合结论 → 建议与提醒 → 能量评估
//
//   为什么用「种子随机数」而不是纯随机：
//     同一个问题 + 同一组牌，无论刷新多少次，措辞都保持一致。
//     用户如果截图分享或回看，不会发现文本变了；同时不同问题之间措辞依然多样。
// ============================================================================

// 引入语料
import {
  POSITIONS,
  POSITION_TEMPLATES,
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
 * 填充模板中的占位符。
 * @param {string} tpl 模板字符串
 * @param {object} vars 变量表
 * @returns {string} 填充后的文本
 */
function fill(tpl, vars) {
  // 逐个替换
  return tpl.replace(/\{(\w+)\}/g, (m, key) => (vars[key] !== undefined ? String(vars[key]) : m));
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
  // 2. 逐张牌组装解读段落
  // ------------------------------------------------------------------
  const cardReadings = selection.map((sel, index) => {
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

    // 第一段：位置模板（含牌面意象）
    const p1 = fill(pick(POSITION_TEMPLATES[position.key], rng), {
      // 牌名
      name: data.name,
      // 正逆位
      orient,
      // 主题词
      theme,
      // 牌面意象
      essence: data.essence,
    });

    // 第二段：元素透镜 + 领域观察句
    const lens = pickElementLens(data.element, analysis.primaryKey, rng);
    // 该类别的第 index 条观察句
    const focus = category.focus[index] || category.focus[0];
    // 拼成段落
    const p2 = `${lens}${focus}`;

    // 第三段：关键词与牌位含义的对应
    const p3 = `关键词落在「${keywords.slice(0, 3).join('、')}」。把它放进「${position.label}」这一格，它照见的是${position.hint}${
      reversed ? '——只不过这一次，这股能量是朝内收着的' : ''
    }。`;

    // 返回这张牌的完整解读
    return {
      // 牌位信息
      position,
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
      // 段落数组
      paragraphs: [p1, p2, p3],
    };
  });

  // ------------------------------------------------------------------
  // 3. 综合结论
  // ------------------------------------------------------------------
  // 统计正位数量
  const uprights = selection.filter((s) => !s.isReversed).length;
  // 取出能量等级
  const level = ENERGY_LEVELS.find((l) => l.uprights === uprights) || ENERGY_LEVELS[1];
  // 结论模板
  const synthText = fill(pick(SYNTHESIS_TEMPLATES[uprights], rng), {
    // 提问类型引导语
    lead: analysis.questionTypeConfig.lead,
    // 主题词
    theme,
    // 能量等级名
    level: level.label,
  });

  // 三张牌的串联句
  const chainSentence = `三张牌依次是《${cardReadings[0]?.data.name ?? '—'}》（${
    cardReadings[0]?.orientation ?? '—'
  }）、《${cardReadings[1]?.data.name ?? '—'}》（${cardReadings[1]?.orientation ?? '—'}）、《${
    cardReadings[2]?.data.name ?? '—'
  }》（${cardReadings[2]?.orientation ?? '—'}）。`;

  // 现状与转折之间的落差分析
  const gapSentence = (() => {
    // 缺少任何一张就不生成
    if (cardReadings.length < 2) return '';
    // 取前两张的第一个关键词
    const kwA = cardReadings[0]?.keywords[0] ?? '';
    // 第二张的第一个关键词
    const kwB = cardReadings[1]?.keywords[0] ?? '';
    // 生成一句串联文本
    return `值得注意的是第一张与第二张之间的落差：前者说的是「${kwA}」，后者说的是「${kwB}」——这中间的空隙，正是你接下来真正要处理的地方。`;
  })();

  // 针对不同提问类型的定向回答
  const directAnswer = (() => {
    // 是非题：给出倾向性判断
    if (analysis.questionType === 'yesno') {
      // 依据正位数量给出倾向
      if (uprights >= 2) {
        // 偏肯定
        return `倾向是「可以」，但需要你先把那个逆位指向的环节处理干净。牌面支持你行动，不支持你省略准备。`;
      }
      // 偏否定
      if (uprights === 1) {
        // 明显偏否
        return `倾向是「先别急」。三张里有两张在提示阻力，贸然推进大概率会消耗掉你本可以用在别处的力气。`;
      }
      // 全部逆位
      return `倾向是「暂时不要」。这不是永远不行，而是现在这个时机与方式都不对——等条件变化后，同样的动作会顺畅得多。`;
    }
    // 选择题：不替用户画勾，而是指出取舍的本质
    if (analysis.questionType === 'choice') {
      // 有提取到两个选项
      if (analysis.options) {
        // 指出两个选项的差别不在优劣
        return `你摆在桌上的是「${analysis.options.left}」与「${analysis.options.right}」。牌面没有替你画勾，因为这两个选项的差别不在好坏，而在代价——你更愿意承担哪一种，答案就是哪一个。`;
      }
      // 没提取到时给出泛化表述
      return `牌面没有替你选边，因为真正的分歧不在选项之间，而在你还没决定要为哪个代价买单。`;
    }
    // 趋势题：强调趋势可改
    if (analysis.questionType === 'prediction') {
      // 依能量给出趋势描述
      return uprights >= 2
        ? `趋势线上扬：接下来事情大概率会朝着你希望的方向松开，前提是你别在中途频繁换方向。`
        : `趋势线走平甚至下行：如果不主动调整，接下来很可能是现在的延续。好消息是，主动权还在你手里。`;
    }
    // 开放题：给出整体定性
    return `这件事的性质更接近「需要调整方式」而不是「需要更多努力」。方向对了，投入才会产生复利。`;
  })();

  // 组装综合段落
  const synthesis = {
    // 标题
    title: '综合结论',
    // 段落数组
    paragraphs: [synthText, chainSentence, gapSentence, directAnswer].filter(Boolean),
  };

  // ------------------------------------------------------------------
  // 4. 行动建议：优先取领域建议，不足时用通用建议补齐
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
  // 5. 能量评估
  // ------------------------------------------------------------------
  // 大阿卡纳的数量（大牌分量更重，略微抬高整体能量读数）
  const majorCount = selection.filter((s) => s.data.arcana === 'major').length;
  // 综合能量值：正位比例占八成权重，大牌比例占两成
  const energyValue = (uprights / 3) * 0.8 + (majorCount / 3) * 0.2;

  // ------------------------------------------------------------------
  // 6. 组装最终结果
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
    cards: cardReadings,
    // 综合结论
    synthesis,
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
