// ============================================================================
// core/mathUtils.js —— 通用数学与缓动工具
// ----------------------------------------------------------------------------
// 把散落在各处的插值、阻尼、缓动、随机数收敛到这里，方便统一调参与复用。
// ============================================================================

// 线性插值：在 a 与 b 之间按比例 t（0~1）取值
export function lerp(a, b, t) {
  // 标准插值公式
  return a + (b - a) * t;
}

// 反插值：求 value 在 [a, b] 区间内的归一化位置，并裁剪到 0~1
export function inverseLerp(a, b, value) {
  // 区间宽度为 0 时直接返回 0，避免除零
  if (a === b) return 0;
  // 归一化后裁剪
  return clamp((value - a) / (b - a), 0, 1);
}

// 数值裁剪到 [min, max] 区间
export function clamp(value, min, max) {
  // 先取下界再取上界
  return Math.min(Math.max(value, min), max);
}

/**
 * 恒正取模：把任意整数映射到 [0, m) 区间。
 * JavaScript 的 % 对负数返回负值（例如 -1 % 78 === -1），
 * 而在环形牌阵里我们需要它稳定地落到 0~77，因此单独封装一个。
 * @param {number} n 被除数（可为负数）
 * @param {number} m 模数（正整数）
 * @returns {number} [0, m) 区间内的结果
 */
export function mod(n, m) {
  // 先取模，再加一次模数并再取一次模，保证结果恒为非负
  return ((n % m) + m) % m;
}

// 把角度限制到 (-180, 180] 度，用于环形排列时取最短路径
export function wrapDegrees(deg) {
  // 先对 360 取模把角度收进 (-360, 360)
  let d = deg % 360;
  // 超过 180 度则减 360
  if (d > 180) d -= 360;
  // 小于等于 -180 度则加 360
  if (d <= -180) d += 360;
  // 返回结果
  return d;
}

/**
 * 帧率无关的指数阻尼插值。
 * 无论帧率是 30fps 还是 144fps，用同一组参数都能得到一致的手感，
 * 这是 Apple 风格“跟手而不粘滞”动画的关键。
 * @param {number} current 当前值
 * @param {number} target 目标值
 * @param {number} smoothing 平滑系数（每秒衰减到剩余比例，越小越跟手）
 * @param {number} dt 帧间隔秒数
 */
export function damp(current, target, smoothing, dt) {
  // 用指数函数把平滑系数换算成与 dt 相关的插值比例
  return lerp(current, target, 1 - Math.pow(smoothing, dt));
}

// 缓动函数集合：输入 0~1，输出 0~1 的变形值
export const Easing = {
  // 线性
  linear: (t) => t,
  // 三次缓出：起步快、收尾柔和，最常用的通用缓动
  easeOutCubic: (t) => 1 - Math.pow(1 - t, 3),
  // 四次缓出：比三次更干脆
  easeOutQuart: (t) => 1 - Math.pow(1 - t, 4),
  // 五次缓出：极快起步、极慢收尾，适合“飞入”类动画
  easeOutQuint: (t) => 1 - Math.pow(1 - t, 5),
  // 三次缓入缓出：两端柔和，适合镜头运动
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  // 指数缓出：非常凌厉的起步，适合卡牌翻转
  easeOutExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  // 回弹缓出：轻微过冲后回落，制造“落入卡槽”的物理感
  easeOutBack: (t) => {
    // 过冲强度常量
    const c1 = 1.70158;
    // 过冲修正常量
    const c3 = c1 + 1;
    // 标准 easeOutBack 公式
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  // 弹性缓出：多次衰减振荡，用于强调型入场
  easeOutElastic: (t) => {
    // 圆周率常量
    const c4 = (2 * Math.PI) / 3;
    // 边界处理
    if (t === 0) return 0;
    // 边界处理
    if (t === 1) return 1;
    // 标准 easeOutElastic 公式
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
};

/**
 * 字符串哈希：把任意字符串映射为 32 位无符号整数。
 * 用于让“同一问题 + 同一组牌”得到稳定的解读结果（可复现）。
 * @param {string} str 输入字符串
 * @returns {number} 32 位无符号整数
 */
export function hashString(str) {
  // FNV-1a 偏移基准值
  let h = 2166136261;
  // 逐字符混入
  for (let i = 0; i < str.length; i++) {
    // 异或当前字符码
    h ^= str.charCodeAt(i);
    // 乘以 FNV 质数（用 imul 保证 32 位整数语义）
    h = Math.imul(h, 16777619);
  }
  // 转成无符号整数返回
  return h >>> 0;
}

/**
 * mulberry32 伪随机数生成器：给定种子后产生稳定的伪随机序列。
 * 好处是「无第三方依赖 + 同种子结果一致」，非常适合解读文本的措辞选择。
 * @param {number} seed 种子
 * @returns {Function} 调用一次返回 [0, 1) 的随机数
 */
export function mulberry32(seed) {
  // 保存内部状态
  let a = seed >>> 0;
  // 返回生成函数
  return function random() {
    // 状态递推
    a = (a + 0x6d2b79f5) | 0;
    // 混合位运算
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    // 二次混合
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    // 归一化到 [0, 1)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 用 Fisher-Yates 算法原地洗牌。
 * @param {Array} array 待洗牌的数组
 * @param {Function} random 随机数函数（默认 Math.random，可换成带种子的版本）
 * @returns {Array} 同一个数组引用（已乱序）
 */
export function shuffle(array, random = Math.random) {
  // 从末尾向前遍历
  for (let i = array.length - 1; i > 0; i--) {
    // 随机选一个 [0, i] 的下标
    const j = Math.floor(random() * (i + 1));
    // 交换
    [array[i], array[j]] = [array[j], array[i]];
  }
  // 返回自身便于链式调用
  return array;
}

/**
 * 三段式二次贝塞尔曲线求值：用于卡牌飞行轨迹。
 * @param {THREE.Vector3} out 输出向量（复用以避免每帧新建对象）
 * @param {THREE.Vector3} p0 起点
 * @param {THREE.Vector3} p1 控制点
 * @param {THREE.Vector3} p2 终点
 * @param {number} t 进度 0~1
 */
export function quadraticBezier(out, p0, p1, p2, t) {
  // 预先计算两个中间系数
  const mt = 1 - t;
  // 二次贝塞尔标准公式，逐分量计算
  out.set(
    mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x,
    mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y,
    mt * mt * p0.z + 2 * mt * t * p1.z + t * t * p2.z
  );
  // 返回结果向量
  return out;
}
