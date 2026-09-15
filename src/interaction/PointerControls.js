// ============================================================================
// interaction/PointerControls.js —— 指针输入（鼠标 / 触屏统一）
// ----------------------------------------------------------------------------
// 项目只使用 Pointer Events，因此鼠标、触控板、手指三种输入走的是同一套代码，
// 行为天然一致，不需要为移动端单独再写一套触摸逻辑。
//
// 交互模型（对应真实牌桌上的动作）：
//   按住横向拖拽   牌扇跟着手平移（按像素换算成张数，跟手而不跳格）
//   松手           带惯性继续滑一小段，然后自动吸附到最近的一张牌上
//   按住纵向拖拽   抬高 / 压低镜头
//   点击某张牌     直接把它抽出来（不用先对齐再确认）
//   点击空白处     抽出当前正对镜头的那张牌
//   悬停某张牌     它会被抬到正中并点亮（仅鼠标；触屏没有悬停概念）
//   滚轮           推近 / 拉远
//
// 键盘：← / → 或 A / D 浏览（长按连续滑动）、空格 / 回车确认。
//
// 关于无限滑动：整副 78 张牌是首尾相接的闭环，焦点索引没有上下限，
// 因此无论朝哪个方向、拖多久，都永远不会出现「滑到头」而停住的情况。
// ============================================================================

// 引入 three.js 核心命名空间（射线拾取需要 Raycaster 与 Vector2）
import * as THREE from 'three';
// 引入事件总线
import { Emitter } from '../core/Emitter.js';
// 引入数学工具
import { clamp } from '../core/mathUtils.js';

// ---------------------------------------------------------------------------
// 手感参数：集中定义便于统一调参
// ---------------------------------------------------------------------------

// 单次键盘浏览的步数。
//
// 这里有一个必须踩对的细节：整副牌是 78 张铺成的一圈，
// 一次跨越 N 张，等价于在一圈里以 N 为步长跳跃。
// 只有当 N 与 78 互质时，这个跳跃序列才会遍历全部 78 张牌；
// 若取 3（78 = 3 × 26），就只会循环访问相隔 26 个位置的 26 张牌，
// 剩下 52 张永远翻不到——这是一个非常隐蔽、但完全会让功能失效的坑。
// 取 5（gcd(5, 78) = 1）既能一趟走遍全副牌，约 23 度的跨度手感也正好。
const BROWSE_STEPS = 5;

// 拖拽换算：横向拖过整个屏幕宽度，牌扇大约平移多少张
const DRAG_CARDS_PER_SCREEN = 22;
// 纵向拖拽的视角灵敏度（像素 → 弧度）
const DRAG_PITCH_SENSITIVITY = 0.0022;
// 判定「点击」而非「拖拽」的最大位移（像素）
const CLICK_SLOP = 8;
// 判定「点击」而非「长按」的最长时间（毫秒）
const CLICK_MAX_DURATION = 420;
// 惯性衰减系数（每秒保留比例，越小停得越快）
const INERTIA_DECAY = 0.0016;
// 触发惯性所需的最小速度（张/秒）
const INERTIA_MIN_SPEED = 1.2;
// 惯性速度上限（张/秒），避免甩得太猛
const INERTIA_MAX_SPEED = 34;
// 速度采样窗口（毫秒）
const VELOCITY_WINDOW_MS = 90;
// 悬停射线检测的最小间隔（秒）：每帧都求交没必要，20Hz 完全够用
const HOVER_INTERVAL = 0.05;
// 触发一次「悬停聚焦」所需的指针移动距离（像素）。
// 这个阈值是必须的：牌扇是 61% 重叠的密集排列，聚焦发生变化时会有牌从
// 光标下方滑过，若不加限制，光标下方不断换牌 → 焦点不断跳 → 牌扇反复横跳。
// 加上这个「必须先真的移动一段距离」的条件后，静止的光标永远不会再触发聚焦。
const HOVER_MOVE_THRESHOLD = 26;
// 悬停检测用的帧间隔估算（秒），仅用于累加计时
const HOVER_TICK = 1 / 60;

// 缩放的上下限
const ZOOM_MIN = 0.62;
// 缩放上限
const ZOOM_MAX = 1.45;
// 滚轮灵敏度：每 100 像素 deltaY 对应的缩放变化
const WHEEL_SENSITIVITY = 0.0009;

/**
 * PointerControls —— 指针输入控制器
 * @extends Emitter
 * 事件：
 *   'scroll'    { delta }                    连续滚动（单位为「张」，可为小数）
 *   'snap'      {}                           吸附到最近的牌
 *   'hover'     { card }                     鼠标悬停到某张牌（未命中时为 null）
 *   'select'    { card }                     点击选牌（点在空白处时 card 为 null）
 *   'browse'    { direction, steps }         键盘浏览
 *   'confirm'   {}                           键盘确认当前聚焦的牌
 *   'parallax'  { x, y }                     镜头视差
 */
export class PointerControls extends Emitter {
  /**
   * 构造函数。
   * @param {object} deps 依赖注入
   * @param {HTMLCanvasElement} deps.canvas 3D 画布
   * @param {import('../core/Stage.js').Stage} deps.stage 舞台（写入视角与缩放）
   * @param {import('../tarot/Deck.js').Deck} deps.deck 牌阵（射线拾取）
   */
  constructor({ canvas, stage, deck }) {
    // 调用父类
    super();
    // 保存画布引用
    this.canvas = canvas;
    // 保存舞台引用
    this.stage = stage;
    // 保存牌阵引用
    this.deck = deck;

    // 射线器：用于找出鼠标 / 手指下方是哪张牌
    this._raycaster = new THREE.Raycaster();
    // 归一化设备坐标（-1 ~ 1），复用同一个对象避免每帧新建
    this._ndc = new THREE.Vector2();

    // 是否正在拖拽
    this._dragging = false;
    // 拖拽起点
    this._startX = 0;
    // 拖拽起点
    this._startY = 0;
    // 上一次的指针位置
    this._lastX = 0;
    // 上一次的指针位置
    this._lastY = 0;
    // 本次拖拽累计的位移绝对值（用于区分点击与拖拽）
    this._moveDistance = 0;
    // 按下时刻（毫秒）
    this._downTime = 0;

    // 拖拽速度采样：[{ t, dx }]
    this._samples = [];
    // 惯性速度（张/秒）
    this._inertia = 0;
    // 悬停检测计时器（秒）
    this._hoverTimer = 0;
    // 当前悬停到的牌
    this._hoverCard = null;
    // 上一次触发悬停聚焦时的指针位置（初始放到屏幕外，保证第一次一定会触发）
    this._hoverAnchorX = -9999;
    // 同上
    this._hoverAnchorY = -9999;

    // 当前俯仰偏移（由纵向拖拽累积）
    this._pitch = 0;

    // 绑定事件处理方法，保证 removeEventListener 能对上同一个引用
    this._onPointerDown = this._onPointerDown.bind(this);
    // 绑定指针移动
    this._onPointerMove = this._onPointerMove.bind(this);
    // 绑定指针抬起
    this._onPointerUp = this._onPointerUp.bind(this);
    // 绑定滚轮
    this._onWheel = this._onWheel.bind(this);
    // 绑定键盘
    this._onKeyDown = this._onKeyDown.bind(this);
  }

  /**
   * 启用输入。
   */
  enable() {
    // 指针按下只挂在画布上：点在侧边面板上不应该开始拖拽牌扇
    this.canvas.addEventListener('pointerdown', this._onPointerDown);
    // 指针移动挂在 window 上，拖出画布也能继续跟随
    window.addEventListener('pointermove', this._onPointerMove);
    // 指针抬起
    window.addEventListener('pointerup', this._onPointerUp);
    // 指针取消（触摸被系统打断）
    window.addEventListener('pointercancel', this._onPointerUp);
    // 滚轮缩放，passive:false 以便阻止页面滚动
    this.canvas.addEventListener('wheel', this._onWheel, { passive: false });
    // 键盘
    window.addEventListener('keydown', this._onKeyDown);
  }

  /**
   * 关闭输入。
   */
  disable() {
    // 逐个移除监听，保持与 enable 完全对称
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    // 移除指针移动
    window.removeEventListener('pointermove', this._onPointerMove);
    // 移除指针抬起
    window.removeEventListener('pointerup', this._onPointerUp);
    // 移除指针取消
    window.removeEventListener('pointercancel', this._onPointerUp);
    // 移除滚轮
    this.canvas.removeEventListener('wheel', this._onWheel);
    // 移除键盘
    window.removeEventListener('keydown', this._onKeyDown);
  }

  /**
   * 把屏幕坐标换算成归一化设备坐标并求交，返回命中的卡牌。
   * @param {number} clientX 屏幕 x
   * @param {number} clientY 屏幕 y
   * @returns {object|null} 命中的卡牌实例
   */
  _pick(clientX, clientY) {
    // 画布在页面中的位置与尺寸
    const rect = this.canvas.getBoundingClientRect();
    // 横向归一化到 -1 ~ 1
    this._ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    // 纵向归一化到 -1 ~ 1（屏幕 y 向下，NDC y 向上，所以取反）
    this._ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    // 用相机与归一化坐标设置射线
    this._raycaster.setFromCamera(this._ndc, this.stage.camera);
    // 交给牌阵求交
    return this.deck.pickCard(this._raycaster);
  }

  /**
   * 指针按下：开始拖拽，同时中断惯性。
   * @param {PointerEvent} e 事件对象
   */
  _onPointerDown(e) {
    // 鼠标只响应左键
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // 开始拖拽
    this._dragging = true;
    // 记录起点
    this._startX = e.clientX;
    // 记录起点
    this._startY = e.clientY;
    // 初始化上一次位置
    this._lastX = e.clientX;
    // 初始化上一次位置
    this._lastY = e.clientY;
    // 位移清零
    this._moveDistance = 0;
    // 记录按下时刻
    this._downTime = performance.now();
    // 打断惯性：手一按下去牌扇就应该立刻停住，这是最基本的物理直觉
    this._inertia = 0;
    // 清空速度采样
    this._samples.length = 0;
  }

  /**
   * 指针移动：拖拽时滚动牌扇 / 调整视角；未拖拽时做悬停检测。
   * @param {PointerEvent} e 事件对象
   */
  _onPointerMove(e) {
    // ------------------------------------------------------------------
    // 未拖拽：鼠标悬停到某张牌上就把它抬到正中
    // ------------------------------------------------------------------
    if (!this._dragging) {
      // 触屏没有悬停概念，直接跳过
      if (e.pointerType !== 'mouse') return;
      // 用指针位置产生轻微视差，让画面随鼠标「活」起来
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      // 纵向同样归一化
      const ny = (e.clientY / window.innerHeight) * 2 - 1;
      // 广播视差事件，强度刻意压低，避免喧宾夺主
      this.emit('parallax', { x: nx * 0.35, y: ny * 0.35 });
      // 悬停检测限频：每帧都做射线求交是浪费
      this._hoverTimer += HOVER_TICK;
      // 未到间隔则跳过
      if (this._hoverTimer < HOVER_INTERVAL) return;
      // 重置计时
      this._hoverTimer = 0;
      // 求交
      const card = this._pick(e.clientX, e.clientY);
      // 指针相对上一次触发点的移动距离
      const moved = Math.abs(e.clientX - this._hoverAnchorX) + Math.abs(e.clientY - this._hoverAnchorY);
      // 必须「换了一张牌」且「指针确实移动过一段距离」才广播，两个条件缺一不可
      if (card !== this._hoverCard && moved > HOVER_MOVE_THRESHOLD) {
        // 记录当前悬停目标
        this._hoverCard = card;
        // 记录本次触发点，作为下一次的基准
        this._hoverAnchorX = e.clientX;
        // 同上
        this._hoverAnchorY = e.clientY;
        // 广播
        this.emit('hover', { card });
      }
      // 结束
      return;
    }

    // ------------------------------------------------------------------
    // 拖拽中
    // ------------------------------------------------------------------
    // 本次横向增量
    const dx = e.clientX - this._lastX;
    // 本次纵向增量
    const dy = e.clientY - this._lastY;
    // 更新上一次位置
    this._lastX = e.clientX;
    // 更新上一次位置
    this._lastY = e.clientY;
    // 累加位移绝对值
    this._moveDistance += Math.abs(dx) + Math.abs(dy);

    // ---- 横向：滚动牌扇 ----
    // 把像素换算成「张」：拖过整屏宽度约等于平移 DRAG_CARDS_PER_SCREEN 张。
    // 取负号是因为「向左拖」应该让牌扇向左走（也就是焦点索引增大）。
    const stepDelta = (-dx / Math.max(this.canvas.clientWidth, 1)) * DRAG_CARDS_PER_SCREEN;
    // 广播连续滚动
    this.emit('scroll', { delta: stepDelta });

    // ---- 纵向：压低 / 抬高镜头 ----
    // 累积俯仰偏移（向下拖 → 视角压低）
    this._pitch = clamp(this._pitch + dy * DRAG_PITCH_SENSITIVITY, -0.5, 0.5);
    // 写入舞台
    this.stage.setOrbit(0, this._pitch);

    // ---- 记录速度采样，用于松手后的惯性 ----
    this._samples.push({ t: performance.now(), dx });
    // 丢弃过期样本
    while (this._samples.length > 2 && performance.now() - this._samples[0].t > VELOCITY_WINDOW_MS) {
      // 移除最旧的
      this._samples.shift();
    }
  }

  /**
   * 指针抬起：判定点击 / 计算惯性 / 吸附对齐。
   * @param {PointerEvent} e 事件对象
   */
  _onPointerUp(e) {
    // 未处于拖拽状态则忽略
    if (!this._dragging) return;
    // 结束拖拽
    this._dragging = false;
    // 拖拽持续时长（毫秒）
    const duration = performance.now() - this._downTime;

    // ------------------------------------------------------------------
    // 1. 判定「点击 / 轻点」：位移很小且时间很短
    // ------------------------------------------------------------------
    if (this._moveDistance <= CLICK_SLOP && duration <= CLICK_MAX_DURATION) {
      // 求出点击位置下方的牌
      const card = this._pick(e.clientX, e.clientY);
      // 广播选牌事件：点到牌上就是那张牌，点在空白处为 null（由 App 决定选当前聚焦的牌）
      this.emit('select', { card });
      // 点击不产生惯性
      this._inertia = 0;
      // 清空采样
      this._samples.length = 0;
      // 视角回正
      this._pitch = 0;
      // 写入舞台
      this.stage.setOrbit(0, 0);
      // 结束
      return;
    }

    // ------------------------------------------------------------------
    // 2. 计算惯性速度
    // ------------------------------------------------------------------
    // 样本足够才计算
    if (this._samples.length >= 2) {
      // 取窗口内最早与最新的样本
      const first = this._samples[0];
      // 末尾样本
      const last = this._samples[this._samples.length - 1];
      // 时间跨度（秒），避免除零
      const span = Math.max((last.t - first.t) / 1000, 1e-3);
      // 累加窗口内的横向总位移（像素）
      let sumDx = 0;
      // 逐个累加
      for (const sample of this._samples) sumDx += sample.dx;
      // 换算成「张/秒」
      const speed = (-sumDx / span / Math.max(this.canvas.clientWidth, 1)) * DRAG_CARDS_PER_SCREEN;
      // 只有超过阈值才保留惯性——否则轻微手抖也会让牌扇慢慢漂走
      this._inertia =
        Math.abs(speed) > INERTIA_MIN_SPEED ? clamp(speed, -INERTIA_MAX_SPEED, INERTIA_MAX_SPEED) : 0;
    } else {
      // 样本不足，不产生惯性
      this._inertia = 0;
    }

    // ------------------------------------------------------------------
    // 3. 吸附对齐：松手后总要让某一张牌正对镜头
    // ------------------------------------------------------------------
    if (this._inertia === 0) {
      // 没有惯性则立即吸附
      this.emit('snap', {});
    }
    // 有惯性时由 update() 在惯性结束后吸附

    // ------------------------------------------------------------------
    // 4. 视角缓缓回正
    // ------------------------------------------------------------------
    this._pitch = 0;
    // 写入舞台（回正动画由舞台的阻尼自然完成）
    this.stage.setOrbit(0, 0);
  }

  /**
   * 滚轮：推近或拉远镜头。
   * @param {WheelEvent} e 事件对象
   */
  _onWheel(e) {
    // 阻止页面滚动
    e.preventDefault();
    // 根据 deltaY 调整缩放
    this.stage.zoom = clamp(this.stage.zoom - e.deltaY * WHEEL_SENSITIVITY, ZOOM_MIN, ZOOM_MAX);
  }

  /**
   * 键盘按下：左右浏览、空格确认。
   * @param {KeyboardEvent} e 事件对象
   */
  _onKeyDown(e) {
    // 焦点在输入框里时不拦截任何按键
    const tag = (e.target && e.target.tagName) || '';
    // 输入类元素放行
    if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return;

    // 依据按键分发
    switch (e.key) {
      // 向左浏览
      case 'ArrowLeft':
      case 'a':
      case 'A':
        // 阻止页面滚动
        e.preventDefault();
        // 广播浏览事件
        this.emit('browse', { direction: -1, steps: BROWSE_STEPS });
        // 结束
        break;
      // 向右浏览
      case 'ArrowRight':
      case 'd':
      case 'D':
        // 阻止页面滚动
        e.preventDefault();
        // 广播浏览事件
        this.emit('browse', { direction: 1, steps: BROWSE_STEPS });
        // 结束
        break;
      // 确认
      case ' ':
      case 'Enter':
        // 阻止默认行为（空格会滚动页面）
        e.preventDefault();
        // 广播确认事件
        this.emit('confirm', {});
        // 结束
        break;
      // 其余按键不处理
      default:
        // 什么都不做
        break;
    }
  }

  /**
   * 每帧更新：推进惯性滚动。
   * @param {number} dt 帧间隔（秒）
   */
  update(dt) {
    // 没有惯性则跳过
    if (this._inertia === 0) return;
    // 本帧要滚动的张数
    const delta = this._inertia * dt;
    // 广播滚动
    this.emit('scroll', { delta });
    // 指数衰减（帧率无关）
    this._inertia *= Math.pow(INERTIA_DECAY, dt);
    // 速度足够小就停下来，并吸附到最近的一张牌
    if (Math.abs(this._inertia) < INERTIA_MIN_SPEED) {
      // 归零
      this._inertia = 0;
      // 吸附
      this.emit('snap', {});
    }
  }

  /**
   * 主动停止惯性（例如玩家点击了界面按钮）。
   */
  stopInertia() {
    // 直接归零
    this._inertia = 0;
  }
}
