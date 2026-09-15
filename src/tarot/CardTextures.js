// ============================================================================
// tarot/CardTextures.js —— 程序化牌面贴图生成器
// ----------------------------------------------------------------------------
// 项目不依赖任何外部美术资源：所有牌背纹样、大小阿卡纳牌面、光晕与星点
// 全部用 Canvas 2D 现场绘制并转成 three.js 纹理。
// 优点：仓库零二进制资源、体积极小、风格完全统一、可自由换肤。
// ============================================================================

// 引入 three.js 核心命名空间
import * as THREE from 'three';

// ---------------------------------------------------------------------------
// 全局视觉常量：金色体系与牌面尺寸
// ---------------------------------------------------------------------------

// 香槟金（主金色）
const GOLD = '#e3c37a';
// 高亮金（用于最亮的描边与星芒）
const GOLD_HI = '#fff3d0';
// 深金（用于渐变暗部与阴影）
const GOLD_DEEP = '#8a6420';
// 半透明金（用于大面积描边）
const GOLD_SOFT = 'rgba(227, 195, 122, 0.42)';
// 极淡金（用于辅助线）
const GOLD_FAINT = 'rgba(227, 195, 122, 0.18)';
// 牌面纹理宽度（像素）
const TEX_W = 512;
// 牌面纹理高度（像素），与 3D 卡牌 1 : 1.664 的长宽比严格一致
const TEX_H = 852;
// 中文字体栈：优先宋体/明体，营造典雅的占卜气质
const FONT_SERIF = '"Songti SC", "STSong", "Noto Serif SC", "Source Han Serif SC", "SimSun", "Microsoft YaHei", Georgia, serif';
// 英文与数字字体栈
const FONT_SANS = '"Helvetica Neue", "Segoe UI", Arial, sans-serif';

// ---------------------------------------------------------------------------
// 花色配色表：四大花色各有一个主色，贯穿牌面底色、符号与光晕
// ---------------------------------------------------------------------------
const SUIT_COLORS = {
  // 权杖（火）：赤金橙，象征行动与热情
  wands: { main: '#e08a3c', glow: 'rgba(224, 138, 60, 0.5)', deep: '#3a1d0a' },
  // 圣杯（水）：幽蓝，象征情感与直觉
  cups: { main: '#5aa6e0', glow: 'rgba(90, 166, 224, 0.5)', deep: '#0a1e33' },
  // 宝剑（风）：冷银蓝，象征思维与冲突
  swords: { main: '#a8bed6', glow: 'rgba(168, 190, 214, 0.5)', deep: '#141b25' },
  // 星币（土）：苔绿，象征物质与落地
  pentacles: { main: '#7fb96a', glow: 'rgba(127, 185, 106, 0.5)', deep: '#12210e' },
  // 大阿卡纳（灵）：神秘紫，象征命运本身
  major: { main: '#a98ce8', glow: 'rgba(169, 140, 232, 0.5)', deep: '#1a1030' },
};

// ---------------------------------------------------------------------------
// 大阿卡纳符号表：22 张主牌各对应一个程序化绘制的几何符号
// ---------------------------------------------------------------------------
const MAJOR_SIGILS = [
  'rose', // 0  愚者 —— 白玫瑰，纯粹的起点
  'infinity', // I  魔术师 —— 无限符号，资源的循环
  'veil', // II 女祭司 —— 帷幕双柱，潜意识的入口
  'wheat', // III 皇后 —— 麦穗，丰饶与孕育
  'crown', // IV 皇帝 —— 王冠，秩序与权威
  'key', // V  教皇 —— 钥匙，正统的传承
  'heart', // VI 恋人 —— 心，选择与结合
  'chariot', // VII 战车 —— 车驾，意志的推进
  'flame', // VIII 力量 —— 火焰，温柔的驯服
  'lantern', // IX 隐者 —— 提灯，内在的求索
  'wheel', // X  命运之轮 —— 轮盘，周期的转动
  'scales', // XI 正义 —— 天平，因果的称量
  'invertedTriangle', // XII 倒吊人 —— 倒三角，视角的翻转
  'scythe', // XIII 死神 —— 镰刀，必要的终结
  'chaliceFlow', // XIV 节制 —— 双杯流转，炼金与调和
  'invertedStar', // XV 恶魔 —— 倒五芒，执念的枷锁
  'tower', // XVI 塔 —— 高塔，结构的崩塌
  'star8', // XVII 星星 —— 八芒星，希望的指引
  'moon', // XVIII 月亮 —— 新月，幻象与潜意识
  'sun', // XIX 太阳 —— 太阳，澄澈的生机
  'ankh', // XX 审判 —— 安卡十字，复活与召唤
  'wreath', // XXI 世界 —— 月桂环，圆满的完成
];

// ---------------------------------------------------------------------------
// 小阿卡纳数字牌的符号排布表：定义 1~10 个花色符号分几行、每行几个
// ---------------------------------------------------------------------------
const PIP_ROWS = {
  // 1 个：单行居中
  1: [1],
  // 2 个：一列两行
  2: [1, 1],
  // 3 个：一列三行
  3: [1, 1, 1],
  // 4 个：两行各两个
  4: [2, 2],
  // 5 个：2-1-2 的经典排布
  5: [2, 1, 2],
  // 6 个：两行各三个
  6: [3, 3],
  // 7 个：3-2-2
  7: [3, 2, 2],
  // 8 个：3-3-2
  8: [3, 3, 2],
  // 9 个：3-3-3
  9: [3, 3, 3],
  // 10 个：3-4-3
  10: [3, 4, 3],
};

// ---------------------------------------------------------------------------
// 基础绘图工具
// ---------------------------------------------------------------------------

/**
 * 创建一个离屏画布并返回画布与上下文。
 * @param {number} w 宽度
 * @param {number} h 高度
 * @returns {{canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D}}
 */
function createCanvas(w, h) {
  // 创建画布元素
  const canvas = document.createElement('canvas');
  // 设置宽度
  canvas.width = w;
  // 设置高度
  canvas.height = h;
  // 取出 2D 上下文（关闭 willReadFrequently，因为这里只写不读）
  const ctx = canvas.getContext('2d');
  // 返回两者
  return { canvas, ctx };
}

/**
 * 绘制圆角矩形路径（不填充、不描边，由调用方决定）。
 * @param {CanvasRenderingContext2D} ctx 上下文
 * @param {number} x 左上角 x
 * @param {number} y 左上角 y
 * @param {number} w 宽度
 * @param {number} h 高度
 * @param {number} r 圆角半径
 */
function roundRectPath(ctx, x, y, w, h, r) {
  // 开始路径
  ctx.beginPath();
  // 移动到上边起点
  ctx.moveTo(x + r, y);
  // 上边
  ctx.lineTo(x + w - r, y);
  // 右上圆角
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  // 右边
  ctx.lineTo(x + w, y + h - r);
  // 右下圆角
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  // 下边
  ctx.lineTo(x + r, y + h);
  // 左下圆角
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  // 左边
  ctx.lineTo(x, y + r);
  // 左上圆角
  ctx.quadraticCurveTo(x, y, x + r, y);
  // 闭合路径
  ctx.closePath();
}

/**
 * 绘制正多边形路径。
 * @param {CanvasRenderingContext2D} ctx 上下文
 * @param {number} cx 中心 x
 * @param {number} cy 中心 y
 * @param {number} r 外接圆半径
 * @param {number} n 边数
 * @param {number} rot 起始旋转角（弧度）
 */
function polygonPath(ctx, cx, cy, r, n, rot = -Math.PI / 2) {
  // 开始路径
  ctx.beginPath();
  // 逐顶点连线
  for (let i = 0; i < n; i++) {
    // 计算当前顶点的极角
    const a = rot + (i * Math.PI * 2) / n;
    // 计算坐标
    const x = cx + Math.cos(a) * r;
    // 计算坐标
    const y = cy + Math.sin(a) * r;
    // 第一个点用 moveTo，其余用 lineTo
    if (i === 0) ctx.moveTo(x, y);
    // 后续顶点
    else ctx.lineTo(x, y);
  }
  // 闭合路径
  ctx.closePath();
}

/**
 * 绘制星形路径（内外半径交替的正 n 角星）。
 * @param {CanvasRenderingContext2D} ctx 上下文
 * @param {number} cx 中心 x
 * @param {number} cy 中心 y
 * @param {number} rOuter 外半径
 * @param {number} rInner 内半径
 * @param {number} n 角数
 * @param {number} rot 起始旋转角
 */
function starPath(ctx, cx, cy, rOuter, rInner, n, rot = -Math.PI / 2) {
  // 开始路径
  ctx.beginPath();
  // 共 2n 个顶点
  for (let i = 0; i < n * 2; i++) {
    // 偶数索引取外半径，奇数取内半径
    const r = i % 2 === 0 ? rOuter : rInner;
    // 计算极角
    const a = rot + (i * Math.PI) / n;
    // 计算坐标
    const x = cx + Math.cos(a) * r;
    // 计算坐标
    const y = cy + Math.sin(a) * r;
    // 连线
    if (i === 0) ctx.moveTo(x, y);
    // 后续顶点
    else ctx.lineTo(x, y);
  }
  // 闭合
  ctx.closePath();
}

/**
 * 绘制一条带渐变的描边，让线条本身也有金属光泽。
 * @param {CanvasRenderingContext2D} ctx 上下文
 * @param {number} x0 起点 x
 * @param {number} y0 起点 y
 * @param {number} x1 终点 x
 * @param {number} y1 终点 y
 * @param {string} c0 起点色
 * @param {string} c1 终点色
 * @param {number} width 线宽
 */
function gradientLine(ctx, x0, y0, x1, y1, c0, c1, width = 2) {
  // 以线段两端建立线性渐变
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  // 起点颜色
  g.addColorStop(0, c0);
  // 终点颜色
  g.addColorStop(1, c1);
  // 应用描边样式
  ctx.strokeStyle = g;
  // 设置线宽
  ctx.lineWidth = width;
  // 使用圆头端点，线条更精致
  ctx.lineCap = 'round';
  // 开始路径
  ctx.beginPath();
  // 移动
  ctx.moveTo(x0, y0);
  // 画线
  ctx.lineTo(x1, y1);
  // 描边
  ctx.stroke();
}

/**
 * 绘制圆环（仅描边）。
 * @param {CanvasRenderingContext2D} ctx 上下文
 * @param {number} cx 中心 x
 * @param {number} cy 中心 y
 * @param {number} r 半径
 * @param {string} color 颜色
 * @param {number} width 线宽
 */
function ring(ctx, cx, cy, r, color, width = 2) {
  // 开始路径
  ctx.beginPath();
  // 画整圆
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  // 设置描边色
  ctx.strokeStyle = color;
  // 设置线宽
  ctx.lineWidth = width;
  // 描边
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// 符号绘制函数集：每个函数负责在指定圆域内画出一个可辨识的几何符号
// 约定：所有符号都在以 (cx, cy) 为中心、半径 r 的圆形范围内完成绘制
// ---------------------------------------------------------------------------

// 符号绘制表：键名为符号标识，值为绘制实现
const SIGIL_DRAWERS = {
  /**
   * 玫瑰：三层同心花瓣环，对应「愚者」的纯真起点。
   */
  rose(ctx, cx, cy, r) {
    // 画三层由外到内的花瓣环
    for (let layer = 0; layer < 3; layer++) {
      // 当前层半径
      const rr = r * (1 - layer * 0.28);
      // 花瓣数量随层数递减
      const petals = 8 - layer * 2;
      // 逐片花瓣画弧
      for (let i = 0; i < petals; i++) {
        // 花瓣中心角
        const a = (i / petals) * Math.PI * 2;
        // 花瓣中心坐标
        const px = cx + Math.cos(a) * rr * 0.5;
        // 花瓣中心坐标
        const py = cy + Math.sin(a) * rr * 0.5;
        // 开始路径
        ctx.beginPath();
        // 画半圆花瓣
        ctx.arc(px, py, rr * 0.3, 0, Math.PI * 2);
        // 描边颜色随层数变亮
        ctx.strokeStyle = layer === 0 ? GOLD_SOFT : GOLD;
        // 线宽随层数变细
        ctx.lineWidth = 1.6;
        // 描边
        ctx.stroke();
      }
    }
    // 中心实心点
    ctx.beginPath();
    // 半径
    ctx.arc(cx, cy, r * 0.09, 0, Math.PI * 2);
    // 填充高亮金
    ctx.fillStyle = GOLD_HI;
    // 填充
    ctx.fill();
  },

  /**
   * 无限符号：两个相交的环，对应「魔术师」的资源循环。
   */
  infinity(ctx, cx, cy, r) {
    // 环半径
    const rr = r * 0.46;
    // 水平偏移量
    const dx = r * 0.44;
    // 设置描边样式
    ctx.strokeStyle = GOLD;
    // 线宽
    ctx.lineWidth = 3;
    // 用椭圆模拟左右两环
    ctx.beginPath();
    // 左环
    ctx.ellipse(cx - dx, cy, rr, rr * 0.82, 0, 0, Math.PI * 2);
    // 描边
    ctx.stroke();
    // 右环路径
    ctx.beginPath();
    // 右环
    ctx.ellipse(cx + dx, cy, rr, rr * 0.82, 0, 0, Math.PI * 2);
    // 描边
    ctx.stroke();
    // 交叉处的小星点
    ctx.beginPath();
    // 星形
    starPath(ctx, cx, cy, r * 0.2, r * 0.08, 4, 0);
    // 填充高亮
    ctx.fillStyle = GOLD_HI;
    // 填充
    ctx.fill();
  },

  /**
   * 帷幕双柱：两根立柱加一道拱，对应「女祭司」潜意识之门。
   */
  veil(ctx, cx, cy, r) {
    // 立柱宽度
    const w = r * 0.16;
    // 立柱高度
    const h = r * 1.5;
    // 两根立柱的水平偏移
    const dx = r * 0.5;
    // 逐根绘制立柱
    for (const sx of [-1, 1]) {
      // 左柱用深金、右柱用亮金，形成阴阳对比
      const col = sx < 0 ? GOLD_DEEP : GOLD_HI;
      // 填充柱体
      ctx.fillStyle = col;
      // 绘制矩形柱身
      ctx.fillRect(cx + sx * dx - w / 2, cy - h / 2, w, h);
      // 柱头装饰
      ctx.fillStyle = GOLD;
      // 柱顶圆点
      ctx.beginPath();
      // 圆
      ctx.arc(cx + sx * dx, cy - h / 2 - r * 0.08, r * 0.09, 0, Math.PI * 2);
      // 填充
      ctx.fill();
    }
    // 画一道拱形帷幕
    ctx.beginPath();
    // 上拱
    ctx.arc(cx, cy - h / 2 + r * 0.1, dx, Math.PI * 1.15, Math.PI * 1.85);
    // 描边
    ctx.strokeStyle = GOLD_SOFT;
    // 线宽
    ctx.lineWidth = 2.5;
    // 描边
    ctx.stroke();
    // 帷幕上的竖向褶皱
    for (let i = -2; i <= 2; i++) {
      // 起点 y
      const y0 = cy - h / 2 + r * 0.22;
      // 终点 y
      const y1 = cy + h / 2 - r * 0.1;
      // 画褶皱线
      gradientLine(ctx, cx + i * dx * 0.36, y0, cx + i * dx * 0.36, y1, GOLD_FAINT, GOLD_SOFT, 1.4);
    }
  },

  /**
   * 麦穗：三根带颗粒的茎，对应「皇后」的丰饶。
   */
  wheat(ctx, cx, cy, r) {
    // 三根茎的水平偏移
    const offsets = [-r * 0.55, 0, r * 0.55];
    // 逐根绘制
    offsets.forEach((ox, idx) => {
      // 茎的顶部略微外扩，形成扇形
      const topX = cx + ox * 1.35;
      // 茎底
      const botY = cy + r * 1.1;
      // 茎顶
      const topY = cy - r * 0.95;
      // 画主茎
      gradientLine(ctx, cx + ox * 0.5, botY, topX, topY, GOLD_DEEP, GOLD, 2.4);
      // 茎上排布麦粒
      for (let i = 0; i < 6; i++) {
        // 插值位置
        const t = i / 5;
        // 麦粒中心
        const px = cx + ox * 0.5 + (topX - cx - ox * 0.5) * t;
        // 麦粒中心
        const py = botY + (topY - botY) * t;
        // 左倾麦粒
        ctx.beginPath();
        // 椭圆
        ctx.ellipse(px - r * 0.1, py, r * 0.1, r * 0.05, -0.6, 0, Math.PI * 2);
        // 填充
        ctx.fillStyle = idx === 1 ? GOLD_HI : GOLD;
        // 填充
        ctx.fill();
        // 右倾麦粒
        ctx.beginPath();
        // 椭圆
        ctx.ellipse(px + r * 0.1, py, r * 0.1, r * 0.05, 0.6, 0, Math.PI * 2);
        // 填充
        ctx.fill();
      }
    });
  },

  /**
   * 王冠：带宝珠的冠冕，对应「皇帝」的权威。
   */
  crown(ctx, cx, cy, r) {
    // 冠底宽度
    const w = r * 1.7;
    // 冠体高度
    const h = r * 0.7;
    // 冠底 y
    const baseY = cy + h * 0.7;
    // 开始绘制冠体轮廓
    ctx.beginPath();
    // 左下角
    ctx.moveTo(cx - w / 2, baseY);
    // 上到左侧尖
    ctx.lineTo(cx - w / 2, baseY - h);
    // 中间三个尖角
    for (let i = 0; i < 3; i++) {
      // 尖角顶部 x
      const px = cx - w / 2 + (w / 3) * (i + 0.5);
      // 尖角顶部 y
      const py = baseY - h - r * 0.45;
      // 连到尖角
      ctx.lineTo(px, py);
      // 回到下一个谷底
      ctx.lineTo(cx - w / 2 + (w / 3) * (i + 1), baseY - h);
    }
    // 右上角
    ctx.lineTo(cx + w / 2, baseY - h);
    // 右下角
    ctx.lineTo(cx + w / 2, baseY);
    // 闭合
    ctx.closePath();
    // 金色渐变填充
    const g = ctx.createLinearGradient(cx - w / 2, baseY - h, cx + w / 2, baseY);
    // 渐变起点
    g.addColorStop(0, GOLD_DEEP);
    // 中段亮金
    g.addColorStop(0.5, GOLD);
    // 终点高亮
    g.addColorStop(1, GOLD_HI);
    // 应用填充
    ctx.fillStyle = g;
    // 填充
    ctx.fill();
    // 描边勾边
    ctx.strokeStyle = GOLD_HI;
    // 线宽
    ctx.lineWidth = 1.5;
    // 描边
    ctx.stroke();
    // 三个尖角顶端的宝珠
    for (let i = 0; i < 3; i++) {
      // 宝珠 x
      const px = cx - w / 2 + (w / 3) * (i + 0.5);
      // 宝珠 y
      const py = baseY - h - r * 0.45;
      // 圆点
      ctx.beginPath();
      // 半径
      ctx.arc(px, py - r * 0.1, r * 0.11, 0, Math.PI * 2);
      // 高亮填充
      ctx.fillStyle = GOLD_HI;
      // 填充
      ctx.fill();
    }
    // 冠底的宝石带
    for (let i = 0; i < 5; i++) {
      // 宝石 x
      const px = cx - w / 2 + (w / 5) * (i + 0.5);
      // 菱形宝石
      ctx.beginPath();
      // 菱形路径
      ctx.moveTo(px, baseY - h * 0.34);
      // 右点
      ctx.lineTo(px + r * 0.08, baseY - h * 0.18);
      // 下点
      ctx.lineTo(px, baseY - h * 0.02);
      // 左点
      ctx.lineTo(px - r * 0.08, baseY - h * 0.18);
      // 闭合
      ctx.closePath();
      // 填充高亮
      ctx.fillStyle = GOLD_HI;
      // 填充
      ctx.fill();
    }
  },

  /**
   * 钥匙：齿状钥匙，对应「教皇」的正统传承。
   */
  key(ctx, cx, cy, r) {
    // 环形钥匙头
    ring(ctx, cx, cy - r * 0.72, r * 0.36, GOLD, 3);
    // 内环
    ring(ctx, cx, cy - r * 0.72, r * 0.16, GOLD_SOFT, 1.6);
    // 钥匙杆
    gradientLine(ctx, cx, cy - r * 0.36, cx, cy + r * 0.95, GOLD, GOLD_DEEP, 4);
    // 钥匙齿：两枚横向短齿
    for (let i = 0; i < 2; i++) {
      // 齿的 y
      const ty = cy + r * 0.45 + i * r * 0.34;
      // 左侧长齿
      gradientLine(ctx, cx, ty, cx + r * 0.42, ty, GOLD, GOLD_HI, 3);
    }
    // 顶部小光点
    ctx.beginPath();
    // 小圆
    ctx.arc(cx, cy + r * 1.02, r * 0.08, 0, Math.PI * 2);
    // 填充
    ctx.fillStyle = GOLD_HI;
    // 填充
    ctx.fill();
  },

  /**
   * 心：金色心形，对应「恋人」的选择与结合。
   */
  heart(ctx, cx, cy, r) {
    // 开始心形路径
    ctx.beginPath();
    // 从左下尖角起笔
    ctx.moveTo(cx, cy + r * 0.95);
    // 左侧曲线
    ctx.bezierCurveTo(cx - r * 1.5, cy - r * 0.1, cx - r * 0.72, cy - r * 1.15, cx, cy - r * 0.34);
    // 右侧曲线
    ctx.bezierCurveTo(cx + r * 0.72, cy - r * 1.15, cx + r * 1.5, cy - r * 0.1, cx, cy + r * 0.95);
    // 闭合
    ctx.closePath();
    // 金色渐变
    const g = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
    // 上部亮金
    g.addColorStop(0, GOLD_HI);
    // 下部深金
    g.addColorStop(1, GOLD_DEEP);
    // 应用渐变
    ctx.fillStyle = g;
    // 填充
    ctx.fill();
    // 描边
    ctx.strokeStyle = GOLD;
    // 线宽
    ctx.lineWidth = 1.5;
    // 描边
    ctx.stroke();
    // 内部光芒线
    for (let i = 0; i < 3; i++) {
      // 从心形中心向外发散的短线
      gradientLine(ctx, cx, cy + r * 0.05, cx + (i - 1) * r * 0.42, cy - r * 0.6, GOLD_HI, GOLD_FAINT, 1.6);
    }
  },

  /**
   * 车驾：两个车轮加一个华盖，对应「战车」的意志推进。
   */
  chariot(ctx, cx, cy, r) {
    // 车体高度
    const bodyH = r * 0.7;
    // 车体宽度
    const bodyW = r * 1.5;
    // 两个车轮
    for (const sx of [-1, 1]) {
      // 车轮中心
      const wx = cx + sx * bodyW * 0.42;
      // 车轮中心
      const wy = cy + r * 0.62;
      // 外轮
      ring(ctx, wx, wy, r * 0.3, GOLD, 2.6);
      // 内轮
      ring(ctx, wx, wy, r * 0.12, GOLD_SOFT, 1.6);
      // 轮辐
      for (let i = 0; i < 6; i++) {
        // 轮辐角度
        const a = (i / 6) * Math.PI * 2;
        // 画辐条
        gradientLine(
          ctx,
          wx + Math.cos(a) * r * 0.12,
          wy + Math.sin(a) * r * 0.12,
          wx + Math.cos(a) * r * 0.3,
          wy + Math.sin(a) * r * 0.3,
          GOLD_SOFT,
          GOLD,
          1.4
        );
      }
    }
    // 车体
    ctx.fillStyle = 'rgba(227, 195, 122, 0.16)';
    // 圆角车体
    roundRectPath(ctx, cx - bodyW / 2, cy - bodyH * 0.4, bodyW, bodyH, r * 0.12);
    // 填充
    ctx.fill();
    // 车体描边
    ctx.strokeStyle = GOLD;
    // 线宽
    ctx.lineWidth = 2;
    // 描边
    ctx.stroke();
    // 华盖：覆盖在车体上方的弧形顶棚
    ctx.beginPath();
    // 半圆顶棚
    ctx.arc(cx, cy - bodyH * 0.4, bodyW * 0.46, Math.PI, Math.PI * 2);
    // 描边
    ctx.strokeStyle = GOLD_HI;
    // 线宽
    ctx.lineWidth = 2.4;
    // 描边
    ctx.stroke();
    // 顶棚上的星点装饰
    for (let i = 0; i < 5; i++) {
      // 沿弧线均匀分布
      const a = Math.PI + (i / 4) * Math.PI;
      // 星点坐标
      const px = cx + Math.cos(a) * bodyW * 0.46;
      // 星点坐标
      const py = cy - bodyH * 0.4 + Math.sin(a) * bodyW * 0.46;
      // 小圆点
      ctx.beginPath();
      // 半径
      ctx.arc(px, py, r * 0.05, 0, Math.PI * 2);
      // 填充高亮
      ctx.fillStyle = GOLD_HI;
      // 填充
      ctx.fill();
    }
  },

  /**
   * 火焰：跃动的火舌，对应「力量」温柔的驯服。
   */
  flame(ctx, cx, cy, r) {
    // 三层火焰由外到内收拢
    const layers = [
      { scale: 1.0, color: GOLD_DEEP, alpha: 0.5 },
      { scale: 0.68, color: GOLD, alpha: 0.8 },
      { scale: 0.38, color: GOLD_HI, alpha: 1 },
    ];
    // 逐层绘制
    layers.forEach((layer) => {
      // 开始火舌路径
      ctx.beginPath();
      // 底部左侧
      ctx.moveTo(cx - r * 0.6 * layer.scale, cy + r * 0.95 * layer.scale);
      // 左侧内凹曲线
      ctx.bezierCurveTo(
        cx - r * 0.75 * layer.scale,
        cy + r * 0.1 * layer.scale,
        cx - r * 0.28 * layer.scale,
        cy - r * 0.3 * layer.scale,
        cx + r * 0.05 * layer.scale,
        cy - r * 1.15 * layer.scale
      );
      // 右侧外凸曲线
      ctx.bezierCurveTo(
        cx + r * 0.42 * layer.scale,
        cy - r * 0.28 * layer.scale,
        cx + r * 0.85 * layer.scale,
        cy + r * 0.2 * layer.scale,
        cx + r * 0.6 * layer.scale,
        cy + r * 0.95 * layer.scale
      );
      // 底部弧线闭合
      ctx.quadraticCurveTo(cx, cy + r * 1.1 * layer.scale, cx - r * 0.6 * layer.scale, cy + r * 0.95 * layer.scale);
      // 闭合
      ctx.closePath();
      // 设置透明度
      ctx.globalAlpha = layer.alpha;
      // 填充颜色
      ctx.fillStyle = layer.color;
      // 填充
      ctx.fill();
    });
    // 复位透明度
    ctx.globalAlpha = 1;
  },

  /**
   * 提灯：六角灯罩内含星点，对应「隐者」的求索。
   */
  lantern(ctx, cx, cy, r) {
    // 灯罩：六边形
    polygonPath(ctx, cx, cy, r * 0.85, 6, -Math.PI / 2);
    // 灯罩描边
    ctx.strokeStyle = GOLD;
    // 线宽
    ctx.lineWidth = 2.6;
    // 描边
    ctx.stroke();
    // 灯罩内部淡金色填充
    ctx.fillStyle = 'rgba(227, 195, 122, 0.12)';
    // 填充
    ctx.fill();
    // 内部六芒星
    starPath(ctx, cx, cy, r * 0.5, r * 0.22, 6);
    // 描边
    ctx.strokeStyle = GOLD_HI;
    // 线宽
    ctx.lineWidth = 1.8;
    // 描边
    ctx.stroke();
    // 中心光点
    ctx.beginPath();
    // 圆
    ctx.arc(cx, cy, r * 0.12, 0, Math.PI * 2);
    // 填充
    ctx.fillStyle = GOLD_HI;
    // 填充
    ctx.fill();
    // 顶部提环
    ring(ctx, cx, cy - r * 1.05, r * 0.18, GOLD, 2.4);
  },

  /**
   * 轮盘：带辐条与外围符文的轮，对应「命运之轮」。
   */
  wheel(ctx, cx, cy, r) {
    // 外轮
    ring(ctx, cx, cy, r, GOLD, 3);
    // 中轮
    ring(ctx, cx, cy, r * 0.72, GOLD_SOFT, 1.6);
    // 内轮
    ring(ctx, cx, cy, r * 0.24, GOLD, 2);
    // 八根辐条
    for (let i = 0; i < 8; i++) {
      // 辐条角度
      const a = (i / 8) * Math.PI * 2;
      // 画辐条
      gradientLine(
        ctx,
        cx + Math.cos(a) * r * 0.24,
        cy + Math.sin(a) * r * 0.24,
        cx + Math.cos(a) * r,
        cy + Math.sin(a) * r,
        GOLD_SOFT,
        GOLD,
        1.8
      );
    }
    // 外圈上的符文点
    for (let i = 0; i < 12; i++) {
      // 符文点角度
      const a = (i / 12) * Math.PI * 2;
      // 符文点坐标
      const px = cx + Math.cos(a) * r * 0.86;
      // 符文点坐标
      const py = cy + Math.sin(a) * r * 0.86;
      // 小方点
      ctx.fillStyle = i % 3 === 0 ? GOLD_HI : GOLD_SOFT;
      // 绘制
      ctx.fillRect(px - 2, py - 2, 4, 4);
    }
  },

  /**
   * 天平：横梁与两个托盘，对应「正义」的因果称量。
   */
  scales(ctx, cx, cy, r) {
    // 立柱
    gradientLine(ctx, cx, cy - r * 1.05, cx, cy + r * 1.05, GOLD, GOLD_DEEP, 3);
    // 底座
    gradientLine(ctx, cx - r * 0.5, cy + r * 1.05, cx + r * 0.5, cy + r * 1.05, GOLD_DEEP, GOLD_DEEP, 3);
    // 横梁
    gradientLine(ctx, cx - r * 0.92, cy - r * 0.75, cx + r * 0.92, cy - r * 0.75, GOLD_HI, GOLD_HI, 3);
    // 顶端宝珠
    ctx.beginPath();
    // 圆
    ctx.arc(cx, cy - r * 1.12, r * 0.1, 0, Math.PI * 2);
    // 填充
    ctx.fillStyle = GOLD_HI;
    // 填充
    ctx.fill();
    // 两个托盘
    for (const sx of [-1, 1]) {
      // 吊绳
      gradientLine(
        ctx,
        cx + sx * r * 0.92,
        cy - r * 0.75,
        cx + sx * r * 0.92,
        cy - r * 0.05,
        GOLD,
        GOLD_SOFT,
        1.4
      );
      // 托盘弧
      ctx.beginPath();
      // 半圆盘
      ctx.arc(cx + sx * r * 0.92, cy - r * 0.05, r * 0.3, 0, Math.PI);
      // 描边
      ctx.strokeStyle = GOLD;
      // 线宽
      ctx.lineWidth = 2.4;
      // 描边
      ctx.stroke();
    }
  },

  /**
   * 倒三角：向下指的三角形加一条横杆，对应「倒吊人」的视角翻转。
   */
  invertedTriangle(ctx, cx, cy, r) {
    // 三角形路径（顶点朝下）
    polygonPath(ctx, cx, cy, r, 3, Math.PI / 2);
    // 描边
    ctx.strokeStyle = GOLD;
    // 线宽
    ctx.lineWidth = 3;
    // 描边
    ctx.stroke();
    // 内部发光填充
    ctx.fillStyle = 'rgba(227, 195, 122, 0.1)';
    // 填充
    ctx.fill();
    // 顶部横杆（象征悬挂的绳索）
    gradientLine(ctx, cx - r * 0.75, cy - r * 0.5, cx + r * 0.75, cy - r * 0.5, GOLD_HI, GOLD_HI, 3);
    // 两根竖直吊绳
    for (const sx of [-1, 1]) {
      // 画绳
      gradientLine(ctx, cx + sx * r * 0.35, cy - r * 0.5, cx + sx * r * 0.35, cy - r * 0.88, GOLD_SOFT, GOLD, 1.6);
    }
    // 中心光点
    ctx.beginPath();
    // 圆
    ctx.arc(cx, cy + r * 0.25, r * 0.12, 0, Math.PI * 2);
    // 填充
    ctx.fillStyle = GOLD_HI;
    // 填充
    ctx.fill();
  },

  /**
   * 镰刀：弯月刀刃加手柄，对应「死神」必要的终结。
   */
  scythe(ctx, cx, cy, r) {
    // 手柄：斜向长杆
    gradientLine(ctx, cx - r * 0.7, cy + r * 1.05, cx + r * 0.35, cy - r * 0.55, GOLD_DEEP, GOLD, 4);
    // 刀柄末端配重
    ctx.beginPath();
    // 圆
    ctx.arc(cx - r * 0.72, cy + r * 1.08, r * 0.12, 0, Math.PI * 2);
    // 填充
    ctx.fillStyle = GOLD;
    // 填充
    ctx.fill();
    // 刀刃：一段粗弧
    ctx.beginPath();
    // 从刀根到刀尖画弧
    ctx.arc(cx + r * 0.35, cy - r * 0.62, r * 0.92, Math.PI * 0.12, Math.PI * 0.92);
    // 刀刃用较粗的描边表现
    ctx.strokeStyle = GOLD_HI;
    // 线宽
    ctx.lineWidth = 5;
    // 圆头端点
    ctx.lineCap = 'round';
    // 描边
    ctx.stroke();
    // 刃口再叠一层细亮线，模拟锋刃反光
    ctx.beginPath();
    // 同样的弧
    ctx.arc(cx + r * 0.35, cy - r * 0.62, r * 0.92, Math.PI * 0.16, Math.PI * 0.88);
    // 纯白高光
    ctx.strokeStyle = '#fffdf5';
    // 更细
    ctx.lineWidth = 1.4;
    // 描边
    ctx.stroke();
  },

  /**
   * 双杯流转：两只杯子之间有一条流动的光带，对应「节制」的调和。
   */
  chaliceFlow(ctx, cx, cy, r) {
    // 左杯（上）与右杯（下）
    const cups = [
      { x: cx - r * 0.55, y: cy - r * 0.55, flip: false },
      { x: cx + r * 0.55, y: cy + r * 0.62, flip: true },
    ];
    // 逐只绘制杯子
    cups.forEach((c) => {
      // 保存上下文以便翻转
      ctx.save();
      // 平移到杯心
      ctx.translate(c.x, c.y);
      // 需要翻转时旋转 180 度
      if (c.flip) ctx.rotate(Math.PI);
      // 杯身
      ctx.beginPath();
      // 上沿
      ctx.moveTo(-r * 0.42, -r * 0.32);
      // 右侧内收
      ctx.quadraticCurveTo(r * 0.36, r * 0.1, 0, r * 0.42);
      // 左侧内收
      ctx.quadraticCurveTo(-r * 0.36, r * 0.1, -r * 0.42, -r * 0.32);
      // 闭合
      ctx.closePath();
      // 描边
      ctx.strokeStyle = GOLD;
      // 线宽
      ctx.lineWidth = 2.4;
      // 描边
      ctx.stroke();
      // 杯内淡金
      ctx.fillStyle = 'rgba(227, 195, 122, 0.14)';
      // 填充
      ctx.fill();
      // 杯脚
      gradientLine(ctx, 0, r * 0.42, 0, r * 0.62, GOLD, GOLD_DEEP, 2.4);
      // 杯座
      gradientLine(ctx, -r * 0.2, r * 0.62, r * 0.2, r * 0.62, GOLD_DEEP, GOLD_DEEP, 2.4);
      // 恢复上下文
      ctx.restore();
    });
    // 杯间流动的光带
    ctx.beginPath();
    // 波浪曲线
    ctx.moveTo(cups[0].x + r * 0.3, cups[0].y + r * 0.4);
    // 第一个控制点
    ctx.bezierCurveTo(cx + r * 0.1, cy - r * 0.1, cx - r * 0.1, cy + r * 0.2, cups[1].x - r * 0.3, cups[1].y - r * 0.4);
    // 虚线样式
    ctx.setLineDash([6, 5]);
    // 描边色
    ctx.strokeStyle = GOLD_HI;
    // 线宽
    ctx.lineWidth = 2;
    // 描边
    ctx.stroke();
    // 清除虚线以免影响后续绘制
    ctx.setLineDash([]);
  },

  /**
   * 倒五芒星：顶点朝下的五角星，对应「恶魔」的执念枷锁。
   */
  invertedStar(ctx, cx, cy, r) {
    // 倒置的五角星
    starPath(ctx, cx, cy, r, r * 0.4, 5, Math.PI / 2);
    // 描边
    ctx.strokeStyle = GOLD;
    // 线宽
    ctx.lineWidth = 2.8;
    // 描边
    ctx.stroke();
    // 内部淡金
    ctx.fillStyle = 'rgba(227, 195, 122, 0.1)';
    // 填充
    ctx.fill();
    // 外接圆
    ring(ctx, cx, cy, r * 1.12, GOLD_FAINT, 1.6);
    // 顶部两端的小锁链环，强化“束缚”意象
    for (const sx of [-1, 1]) {
      // 锁环
      ring(ctx, cx + sx * r * 0.62, cy + r * 0.72, r * 0.14, GOLD_SOFT, 1.8);
    }
  },

  /**
   * 高塔：塔身加闪电，对应「塔」的结构崩塌。
   */
  tower(ctx, cx, cy, r) {
    // 塔身宽度
    const w = r * 0.85;
    // 塔身高度
    const h = r * 1.5;
    // 塔顶 y
    const topY = cy - h / 2;
    // 塔底 y
    const botY = cy + h / 2;
    // 塔身轮廓（上窄下宽）
    ctx.beginPath();
    // 左上
    ctx.moveTo(cx - w * 0.36, topY);
    // 右上
    ctx.lineTo(cx + w * 0.36, topY);
    // 右下
    ctx.lineTo(cx + w * 0.5, botY);
    // 左下
    ctx.lineTo(cx - w * 0.5, botY);
    // 闭合
    ctx.closePath();
    // 深色填充
    ctx.fillStyle = 'rgba(227, 195, 122, 0.1)';
    // 填充
    ctx.fill();
    // 描边
    ctx.strokeStyle = GOLD;
    // 线宽
    ctx.lineWidth = 2.4;
    // 描边
    ctx.stroke();
    // 塔身的砖缝
    for (let i = 1; i < 4; i++) {
      // 横向砖缝的 y
      const ly = topY + (h / 4) * i;
      // 画线
      gradientLine(ctx, cx - w * 0.48, ly, cx + w * 0.48, ly, GOLD_FAINT, GOLD_FAINT, 1.2);
    }
    // 塔顶破损的城垛
    for (let i = 0; i < 3; i++) {
      // 城垛 x
      const bx = cx - w * 0.36 + (w * 0.72 / 3) * (i + 0.5);
      // 城垛方块
      ctx.fillStyle = GOLD;
      // 绘制
      ctx.fillRect(bx - r * 0.07, topY - r * 0.18, r * 0.14, r * 0.18);
    }
    // 闪电：从右上劈向塔身
    ctx.beginPath();
    // 起点
    ctx.moveTo(cx + r * 0.95, cy - r * 1.25);
    // 折线
    ctx.lineTo(cx + r * 0.35, cy - r * 0.55);
    // 折点
    ctx.lineTo(cx + r * 0.65, cy - r * 0.5);
    // 终点
    ctx.lineTo(cx + r * 0.12, cy + r * 0.25);
    // 亮金色描边
    ctx.strokeStyle = GOLD_HI;
    // 线宽
    ctx.lineWidth = 2.6;
    // 圆头
    ctx.lineJoin = 'round';
    // 描边
    ctx.stroke();
  },

  /**
   * 八芒星：主星加辅助射线，对应「星星」的希望指引。
   */
  star8(ctx, cx, cy, r) {
    // 主八芒星
    starPath(ctx, cx, cy, r, r * 0.32, 8);
    // 描边
    ctx.strokeStyle = GOLD;
    // 线宽
    ctx.lineWidth = 2.4;
    // 描边
    ctx.stroke();
    // 内部淡金填充
    ctx.fillStyle = 'rgba(227, 195, 122, 0.12)';
    // 填充
    ctx.fill();
    // 中心亮点
    ctx.beginPath();
    // 圆
    ctx.arc(cx, cy, r * 0.14, 0, Math.PI * 2);
    // 填充
    ctx.fillStyle = GOLD_HI;
    // 填充
    ctx.fill();
    // 外围四射光芒（十字方向更长）
    for (let i = 0; i < 8; i++) {
      // 射线角度
      const a = (i / 8) * Math.PI * 2;
      // 射线长度按奇偶变化，形成节奏
      const len = i % 2 === 0 ? r * 1.45 : r * 1.2;
      // 画射线
      gradientLine(
        ctx,
        cx + Math.cos(a) * r * 1.02,
        cy + Math.sin(a) * r * 1.02,
        cx + Math.cos(a) * len,
        cy + Math.sin(a) * len,
        GOLD,
        'rgba(227, 195, 122, 0)',
        1.8
      );
    }
  },

  /**
   * 新月：带侧面轮廓的新月，对应「月亮」的幻象。
   */
  moon(ctx, cx, cy, r) {
    // 用两个圆做差集得到月牙：先画外圆，再用 destination-out 挖掉偏移的圆
    ctx.save();
    // 建立裁剪区域避免影响其它绘制（此处直接使用合成模式）
    // 外圆填充金色
    ctx.beginPath();
    // 外圆
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    // 渐变填充
    const g = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    // 亮部
    g.addColorStop(0, GOLD_HI);
    // 暗部
    g.addColorStop(1, GOLD_DEEP);
    // 应用
    ctx.fillStyle = g;
    // 填充
    ctx.fill();
    // 用「擦除」模式挖出月牙
    ctx.globalCompositeOperation = 'destination-out';
    // 偏移的内圆
    ctx.beginPath();
    // 圆心右移形成月牙
    ctx.arc(cx + r * 0.52, cy - r * 0.1, r * 0.92, 0, Math.PI * 2);
    // 填充（擦除）
    ctx.fill();
    // 恢复合成模式
    ctx.globalCompositeOperation = 'source-over';
    // 恢复上下文
    ctx.restore();
    // 月牙外围的细描边，让轮廓在深色底上更清晰
    ctx.beginPath();
    // 外弧
    ctx.arc(cx, cy, r * 1.04, Math.PI * 0.42, Math.PI * 1.58);
    // 描边
    ctx.strokeStyle = GOLD_SOFT;
    // 线宽
    ctx.lineWidth = 1.4;
    // 描边
    ctx.stroke();
    // 散落的星点
    const starPos = [
      [-r * 0.75, -r * 0.85],
      [r * 0.95, r * 0.5],
      [r * 0.5, -r * 1.05],
    ];
    // 逐个绘制
    starPos.forEach(([sx, sy]) => {
      // 小四芒星
      starPath(ctx, cx + sx, cy + sy, r * 0.16, r * 0.05, 4);
      // 填充
      ctx.fillStyle = GOLD;
      // 填充
      ctx.fill();
    });
  },

  /**
   * 太阳：实体圆加放射光线，对应「太阳」的澄澈生机。
   */
  sun(ctx, cx, cy, r) {
    // 圆盘
    ctx.beginPath();
    // 圆形
    ctx.arc(cx, cy, r * 0.62, 0, Math.PI * 2);
    // 径向渐变：中心亮、边缘转为深金
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.62);
    // 中心高亮
    g.addColorStop(0, GOLD_HI);
    // 中段金色
    g.addColorStop(0.6, GOLD);
    // 边缘深金
    g.addColorStop(1, GOLD_DEEP);
    // 应用
    ctx.fillStyle = g;
    // 填充
    ctx.fill();
    // 圆盘描边
    ring(ctx, cx, cy, r * 0.62, GOLD_HI, 1.6);
    // 16 道放射光线
    for (let i = 0; i < 16; i++) {
      // 光线角度
      const a = (i / 16) * Math.PI * 2;
      // 长短交替
      const inner = r * 0.72;
      // 外端半径
      const outer = i % 2 === 0 ? r * 1.15 : r * 0.95;
      // 画光线
      gradientLine(
        ctx,
        cx + Math.cos(a) * inner,
        cy + Math.sin(a) * inner,
        cx + Math.cos(a) * outer,
        cy + Math.sin(a) * outer,
        GOLD_HI,
        'rgba(227, 195, 122, 0)',
        2.2
      );
    }
    // 太阳表面的纹饰环
    ring(ctx, cx, cy, r * 0.34, 'rgba(255,243,208,0.55)', 1.4);
  },

  /**
   * 安卡十字：生命之符，对应「审判」的复活与召唤。
   */
  ankh(ctx, cx, cy, r) {
    // 顶部圆环
    ring(ctx, cx, cy - r * 0.6, r * 0.4, GOLD, 3.2);
    // 环内小环
    ring(ctx, cx, cy - r * 0.6, r * 0.18, GOLD_SOFT, 1.4);
    // 竖杆
    gradientLine(ctx, cx, cy - r * 0.2, cx, cy + r * 1.1, GOLD_HI, GOLD_DEEP, 4);
    // 横杆
    gradientLine(ctx, cx - r * 0.85, cy + r * 0.12, cx + r * 0.85, cy + r * 0.12, GOLD, GOLD, 4);
    // 横杆两端的装饰圆点
    for (const sx of [-1, 1]) {
      ctx.beginPath();
      // 圆点
      ctx.arc(cx + sx * r * 0.85, cy + r * 0.12, r * 0.09, 0, Math.PI * 2);
      // 填充
      ctx.fillStyle = GOLD_HI;
      // 填充
      ctx.fill();
    }
  },

  /**
   * 月桂环：闭合的环形枝叶，对应「世界」的圆满。
   */
  wreath(ctx, cx, cy, r) {
    // 主环
    ring(ctx, cx, cy, r * 0.92, GOLD, 2.6);
    // 环绕的叶片
    for (let i = 0; i < 20; i++) {
      // 叶片角度
      const a = (i / 20) * Math.PI * 2 - Math.PI / 2;
      // 叶片中心
      const px = cx + Math.cos(a) * r * 0.92;
      // 叶片中心
      const py = cy + Math.sin(a) * r * 0.92;
      // 叶片：沿切线方向拉长的椭圆
      ctx.beginPath();
      // 椭圆
      ctx.ellipse(px, py, r * 0.15, r * 0.07, a, 0, Math.PI * 2);
      // 交替深浅，形成韵律
      ctx.fillStyle = i % 2 === 0 ? GOLD : GOLD_DEEP;
      // 填充
      ctx.fill();
    }
    // 四角的小符号（对应四大元素）
    for (let i = 0; i < 4; i++) {
      // 对角分布
      const a = Math.PI / 4 + (i / 4) * Math.PI * 2;
      // 符号中心
      const px = cx + Math.cos(a) * r * 1.28;
      // 符号中心
      const py = cy + Math.sin(a) * r * 1.28;
      // 四芒星
      starPath(ctx, px, py, r * 0.14, r * 0.05, 4);
      // 填充
      ctx.fillStyle = GOLD_HI;
      // 填充
      ctx.fill();
    }
    // 中心光点
    ctx.beginPath();
    // 圆
    ctx.arc(cx, cy, r * 0.16, 0, Math.PI * 2);
    // 填充
    ctx.fillStyle = GOLD_HI;
    // 填充
    ctx.fill();
  },

  // ----------------------------------------------------------------------
  // 以下为小阿卡纳的四个花色符号
  // ----------------------------------------------------------------------

  /**
   * 权杖：带新芽的木杖。
   */
  staff(ctx, cx, cy, r, color) {
    // 杖身
    gradientLine(ctx, cx, cy - r, cx, cy + r, GOLD_HI, color, r * 0.2);
    // 顶端菱形杖头
    ctx.beginPath();
    // 菱形顶点
    ctx.moveTo(cx, cy - r * 1.45);
    // 右点
    ctx.lineTo(cx + r * 0.3, cy - r * 1.05);
    // 下点
    ctx.lineTo(cx, cy - r * 0.65);
    // 左点
    ctx.lineTo(cx - r * 0.3, cy - r * 1.05);
    // 闭合
    ctx.closePath();
    // 填充主色
    ctx.fillStyle = color;
    // 填充
    ctx.fill();
    // 描边
    ctx.strokeStyle = GOLD;
    // 线宽
    ctx.lineWidth = 1.4;
    // 描边
    ctx.stroke();
    // 杖身两侧的新叶
    for (const sx of [-1, 1]) {
      // 叶片
      ctx.beginPath();
      // 椭圆叶
      ctx.ellipse(cx + sx * r * 0.42, cy - r * 0.18, r * 0.36, r * 0.16, sx * 0.5, 0, Math.PI * 2);
      // 填充
      ctx.fillStyle = color;
      // 填充
      ctx.fill();
    }
  },

  /**
   * 圣杯：高脚酒杯。
   */
  cup(ctx, cx, cy, r, color) {
    // 杯身路径
    ctx.beginPath();
    // 上沿左端
    ctx.moveTo(cx - r * 0.78, cy - r * 0.72);
    // 右侧内收
    ctx.quadraticCurveTo(cx + r * 0.62, cy - r * 0.05, cx, cy + r * 0.62);
    // 左侧内收
    ctx.quadraticCurveTo(cx - r * 0.62, cy - r * 0.05, cx - r * 0.78, cy - r * 0.72);
    // 闭合
    ctx.closePath();
    // 主色填充
    ctx.fillStyle = color;
    // 填充
    ctx.fill();
    // 金色描边
    ctx.strokeStyle = GOLD;
    // 线宽
    ctx.lineWidth = 1.8;
    // 描边
    ctx.stroke();
    // 杯口横线
    gradientLine(ctx, cx - r * 0.82, cy - r * 0.72, cx + r * 0.82, cy - r * 0.72, GOLD_HI, GOLD, 2.4);
    // 杯脚
    gradientLine(ctx, cx, cy + r * 0.62, cx, cy + r * 1.02, GOLD, GOLD_DEEP, 2.4);
    // 杯座
    ctx.beginPath();
    // 底盘
    ctx.ellipse(cx, cy + r * 1.06, r * 0.5, r * 0.13, 0, 0, Math.PI * 2);
    // 填充
    ctx.fillStyle = GOLD;
    // 填充
    ctx.fill();
  },

  /**
   * 宝剑：直刃长剑。
   */
  sword(ctx, cx, cy, r, color) {
    // 剑刃
    ctx.beginPath();
    // 剑尖
    ctx.moveTo(cx, cy - r * 1.45);
    // 右侧刃
    ctx.lineTo(cx + r * 0.2, cy - r * 1.0);
    // 右下
    ctx.lineTo(cx + r * 0.2, cy + r * 0.55);
    // 左下
    ctx.lineTo(cx - r * 0.2, cy + r * 0.55);
    // 左侧刃
    ctx.lineTo(cx - r * 0.2, cy - r * 1.0);
    // 闭合
    ctx.closePath();
    // 冷色填充
    ctx.fillStyle = color;
    // 填充
    ctx.fill();
    // 描边
    ctx.strokeStyle = GOLD;
    // 线宽
    ctx.lineWidth = 1.6;
    // 描边
    ctx.stroke();
    // 中脊高光线
    gradientLine(ctx, cx, cy - r * 1.35, cx, cy + r * 0.5, GOLD_HI, GOLD_SOFT, 1.4);
    // 护手
    gradientLine(ctx, cx - r * 0.72, cy + r * 0.6, cx + r * 0.72, cy + r * 0.6, GOLD, GOLD, 3.4);
    // 剑柄
    gradientLine(ctx, cx, cy + r * 0.62, cx, cy + r * 1.15, GOLD_DEEP, GOLD_DEEP, 3);
    // 剑首
    ctx.beginPath();
    // 圆
    ctx.arc(cx, cy + r * 1.2, r * 0.15, 0, Math.PI * 2);
    // 填充
    ctx.fillStyle = GOLD;
    // 填充
    ctx.fill();
  },

  /**
   * 星币：圆盘内嵌五角星。
   */
  pentacle(ctx, cx, cy, r, color) {
    // 圆盘
    ctx.beginPath();
    // 圆形
    ctx.arc(cx, cy, r * 0.95, 0, Math.PI * 2);
    // 主色填充
    ctx.fillStyle = color;
    // 填充
    ctx.fill();
    // 金色外圈
    ring(ctx, cx, cy, r * 0.95, GOLD, 2.6);
    // 内圈
    ring(ctx, cx, cy, r * 0.76, GOLD_SOFT, 1.4);
    // 内嵌五角星
    starPath(ctx, cx, cy, r * 0.62, r * 0.26, 5);
    // 描边
    ctx.strokeStyle = GOLD_HI;
    // 线宽
    ctx.lineWidth = 2;
    // 描边
    ctx.stroke();
    // 五角星内部淡金填充
    ctx.fillStyle = 'rgba(255,243,208,0.18)';
    // 填充
    ctx.fill();
  },
};

// ---------------------------------------------------------------------------
// 牌面框架与装饰
// ---------------------------------------------------------------------------

/**
 * 绘制牌面的华丽金框：外粗线 + 内细线 + 四角花饰。
 * @param {CanvasRenderingContext2D} ctx 上下文
 * @param {number} w 画布宽
 * @param {number} h 画布高
 * @param {number} inset 内缩距离
 */
function drawOrnateFrame(ctx, w, h, inset) {
  // 外层金框：较粗、颜色饱和度低
  roundRectPath(ctx, inset, inset, w - inset * 2, h - inset * 2, 22);
  // 描边
  ctx.strokeStyle = GOLD;
  // 线宽
  ctx.lineWidth = 3;
  // 描边
  ctx.stroke();
  // 内层细金框
  roundRectPath(ctx, inset + 13, inset + 13, w - (inset + 13) * 2, h - (inset + 13) * 2, 14);
  // 描边
  ctx.strokeStyle = GOLD_SOFT;
  // 线宽
  ctx.lineWidth = 1.2;
  // 描边
  ctx.stroke();
  // 四角花饰：在四个角落各画一组同心弧
  const corners = [
    { x: inset + 13, y: inset + 13, sx: 1, sy: 1 },
    { x: w - inset - 13, y: inset + 13, sx: -1, sy: 1 },
    { x: inset + 13, y: h - inset - 13, sx: 1, sy: -1 },
    { x: w - inset - 13, y: h - inset - 13, sx: -1, sy: -1 },
  ];
  // 逐个绘制
  corners.forEach((c) => {
    // 画三层同心弧
    for (let i = 1; i <= 3; i++) {
      // 半径递增
      const rad = 14 * i;
      // 开始路径
      ctx.beginPath();
      // 弧线只画 90 度
      ctx.arc(c.x, c.y, rad, 0, Math.PI / 2);
      // 描边色随半径变淡
      ctx.strokeStyle = i === 1 ? GOLD : GOLD_FAINT;
      // 线宽
      ctx.lineWidth = i === 1 ? 1.8 : 1;
      // 描边
      ctx.stroke();
    }
    // 角上的小菱形，起“铆钉”作用
    ctx.save();
    // 平移到角点
    ctx.translate(c.x, c.y);
    // 按象限缩放翻转，让菱形统一朝向内侧
    ctx.scale(c.sx, c.sy);
    // 菱形路径
    ctx.beginPath();
    // 顶点
    ctx.moveTo(0, -9);
    // 右点
    ctx.lineTo(9, 0);
    // 下点
    ctx.lineTo(0, 9);
    // 左点
    ctx.lineTo(-9, 0);
    // 闭合
    ctx.closePath();
    // 填充高亮金
    ctx.fillStyle = GOLD_HI;
    // 填充
    ctx.fill();
    // 恢复
    ctx.restore();
  });
}

/**
 * 生成牌面通用的底色：径向渐变 + 细腻的星尘噪点。
 * @param {CanvasRenderingContext2D} ctx 上下文
 * @param {number} w 宽
 * @param {number} h 高
 * @param {string} deepColor 深色基调色
 * @param {string} glowColor 中心辉光色
 */
function drawCardBase(ctx, w, h, deepColor, glowColor) {
  // 先铺一层接近纯黑的底
  ctx.fillStyle = deepColor;
  // 填充整块
  ctx.fillRect(0, 0, w, h);
  // 中心径向辉光：让牌面有“自身发光”的层次
  const g = ctx.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.45, h * 0.62);
  // 中心较亮的色调
  g.addColorStop(0, glowColor);
  // 中段过渡
  g.addColorStop(0.55, 'rgba(0,0,0,0.2)');
  // 边缘压暗
  g.addColorStop(1, 'rgba(0,0,0,0.82)');
  // 应用渐变
  ctx.fillStyle = g;
  // 填充
  ctx.fillRect(0, 0, w, h);
  // 铺一层随机星尘，模拟古旧金箔纸的颗粒感
  for (let i = 0; i < 220; i++) {
    // 随机位置
    const x = Math.random() * w;
    // 随机位置
    const y = Math.random() * h;
    // 随机尺寸
    const s = Math.random() * 1.6 + 0.3;
    // 随机透明度
    ctx.fillStyle = `rgba(227, 195, 122, ${Math.random() * 0.11 + 0.02})`;
    // 画点
    ctx.fillRect(x, y, s, s);
  }
}

// ---------------------------------------------------------------------------
// 对外接口：TextureFactory
// ---------------------------------------------------------------------------

/**
 * TextureFactory —— 贴图工厂
 * 统一负责生成并缓存所有程序化纹理，避免重复绘制带来的性能浪费。
 */
export class TextureFactory {
  /**
   * 构造函数。
   */
  constructor() {
    // 纹理解析缓存：键为卡片 id（或特殊名），值为 THREE.CanvasTexture
    this._cache = new Map();
    // 共用的渲染器最大各向异性值，由外部在初始化后注入以提升斜视清晰度
    this.maxAnisotropy = 1;
  }

  /**
   * 设置渲染器的最大各向异性过滤值。
   * @param {number} value 最大各向异性值
   */
  setAnisotropy(value) {
    // 记录该值
    this.maxAnisotropy = value;
    // 已生成的纹理也可以顺手更新
    for (const tex of this._cache.values()) {
      // 设置各向异性
      tex.anisotropy = value;
      // 标记需要重新上传
      tex.needsUpdate = true;
    }
  }

  /**
   * 把离屏画布封装成 three.js 纹理。
   * @param {HTMLCanvasElement} canvas 离屏画布
   * @returns {THREE.CanvasTexture} 纹理对象
   */
  _toTexture(canvas) {
    // 创建 CanvasTexture
    const tex = new THREE.CanvasTexture(canvas);
    // 标记为 sRGB 色彩空间，避免颜色偏灰
    tex.colorSpace = THREE.SRGBColorSpace;
    // 设置各向异性过滤，斜视卡牌时纹理更锐利
    tex.anisotropy = this.maxAnisotropy;
    // 生成 mipmap，远处卡牌不会闪烁
    tex.generateMipmaps = true;
    // 使用三线性过滤
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    // 放大时使用线性过滤
    tex.magFilter = THREE.LinearFilter;
    // 开启横向重复包裹（配合几何体 UV 使用）
    tex.wrapS = THREE.ClampToEdgeWrapping;
    // 开启纵向重复包裹
    tex.wrapT = THREE.ClampToEdgeWrapping;
    // 返回纹理
    return tex;
  }

  /**
   * 生成牌背纹样。牌背是整副牌的“统一门面”，因此设计上追求对称与繁复。
   * @returns {THREE.CanvasTexture} 牌背纹理
   */
  createCardBack() {
    // 命中缓存则直接返回
    if (this._cache.has('__back__')) return this._cache.get('__back__');
    // 创建离屏画布
    const { canvas, ctx } = createCanvas(TEX_W, TEX_H);
    // 铺底色：深夜紫黑
    drawCardBase(ctx, TEX_W, TEX_H, '#0b0916', 'rgba(64, 48, 110, 0.55)');
    // 绘制华丽金框
    drawOrnateFrame(ctx, TEX_W, TEX_H, 16);
    // 牌背中央的曼陀罗：以牌面中心为圆心
    const cx = TEX_W / 2;
    // 圆心 y
    const cy = TEX_H / 2;
    // 基础半径
    const R = TEX_W * 0.36;
    // 由外到内绘制多层同心装饰环
    const rings = [1.0, 0.9, 0.72, 0.58, 0.42, 0.28];
    // 逐个绘制
    rings.forEach((k, i) => {
      // 当前半径
      const r = R * k;
      // 交替使用实线与虚线
      if (i % 2 === 0) {
        // 实线环
        ring(ctx, cx, cy, r, i === 0 ? GOLD : GOLD_SOFT, i === 0 ? 2.6 : 1.2);
      } else {
        // 虚线环
        ctx.save();
        // 设置虚线样式
        ctx.setLineDash([7, 6]);
        // 画环
        ring(ctx, cx, cy, r, GOLD_SOFT, 1.2);
        // 恢复
        ctx.restore();
      }
    });
    // ------------------------------------------------------------------
    // 曼陀罗主体：16 道由内向外收尖的光芒（太阳轮意象）
    // 相比圆润的花瓣，收尖的放射线在远处缩小时依然能保持清晰的骨骼感，
    // 不会糊成一团团色块。
    // ------------------------------------------------------------------
    for (let i = 0; i < 16; i++) {
      // 光芒角度
      const a = (i / 16) * Math.PI * 2;
      // 半角宽度：决定光芒根部的张开程度
      const spread = Math.PI / 16 * 0.52;
      // 内圈半径
      const r0 = R * 0.34;
      // 外圈半径：长短交替，形成节奏
      const r1 = i % 2 === 0 ? R * 0.92 : R * 0.7;
      // 开始绘制一枚收尖的光芒
      ctx.beginPath();
      // 从内圈左侧起笔
      ctx.moveTo(cx + Math.cos(a - spread) * r0, cy + Math.sin(a - spread) * r0);
      // 直线拉到尖端
      ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      // 再从尖端回到内圈右侧
      ctx.lineTo(cx + Math.cos(a + spread) * r0, cy + Math.sin(a + spread) * r0);
      // 闭合，形成一枚细长的三角形光芒
      ctx.closePath();
      // 极淡的金色填充，叠加出层次
      ctx.fillStyle = i % 2 === 0 ? 'rgba(227, 195, 122, 0.1)' : 'rgba(227, 195, 122, 0.05)';
      // 填充
      ctx.fill();
      // 描边：长光芒用实金，短光芒用淡金
      ctx.strokeStyle = i % 2 === 0 ? GOLD_SOFT : GOLD_FAINT;
      // 线宽
      ctx.lineWidth = 1.1;
      // 描边
      ctx.stroke();
    }
    // 光芒外圈的点阵：24 颗小圆点，给曼陀罗收一个整齐的外边界
    for (let i = 0; i < 24; i++) {
      // 点位角度
      const a = (i / 24) * Math.PI * 2;
      // 点位坐标
      const px = cx + Math.cos(a) * R * 0.97;
      // 点位坐标
      const py = cy + Math.sin(a) * R * 0.97;
      // 圆点
      ctx.beginPath();
      // 半径：每隔三颗放大一次，形成节拍感
      ctx.arc(px, py, i % 3 === 0 ? 3.4 : 1.8, 0, Math.PI * 2);
      // 颜色：大点用实金
      ctx.fillStyle = i % 3 === 0 ? GOLD : GOLD_SOFT;
      // 填充
      ctx.fill();
    }
    // 两个交叠的六边形，构成中心的大卫之星意象
    polygonPath(ctx, cx, cy, R * 0.56, 6, -Math.PI / 2);
    // 描边
    ctx.strokeStyle = GOLD;
    // 线宽
    ctx.lineWidth = 2;
    // 描边
    ctx.stroke();
    // 第二个六边形旋转 30 度
    polygonPath(ctx, cx, cy, R * 0.56, 6, -Math.PI / 2 + Math.PI / 6);
    // 描边
    ctx.strokeStyle = GOLD;
    // 线宽
    ctx.lineWidth = 2;
    // 描边
    ctx.stroke();
    // 中心八芒星
    starPath(ctx, cx, cy, R * 0.3, R * 0.11, 8);
    // 淡金填充
    ctx.fillStyle = 'rgba(227, 195, 122, 0.22)';
    // 填充
    ctx.fill();
    // 描边
    ctx.strokeStyle = GOLD_HI;
    // 线宽
    ctx.lineWidth = 1.6;
    // 描边
    ctx.stroke();
    // 中心高亮光点
    const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.22);
    // 中心高亮
    cg.addColorStop(0, 'rgba(255, 243, 208, 0.95)');
    // 外缘透明
    cg.addColorStop(1, 'rgba(255, 243, 208, 0)');
    // 应用
    ctx.fillStyle = cg;
    // 填充
    ctx.beginPath();
    // 圆
    ctx.arc(cx, cy, R * 0.22, 0, Math.PI * 2);
    // 填充
    ctx.fill();
    // 上下两个对称的小三角装饰
    for (const sy of [-1, 1]) {
      // 三角形
      polygonPath(ctx, cx, cy + sy * TEX_H * 0.32, 26, 3, sy > 0 ? 0 : Math.PI);
      // 填充
      ctx.fillStyle = 'rgba(227, 195, 122, 0.16)';
      // 填充
      ctx.fill();
      // 描边
      ctx.strokeStyle = GOLD_SOFT;
      // 线宽
      ctx.lineWidth = 1.4;
      // 描边
      ctx.stroke();
    }
    // 边缘暗角：让牌背中心更突出
    const vg = ctx.createRadialGradient(cx, cy, TEX_W * 0.28, cx, cy, TEX_H * 0.72);
    // 中间透明
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    // 边缘压暗
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    // 应用
    ctx.fillStyle = vg;
    // 填充
    ctx.fillRect(0, 0, TEX_W, TEX_H);
    // 转成纹理
    const tex = this._toTexture(canvas);
    // 写入缓存
    this._cache.set('__back__', tex);
    // 返回
    return tex;
  }

  /**
   * 生成指定卡牌的正面纹理。
   * @param {object} card 卡牌数据对象（来自 cardData.js）
   * @returns {THREE.CanvasTexture} 牌面纹理
   */
  createCardFace(card) {
    // 缓存键使用卡牌 id，保证同一张牌只绘制一次
    const key = `face_${card.id}`;
    // 命中缓存直接返回
    if (this._cache.has(key)) return this._cache.get(key);
    // 创建离屏画布
    const { canvas, ctx } = createCanvas(TEX_W, TEX_H);
    // 取出该牌所属色系的配色
    const palette = SUIT_COLORS[card.suit || 'major'];
    // 铺底色
    drawCardBase(ctx, TEX_W, TEX_H, palette.deep, palette.glow);
    // 绘制金框
    drawOrnateFrame(ctx, TEX_W, TEX_H, 16);
    // 计算牌面中心
    const cx = TEX_W / 2;
    // 中心 y 略微下移，给上方编号留出空间
    const cy = TEX_H * 0.5;
    // 绘制顶部编号
    this._drawIndex(ctx, card, cx, TEX_H * 0.115);
    // 绘制中央符号
    this._drawEmblem(ctx, card, cx, cy);
    // 绘制底部牌名
    this._drawName(ctx, card, cx, TEX_H * 0.885);
    // 顶部与底部各加一条分隔线，强化版面结构
    gradientLine(ctx, TEX_W * 0.24, TEX_H * 0.165, TEX_W * 0.76, TEX_H * 0.165, 'rgba(227,195,122,0)', GOLD, 1.4);
    // 下部分隔线
    gradientLine(ctx, TEX_W * 0.76, TEX_H * 0.165, TEX_W * 0.24, TEX_H * 0.165, 'rgba(227,195,122,0)', GOLD, 1.4);
    // 底部上方的分隔线
    gradientLine(ctx, TEX_W * 0.24, TEX_H * 0.822, TEX_W * 0.76, TEX_H * 0.822, 'rgba(227,195,122,0)', GOLD, 1.4);
    // 底部下方的分隔线
    gradientLine(ctx, TEX_W * 0.76, TEX_H * 0.822, TEX_W * 0.24, TEX_H * 0.822, 'rgba(227,195,122,0)', GOLD, 1.4);
    // 转成纹理并缓存
    const tex = this._toTexture(canvas);
    // 写入缓存
    this._cache.set(key, tex);
    // 返回
    return tex;
  }

  /**
   * 绘制牌面顶部的编号（大阿卡纳用罗马数字，小阿卡纳用花色 + 数字）。
   * @param {CanvasRenderingContext2D} ctx 上下文
   * @param {object} card 卡牌数据
   * @param {number} cx 中心 x
   * @param {number} y 基线 y
   */
  _drawIndex(ctx, card, cx, y) {
    // 统一使用居中对齐
    ctx.textAlign = 'center';
    // 文本基线
    ctx.textBaseline = 'middle';
    // 大阿卡纳使用罗马数字
    const label = card.arcana === 'major' ? card.roman : `${card.rankLabel}`;
    // 设置字体：小号、字距感强的无衬线体
    ctx.font = `600 30px ${FONT_SANS}`;
    // 手动拉开字距：逐字符绘制
    const chars = [...label];
    // 单字符宽度（按字体估算）
    const charW = 26;
    // 整串宽度
    const totalW = chars.length * charW;
    // 起始 x
    const startX = cx - totalW / 2 + charW / 2;
    // 逐字符绘制
    chars.forEach((ch, i) => {
      // 金色填充
      ctx.fillStyle = GOLD;
      // 绘制字符
      ctx.fillText(ch, startX + i * charW, y);
    });
    // 编号两侧的短装饰线
    gradientLine(ctx, cx - totalW / 2 - 46, y, cx - totalW / 2 - 12, y, 'rgba(227,195,122,0)', GOLD, 1.4);
    // 右侧装饰线
    gradientLine(ctx, cx + totalW / 2 + 12, y, cx + totalW / 2 + 46, y, GOLD, 'rgba(227,195,122,0)', 1.4);
  }

  /**
   * 绘制牌面中央的符号。
   * @param {CanvasRenderingContext2D} ctx 上下文
   * @param {object} card 卡牌数据
   * @param {number} cx 中心 x
   * @param {number} cy 中心 y
   */
  _drawEmblem(ctx, card, cx, cy) {
    // 取出该牌所属色系的配色
    const palette = SUIT_COLORS[card.suit || 'major'];
    // 先在外围画一圈光晕底
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, TEX_W * 0.42);
    // 中心带色
    halo.addColorStop(0, palette.glow.replace(/[\d.]+\)$/, '0.16)'));
    // 外缘透明
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    // 应用
    ctx.fillStyle = halo;
    // 填充圆形区域
    ctx.beginPath();
    // 圆
    ctx.arc(cx, cy, TEX_W * 0.42, 0, Math.PI * 2);
    // 填充
    ctx.fill();
    // 符号区外圈：一圈细金环界定视觉范围
    ring(ctx, cx, cy, TEX_W * 0.325, GOLD_FAINT, 1.2);
    // 大阿卡纳：直接绘制对应的符号
    if (card.arcana === 'major') {
      // 取符号绘制函数
      const drawer = SIGIL_DRAWERS[card.sigil] || SIGIL_DRAWERS.rose;
      // 执行绘制，半径取牌面宽度的 0.26
      drawer(ctx, cx, cy, TEX_W * 0.26);
      // 绘制完成
      return;
    }
    // 小阿卡纳：数字牌按点数排布花色符号
    if (card.arcana === 'minor' && card.rank <= 10) {
      // 取该点数的行布局
      const rows = PIP_ROWS[card.rank] || [1];
      // 可用高度区域
      const areaH = TEX_H * 0.42;
      // 可用宽度区域
      const areaW = TEX_W * 0.5;
      // 行高
      const rowH = areaH / rows.length;
      // 单个符号的基础半径
      const unitR = Math.min(rowH * 0.42, areaW / 5);
      // 逐行绘制
      rows.forEach((count, rowIndex) => {
        // 当前行的 y
        const ry = cy - areaH / 2 + rowH * (rowIndex + 0.5);
        // 当前行的横向间距
        const gap = areaW / Math.max(count, 1);
        // 逐列绘制
        for (let i = 0; i < count; i++) {
          // 当前符号的 x：让整行居中
          const rx = cx - areaW / 2 + gap * (i + 0.5);
          // 取花色符号绘制函数
          const drawer = SIGIL_DRAWERS[card.suitGlyph] || SIGIL_DRAWERS.pentacle;
          // 执行绘制
          drawer(ctx, rx, ry, unitR * 0.86, palette.main);
        }
      });
      // 绘制完成
      return;
    }
    // 宫廷牌：绘制盾徽 + 冠饰
    if (card.arcana === 'minor') {
      // 盾牌轮廓
      ctx.beginPath();
      // 盾顶左
      ctx.moveTo(cx - TEX_W * 0.2, cy - TEX_H * 0.13);
      // 盾顶右
      ctx.lineTo(cx + TEX_W * 0.2, cy - TEX_H * 0.13);
      // 右侧下收
      ctx.lineTo(cx + TEX_W * 0.2, cy + TEX_H * 0.03);
      // 底尖
      ctx.quadraticCurveTo(cx + TEX_W * 0.16, cy + TEX_H * 0.13, cx, cy + TEX_H * 0.16);
      // 左下收
      ctx.quadraticCurveTo(cx - TEX_W * 0.16, cy + TEX_H * 0.13, cx - TEX_W * 0.2, cy + TEX_H * 0.03);
      // 闭合
      ctx.closePath();
      // 淡色填充
      ctx.fillStyle = 'rgba(255,255,255,0.045)';
      // 填充
      ctx.fill();
      // 金色描边
      ctx.strokeStyle = GOLD;
      // 线宽
      ctx.lineWidth = 2.4;
      // 描边
      ctx.stroke();
      // 盾内花色符号
      const drawer = SIGIL_DRAWERS[card.suitGlyph] || SIGIL_DRAWERS.pentacle;
      // 执行绘制，位置略微上移给下方冠饰留白
      drawer(ctx, cx, cy - TEX_H * 0.02, TEX_W * 0.105, palette.main);
      // 盾牌上方的冠饰：星数代表宫廷等级（侍从 1 星 → 国王 4 星）
      const stars = card.rank - 10;
      // 逐颗星绘制
      for (let i = 0; i < stars; i++) {
        // 水平均匀分布
        const sx = cx - ((stars - 1) * TEX_W * 0.075) / 2 + i * TEX_W * 0.075;
        // 星点位置
        const sy = cy - TEX_H * 0.165;
        // 四芒星
        starPath(ctx, sx, sy, 11, 4, 4);
        // 填充
        ctx.fillStyle = GOLD_HI;
        // 填充
        ctx.fill();
      }
      // 冠底的一道弧
      ctx.beginPath();
      // 弧线
      ctx.arc(cx, cy - TEX_H * 0.13, TEX_W * 0.2, Math.PI * 1.12, Math.PI * 1.88);
      // 描边
      ctx.strokeStyle = GOLD;
      // 线宽
      ctx.lineWidth = 2;
      // 描边
      ctx.stroke();
    }
  }

  /**
   * 绘制牌面底部的牌名（中文大字 + 英文小字）。
   * @param {CanvasRenderingContext2D} ctx 上下文
   * @param {object} card 卡牌数据
   * @param {number} cx 中心 x
   * @param {number} y 中文名的基线 y
   */
  _drawName(ctx, card, cx, y) {
    // 统一居中对齐
    ctx.textAlign = 'center';
    // 文本基线
    ctx.textBaseline = 'middle';
    // 中文名使用衬线体大字
    ctx.font = `600 46px ${FONT_SERIF}`;
    // 文字阴影：在深色底上制造轻微浮雕感
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    // 阴影模糊半径
    ctx.shadowBlur = 12;
    // 阴影偏移
    ctx.shadowOffsetY = 2;
    // 金色渐变填充
    const g = ctx.createLinearGradient(cx - 100, y - 24, cx + 100, y + 24);
    // 亮金
    g.addColorStop(0, GOLD_HI);
    // 主金
    g.addColorStop(0.5, GOLD);
    // 深金
    g.addColorStop(1, GOLD_DEEP);
    // 应用
    ctx.fillStyle = g;
    // 绘制中文名
    ctx.fillText(card.name, cx, y);
    // 清除阴影，避免影响英文名
    ctx.shadowColor = 'transparent';
    // 归零模糊
    ctx.shadowBlur = 0;
    // 归零偏移
    ctx.shadowOffsetY = 0;
    // 英文名：小号大写字母，字距拉开
    ctx.font = `400 17px ${FONT_SANS}`;
    // 弱金色
    ctx.fillStyle = 'rgba(227, 195, 122, 0.6)';
    // 逐字符绘制以模拟字距
    const en = card.en.toUpperCase();
    // 拆成字符数组
    const chars = [...en];
    // 单字符占位宽度
    const cw = 12;
    // 总宽度
    const total = chars.length * cw;
    // 起始 x
    const startX = cx - total / 2 + cw / 2;
    // 逐字符绘制
    chars.forEach((ch, i) => {
      // 绘制
      ctx.fillText(ch, startX + i * cw, y + 40);
    });
  }

  /**
   * 生成一张径向渐变的光晕精灵纹理，用于泛光、光斑与地面光池。
   * @param {string} inner 中心颜色（含透明度）
   * @param {string} outer 外缘颜色（含透明度）
   * @param {number} [size] 纹理边长
   * @returns {THREE.CanvasTexture} 光晕纹理
   */
  createRadialSprite(inner, outer, size = 256) {
    // 用参数拼出缓存键
    const key = `radial_${inner}_${outer}_${size}`;
    // 命中缓存直接返回
    if (this._cache.has(key)) return this._cache.get(key);
    // 创建正方形画布
    const { canvas, ctx } = createCanvas(size, size);
    // 以中心为圆心创建径向渐变
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    // 中心颜色
    g.addColorStop(0, inner);
    // 四成处的过渡（让边缘更柔和）
    g.addColorStop(0.42, inner.replace(/[\d.]+\)$/, '0.35)'));
    // 外缘颜色
    g.addColorStop(1, outer);
    // 应用
    ctx.fillStyle = g;
    // 填充整块
    ctx.fillRect(0, 0, size, size);
    // 转纹理
    const tex = this._toTexture(canvas);
    // 关闭 mipmap：光晕本身就是模糊的，生成 mipmap 反而浪费
    tex.generateMipmaps = false;
    // 使用线性过滤
    tex.minFilter = THREE.LinearFilter;
    // 写入缓存
    this._cache.set(key, tex);
    // 返回
    return tex;
  }

  /**
   * 生成一张柔和的星点纹理，用于星空粒子。
   * @param {number} [size] 纹理边长
   * @returns {THREE.CanvasTexture} 星点纹理
   */
  createStarSprite(size = 64) {
    // 缓存键
    const key = `star_${size}`;
    // 命中缓存
    if (this._cache.has(key)) return this._cache.get(key);
    // 创建画布
    const { canvas, ctx } = createCanvas(size, size);
    // 中心亮白色渐变
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    // 中心纯白
    g.addColorStop(0, 'rgba(255, 255, 255, 1)');
    // 近核心处迅速衰减
    g.addColorStop(0.16, 'rgba(255, 245, 220, 0.85)');
    // 中段很淡
    g.addColorStop(0.42, 'rgba(220, 210, 255, 0.18)');
    // 外缘透明
    g.addColorStop(1, 'rgba(255, 255, 255, 0)');
    // 应用
    ctx.fillStyle = g;
    // 填充
    ctx.fillRect(0, 0, size, size);
    // 转纹理
    const tex = this._toTexture(canvas);
    // 不用 mipmap
    tex.generateMipmaps = false;
    // 线性过滤
    tex.minFilter = THREE.LinearFilter;
    // 写入缓存
    this._cache.set(key, tex);
    // 返回
    return tex;
  }

  /**
   * 生成地面纹理：深色底 + 细腻的放射状纹理，配合高金属度材质形成“黑曜石桌面”。
   * @param {number} [size] 地面纹理边长
   * @returns {THREE.CanvasTexture} 地面纹理
   */
  createFloorTexture(size = 1024) {
    // 缓存键
    const key = `floor_${size}`;
    // 命中缓存
    if (this._cache.has(key)) return this._cache.get(key);
    // 创建画布
    const { canvas, ctx } = createCanvas(size, size);
    // 纯黑底
    ctx.fillStyle = '#050409';
    // 填充
    ctx.fillRect(0, 0, size, size);
    // 放射状的细密纹理，模拟打磨过的石材
    for (let i = 0; i < 900; i++) {
      // 随机角度
      const a = Math.random() * Math.PI * 2;
      // 随机起始半径
      const r0 = Math.random() * size * 0.5;
      // 随机长度
      const len = Math.random() * 90 + 10;
      // 起点坐标
      const x0 = size / 2 + Math.cos(a) * r0;
      // 起点坐标
      const y0 = size / 2 + Math.sin(a) * r0;
      // 终点坐标
      const x1 = size / 2 + Math.cos(a) * (r0 + len);
      // 终点坐标
      const y1 = size / 2 + Math.sin(a) * (r0 + len);
      // 画一条极淡的纹理线
      gradientLine(ctx, x0, y0, x1, y1, 'rgba(227,195,122,0)', `rgba(227,195,122,${Math.random() * 0.05})`, 0.8);
    }
    // 一组同心圆环，增强“仪式场”的感觉
    for (let i = 1; i <= 8; i++) {
      // 半径按平方分布，越靠外越稀疏
      const r = (size / 2) * Math.pow(i / 8, 1.4);
      // 画环
      ring(ctx, size / 2, size / 2, r, `rgba(227, 195, 122, ${0.05 - i * 0.004})`, 1.2);
    }
    // 中心的星芒阵：12 等分的放射线
    for (let i = 0; i < 12; i++) {
      // 角度
      const a = (i / 12) * Math.PI * 2;
      // 从内到外画线
      gradientLine(
        ctx,
        size / 2 + Math.cos(a) * size * 0.1,
        size / 2 + Math.sin(a) * size * 0.1,
        size / 2 + Math.cos(a) * size * 0.46,
        size / 2 + Math.sin(a) * size * 0.46,
        'rgba(227,195,122,0.1)',
        'rgba(227,195,122,0)',
        1.6
      );
    }
    // 转纹理
    const tex = this._toTexture(canvas);
    // 写入缓存
    this._cache.set(key, tex);
    // 返回
    return tex;
  }

  /**
   * 生成文字精灵纹理（用于 3D 场景中的牌位标签）。
   * @param {string} text 文字内容
   * @param {object} [opts] 可选项
   * @returns {THREE.CanvasTexture} 文字纹理
   */
  createLabelTexture(text, opts = {}) {
    // 解构可选项并给出默认值
    const { color = GOLD, fontSize = 64, letterSpacing = 14, font = FONT_SERIF } = opts;
    // 缓存键
    const key = `label_${text}_${color}_${fontSize}_${letterSpacing}`;
    // 命中缓存
    if (this._cache.has(key)) return this._cache.get(key);
    // 先测量文本宽度：用一个临时画布
    const measure = createCanvas(8, 8);
    // 设置测量字体
    measure.ctx.font = `600 ${fontSize}px ${font}`;
    // 逐字符宽度累加（含字距）
    const chars = [...text];
    // 起始宽度为 0
    let textWidth = 0;
    // 累加
    chars.forEach((ch) => {
      // 加上字符宽度与字距
      textWidth += measure.ctx.measureText(ch).width + letterSpacing;
    });
    // 去掉最后一个多余的字距
    textWidth -= letterSpacing;
    // 画布尺寸留出内边距
    const padX = 48;
    // 纵向内边距
    const padY = 32;
    // 画布宽
    const w = Math.ceil(textWidth + padX * 2);
    // 画布高
    const h = Math.ceil(fontSize * 1.9 + padY * 2);
    // 创建正式画布
    const { canvas, ctx } = createCanvas(w, h);
    // 设置字体
    ctx.font = `600 ${fontSize}px ${font}`;
    // 文本基线居中
    ctx.textBaseline = 'middle';
    // 左对齐后逐字符绘制
    ctx.textAlign = 'left';
    // 发光效果：先画一遍模糊版本作为辉光
    ctx.shadowColor = color;
    // 模糊半径
    ctx.shadowBlur = 22;
    // 填充色
    ctx.fillStyle = color;
    // 当前绘制 x
    let x = padX;
    // 逐字符绘制
    chars.forEach((ch) => {
      // 绘制字符
      ctx.fillText(ch, x, h / 2);
      // 前进到下一个字符位置
      x += ctx.measureText(ch).width + letterSpacing;
    });
    // 再画一遍实心版本，让文字更扎实
    ctx.shadowBlur = 10;
    // 重新遍历
    x = padX;
    // 逐字符绘制
    chars.forEach((ch) => {
      // 绘制
      ctx.fillText(ch, x, h / 2);
      // 前进
      x += ctx.measureText(ch).width + letterSpacing;
    });
    // 转纹理
    const tex = this._toTexture(canvas);
    // 写入缓存
    this._cache.set(key, tex);
    // 返回
    return tex;
  }

  /**
   * 清理过期的牌面缓存。
   * 牌面贴图每次翻开一张新牌就会新增一份（512×852×4 ≈ 1.7MB），
   * 长时间反复占卜会让显存持续膨胀，因此这里做一个简单的容量上限控制：
   * 只保留最近生成的 maxFaces 张牌面，其余释放。
   * @param {number} maxFaces 最多保留的牌面数量
   */
  pruneFaceCache(maxFaces) {
    // 收集所有牌面缓存条目
    const faceKeys = [];
    // 遍历缓存表的键
    for (const [key, tex] of this._cache) {
      // 只处理牌面（键以 face_ 开头）
      if (key.startsWith('face_')) faceKeys.push(key);
    }
    // 未超过上限则不做任何事
    if (faceKeys.length <= maxFaces) return;
    // 需要移除的数量
    const removeCount = faceKeys.length - maxFaces;
    // 从最旧的开始移除（Map 保持插入顺序）
    for (let i = 0; i < removeCount; i++) {
      // 取出键
      const key = faceKeys[i];
      // 取出纹理
      const tex = this._cache.get(key);
      // 释放 GPU 资源
      if (tex) tex.dispose();
      // 从缓存表移除
      this._cache.delete(key);
    }
    // 注意：被释放的纹理材质仍可能被已落位的卡牌引用，
    // 但那些卡牌早已翻面完成，重置牌局时会被整体销毁，因此不会出现悬空引用。
  }

  /**
   * 释放所有缓存的纹理（应用重置时调用）。
   */
  dispose() {
    // 逐个释放 GPU 资源
    for (const tex of this._cache.values()) tex.dispose();
    // 清空缓存表
    this._cache.clear();
  }
}
