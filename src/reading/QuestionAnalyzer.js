// ============================================================================
// reading/QuestionAnalyzer.js —— 问题分析器
// ----------------------------------------------------------------------------
// 目标：把用户随手写下的一句自然语言，映射成解读引擎需要的三样东西：
//   1. 问题类别（感情 / 事业 / 财运 / 学业 / 身心 / 人际 / 抉择 / 成长 / 内在 / 综合）
//   2. 提问类型（是非题 / 选择题 / 趋势题 / 开放题）
//   3. 命中的关键词与提取出的主题词
// 实现上刻意保持轻量：中文分词引入的复杂度远大于收益，
// 因此采用「长度加权关键词命中 + 句式模式匹配」的组合方案，实测足够准确。
// ============================================================================

// 引入类别定义与提问类型定义
import { CATEGORIES, QUESTION_TYPES } from './meanings.js';

// ---------------------------------------------------------------------------
// 提问类型识别用的正则模式
// ---------------------------------------------------------------------------

// 是非题模式：是否 / 该不该 / 要不要 / 能不能 / 会不会 / 可不可以 / ……吗
const YESNO_PATTERN =
  /(是否|是不是|该不该|要不要|能不能|可不可以|会不会|行不行|对不对|好不好|可以吗|行吗|对吗|好吗|值得吗|有必要吗|算不算)/;

// 选择题模式：A 还是 B
const CHOICE_PATTERN = /(还是|或是|或者|二选一|选哪|哪个更|哪个好|pick)/;

// 趋势题模式：会 / 将 / 未来 / 接下来 / 什么时候 / 多久
const PREDICTION_PATTERN = /(会不会|会不|未来|接下[来去]|以后|以后会|什么时候|多久|多长|几时|将来|之后会|走向|发展)/;

// ---------------------------------------------------------------------------
// 选择肢切分：用于从「A 还是 B」里提取两个选项
// ---------------------------------------------------------------------------
const CHOICE_SPLIT_PATTERN = /(?:还是|或是|或者|，或者|，还是)/;

/**
 * 判断一个字符串是否包含至少一个中文字符。
 * 用于过滤掉「？」「...」「test」这类无意义输入。
 * @param {string} s 字符串
 * @returns {boolean} 是否含中文
 */
function hasChinese(s) {
  // 汉字的 Unicode 区间
  return /[\u4e00-\u9fa5]/.test(s);
}

/**
 * 清洗问题文本。
 * @param {string} raw 原始输入
 * @returns {string} 清洗后的文本
 */
export function cleanQuestion(raw) {
  // 空值兜底
  if (!raw) return '';
  // 去掉首尾空白与各种问号、感叹号
  return String(raw)
    // 去除首尾空白
    .trim()
    // 合并连续空白
    .replace(/\s+/g, ' ')
    // 去掉结尾的标点（问号、感叹号、句号、波浪号）
    .replace(/[？?！!。.~～、，,]+$/g, '');
}

/**
 * 分析问题。
 * @param {string} raw 用户输入的原始问题
 * @returns {object} 分析结果
 */
export function analyzeQuestion(raw) {
  // 清洗文本
  const text = cleanQuestion(raw);
  // 文本长度过短或没有中文，视为无效输入
  const isMeaningful = text.length >= 2 && hasChinese(text);

  // ------------------------------------------------------------------
  // 1. 类别打分：命中越长的关键词，说明指向越具体，权重越高
  // ------------------------------------------------------------------
  // 存放每个类别的得分
  const scores = {};
  // 存放每个类别命中的关键词
  const hits = {};
  // 遍历全部类别
  for (const [key, cfg] of Object.entries(CATEGORIES)) {
    // 跳过没有关键词的通用类别
    if (!cfg.keywords || !cfg.keywords.length) continue;
    // 初始化得分
    let score = 0;
    // 命中的词
    const matched = [];
    // 遍历该类别的关键词
    for (const kw of cfg.keywords) {
      // 包含才计分
      if (text.includes(kw)) {
        // 权重 = 1 + 关键词长度的一半（越长的词越具体）
        score += 1 + (kw.length - 1) * 0.5;
        // 记录命中的词
        matched.push(kw);
      }
    }
    // 写回结果
    scores[key] = score;
    // 记录命中词
    hits[key] = matched;
  }

  // 找出得分最高的类别
  let primaryKey = 'general';
  // 当前最高分
  let best = 0;
  // 遍历得分表
  for (const [key, score] of Object.entries(scores)) {
    // 严格大于才替换，保证同分时按定义顺序取第一个
    if (score > best) {
      best = score;
      primaryKey = key;
    }
  }

  // 把得分不低于最高分 60% 的类别都视为相关类别（用于副线提示）
  const related = Object.entries(scores)
    // 过滤出有意义的类别
    .filter(([, s]) => s > 0 && s >= best * 0.6)
    // 按分数降序
    .sort((a, b) => b[1] - a[1])
    // 只保留键名
    .map(([k]) => k);

  // ------------------------------------------------------------------
  // 2. 提问类型识别：按优先级依次判断
  // ------------------------------------------------------------------
  let questionType = 'open';
  // 是非题优先级最高
  if (YESNO_PATTERN.test(text)) questionType = 'yesno';
  // 其次是选择题
  else if (CHOICE_PATTERN.test(text)) questionType = 'choice';
  // 再次是趋势题
  else if (PREDICTION_PATTERN.test(text)) questionType = 'prediction';

  // ------------------------------------------------------------------
  // 3. 选择题的选项提取
  // ------------------------------------------------------------------
  let options = null;
  // 只有选择题才尝试切分
  if (questionType === 'choice') {
    // 按「还是 / 或者」切分
    const parts = text.split(CHOICE_SPLIT_PATTERN);
    // 切成两段才有意义
    if (parts.length >= 2) {
      // 左选项：取最后一段（切分后奇数索引才是被分隔的正文）
      const left = parts[0].replace(/^.*[，,、]/, '').trim();
      // 右选项：取切分符号后的那一段
      const right = parts[1].replace(/[？?，,。.]/g, '').trim();
      // 两边都非空才算提取成功
      if (left && right) options = { left, right };
    }
  }

  // ------------------------------------------------------------------
  // 4. 主题词提取：优先使用命中关键词，其次使用类别主题词
  // ------------------------------------------------------------------
  // 取出当前类别的配置
  const primaryCfg = CATEGORIES[primaryKey];
  // 收集全部命中关键词并按长度降序（长的更具体）
  const allHits = related
    // 展开各命中的词
    .flatMap((k) => hits[k] || [])
    // 去重
    .filter((v, i, arr) => arr.indexOf(v) === i)
    // 按长度降序
    .sort((a, b) => b.length - a.length);

  // ------------------------------------------------------------------
  // 5. 时间视角识别：帮助解读判断用户关心的是当下还是未来
  // ------------------------------------------------------------------
  // 当下视角词
  const presentWords = ['现在', '目前', '当下', '最近', '这几天', '眼下', '当前'];
  // 未来视角词
  const futureWords = ['未来', '以后', '接下来', '之后', '明年', '下一步', '将来'];
  // 判定时间视角
  let timeFocus = 'neutral';
  // 命中未来词
  if (futureWords.some((w) => text.includes(w))) timeFocus = 'future';
  // 命中当下词（当下优先于未来，因为用户更可能在描述现状）
  if (presentWords.some((w) => text.includes(w))) timeFocus = 'present';

  // 组装并返回
  return {
    // 原始输入
    raw,
    // 清洗后的文本
    text,
    // 是否有效
    isMeaningful,
    // 主类别键
    primaryKey,
    // 主类别配置
    category: primaryCfg,
    // 全部相关类别键
    related,
    // 提问类型键
    questionType,
    // 提问类型配置
    questionTypeConfig: QUESTION_TYPES[questionType],
    // 命中的关键词（长的在前）
    keywords: allHits,
    // 提取出的主题词：优先用具体关键词，否则用类别的主题短语
    topic: allHits.length ? `「${allHits[0]}」` : primaryCfg.theme,
    // 选择题选项
    options,
    // 时间视角
    timeFocus,
  };
}
