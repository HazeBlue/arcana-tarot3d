// ============================================================================
// interaction/HandOverlay.js —— 手部关键点叠加层与手势光标
// ----------------------------------------------------------------------------
// 职责：
//   1. 在摄像头预览画布上绘制手部骨架，让用户直观看到「机器眼中的手」；
//   2. 驱动页面上的金色手势光标跟随手掌中心移动；
//   3. 根据当前姿态与滑动状态切换视觉反馈（握拳收缩、滑动拖尾）。
// ============================================================================

// 手部骨骼连线定义（MediaPipe 标准拓扑）
const HAND_CONNECTIONS = [
  // 拇指
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  // 食指
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  // 中指（含掌横纹连接）
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  // 无名指
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  // 小指
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  // 掌根横线
  [0, 17],
];

// 指尖编号，用于画高亮圆点
const FINGER_TIPS = [4, 8, 12, 16, 20];

/**
 * HandOverlay —— 手部叠加层
 */
export class HandOverlay {
  /**
   * 构造函数。
   * @param {object} deps 依赖注入
   * @param {HTMLCanvasElement} deps.canvas 叠加层画布
   * @param {HTMLElement} deps.cursor 页面上跟随手掌的光标元素
   * @param {import('./GestureRecognizer.js').GestureRecognizer} deps.recognizer 手势识别器
   */
  constructor({ canvas, cursor, recognizer }) {
    // 保存画布引用
    this.canvas = canvas;
    // 取得 2D 上下文
    this.ctx = canvas.getContext('2d');
    // 保存光标元素
    this.cursor = cursor;
    // 保存识别器引用（用于读取姿态与手掌位置）
    this.recognizer = recognizer;

    // 最近一帧的关键点
    this.landmarks = null;
    // 是否为第一帧（用于延迟设置画布尺寸）
    this._sized = false;

    // 光标的平滑位置（屏幕像素）
    this._cursorX = window.innerWidth / 2;
    // 光标 y
    this._cursorY = window.innerHeight / 2;
    // 上一次姿态，用于避免重复写 class
    this._lastPosture = 'none';
  }

  /**
   * 接收一帧关键点。
   * @param {Array|null} landmarks 21 个归一化关键点
   * @param {number} videoWidth 视频宽度
   * @param {number} videoHeight 视频高度
   */
  setFrame(landmarks, videoWidth, videoHeight) {
    // 记录关键点
    this.landmarks = landmarks;
    // 视频尺寸有效且尚未设置过画布尺寸
    if (!this._sized && videoWidth > 0) {
      // 画布尺寸与视频内部分辨率保持一致，保证绘制清晰
      this.canvas.width = videoWidth;
      // 高度同步
      this.canvas.height = videoHeight;
      // 标记已设置
      this._sized = true;
    }
  }

  /**
   * 每帧绘制叠加层。
   * @param {number} dt 帧间隔（秒）
   */
  update(dt) {
    // 取出上下文
    const ctx = this.ctx;
    // 取出识别器
    const rec = this.recognizer;
    // 当前姿态
    const posture = rec.getPosture();

    // ------------------------------------------------------------------
    // 1. 清空画布
    // ------------------------------------------------------------------
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    // ------------------------------------------------------------------
    // 2. 绘制手部骨架
    // ------------------------------------------------------------------
    if (this.landmarks && this.canvas.width > 0) {
      // 画布宽高
      const W = this.canvas.width;
      // 画布高
      const H = this.canvas.height;

      // 把归一化坐标转成画布像素坐标，并做水平镜像以匹配 video 的 CSS 镜像
      const toScreen = (p) => ({ x: (1 - p.x) * W, y: p.y * H });

      // 依据姿态选择主色调
      let boneColor = 'rgba(227, 195, 122, 0.9)';
      // 张开手掌用暖金
      if (posture === 'open') boneColor = 'rgba(255, 224, 150, 0.95)';
      // 握拳用青绿，暗示「确认」
      else if (posture === 'fist') boneColor = 'rgba(126, 224, 176, 0.95)';

      // 先画骨骼连线
      ctx.lineWidth = Math.max(2, W * 0.006);
      // 圆头端点
      ctx.lineCap = 'round';
      // 连线颜色
      ctx.strokeStyle = boneColor;
      // 叠加发光
      ctx.shadowColor = boneColor;
      // 发光半径
      ctx.shadowBlur = W * 0.014;
      // 遍历全部连线
      for (const [a, b] of HAND_CONNECTIONS) {
        // 取两端点
        const pa = toScreen(this.landmarks[a]);
        // 另一端
        const pb = toScreen(this.landmarks[b]);
        // 开始路径
        ctx.beginPath();
        // 移动到起点
        ctx.moveTo(pa.x, pa.y);
        // 连到终点
        ctx.lineTo(pb.x, pb.y);
        // 描边
        ctx.stroke();
      }

      // 再画关节点
      ctx.shadowBlur = W * 0.01;
      // 遍历 21 个关键点
      for (let i = 0; i < this.landmarks.length; i++) {
        // 转屏幕坐标
        const p = toScreen(this.landmarks[i]);
        // 是否为指尖
        const isTip = FINGER_TIPS.includes(i);
        // 指尖画大一些
        const r = isTip ? W * 0.011 : W * 0.0065;
        // 开始路径
        ctx.beginPath();
        // 画圆
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        // 指尖用高亮白金色，其余用主色
        ctx.fillStyle = isTip ? '#fff6dd' : boneColor;
        // 填充
        ctx.fill();
      }

      // 手掌中心额外画一个空心环，提示这是「光标锚点」
      const palm = toScreen({
        // 复用识别器平滑后的坐标
        x: 1 - rec.palmX,
        // y 坐标
        y: rec.palmY,
      });
      // 开始路径
      ctx.beginPath();
      // 空心圆
      ctx.arc(palm.x, palm.y, W * 0.026, 0, Math.PI * 2);
      // 描边颜色
      ctx.strokeStyle = 'rgba(255, 243, 208, 0.85)';
      // 线宽
      ctx.lineWidth = Math.max(1.5, W * 0.0045);
      // 清除发光避免糊成一团
      ctx.shadowBlur = 0;
      // 描边
      ctx.stroke();

      // 恢复阴影设置
      ctx.shadowBlur = 0;
    }

    // ------------------------------------------------------------------
    // 3. 驱动页面上的手势光标
    // ------------------------------------------------------------------
    // 手在场时才显示光标
    const present = rec.handPresent;
    // 切换显示状态
    this.cursor.hidden = !present;
    // 有手时更新位置
    if (present) {
      // 目标屏幕坐标：把手掌的归一化坐标映射到整个视口
      // x 方向做一次放大（1.35 倍）再夹紧，让小幅移动也能覆盖整个屏幕宽度
      const targetX = (0.5 + (rec.palmX - 0.5) * 1.35) * window.innerWidth;
      // y 方向同样放大
      const targetY = (0.5 + (rec.palmY - 0.5) * 1.35) * window.innerHeight;
      // 用指数阻尼平滑跟随
      const k = 1 - Math.pow(0.00002, dt);
      // 平滑 x
      this._cursorX += (targetX - this._cursorX) * k;
      // 平滑 y
      this._cursorY += (targetY - this._cursorY) * k;
      // 应用到元素的 transform
      this.cursor.style.transform = `translate3d(${this._cursorX}px, ${this._cursorY}px, 0)`;

      // 姿态变化时切换 class，驱动 CSS 反馈
      if (posture !== this._lastPosture) {
        // 记录
        this._lastPosture = posture;
        // 握拳时加上收缩样式
        this.cursor.classList.toggle('is-fist', posture === 'fist');
      }
    }
  }

  /**
   * 释放资源。
   */
  dispose() {
    // 清空关键点
    this.landmarks = null;
  }
}
