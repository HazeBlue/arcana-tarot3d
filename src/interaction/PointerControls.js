// ============================================================================
// interaction/PointerControls.js —— 键鼠降级操作
// ----------------------------------------------------------------------------
// 手势并非人人可用（没有摄像头、拒绝授权、环境不支持 https），
// 因此键鼠必须是一条完整可用的操作路径，而不是摆设。
// 本模块把键鼠事件翻译成与手势完全一致的语义事件，App 层无需区分来源。
//
// 键位：
//   ArrowLeft / ArrowRight / A / D   切换聚焦的牌
//   Space / Enter / 点击画布         确认当前聚焦的牌
//   鼠标拖拽                         转动视角
//   滚轮                             推近 / 拉远
// ============================================================================

// 引入事件总线
import { Emitter } from '../core/Emitter.js';
// 引入数学工具
import { clamp } from '../core/mathUtils.js';

// 拖拽灵敏度：像素 → 弧度
const DRAG_SENSITIVITY = 0.0022;
// 滚轮灵敏度：每 100 像素 deltaY 对应的缩放变化
const WHEEL_SENSITIVITY = 0.0009;
// 缩放的上下限
const ZOOM_MIN = 0.62;
// 缩放上限
const ZOOM_MAX = 1.45;

/**
 * PointerControls —— 键鼠控制器
 * @extends Emitter
 * 事件与手势识别器保持一致：'browse' / 'confirm' / 'parallax'
 */
export class PointerControls extends Emitter {
  /**
   * 构造函数。
   * @param {object} deps 依赖注入
   * @param {HTMLCanvasElement} deps.canvas 3D 画布（作为拖拽与点击的目标）
   * @param {import('../core/Stage.js').Stage} deps.stage 舞台（用于写入视角与缩放）
   */
  constructor({ canvas, stage }) {
    // 调用父类
    super();
    // 保存画布引用
    this.canvas = canvas;
    // 保存舞台引用
    this.stage = stage;

    // 是否正在拖拽
    this._dragging = false;
    // 上一次指针位置
    this._lastX = 0;
    // 上一次指针 y
    this._lastY = 0;
    // 拖拽累计距离，用于区分「点击」与「拖拽」
    this._dragDistance = 0;
    // 当前视角偏移（由拖拽累积）
    this._yaw = 0;
    // 垂直视角偏移
    this._pitch = 0;

    // 绑定事件处理方法，保证 removeEventListener 能对上同一个引用
    this._onPointerDown = this._onPointerDown.bind(this);
    // 绑定指针移动
    this._onPointerMove = this._onPointerMove.bind(this);
    // 绑定指针抬起
    this._onPointerUp = this._onPointerUp.bind(this);
    // 绑定滚轮
    this._onWheel = this._onWheel.bind(this);
    // 绑定键盘按下
    this._onKeyDown = this._onKeyDown.bind(this);
  }

  /**
   * 启用键鼠控制。
   */
  enable() {
    // 指针按下
    this.canvas.addEventListener('pointerdown', this._onPointerDown);
    // 指针移动（挂在 window 上，拖出画布也能继续）
    window.addEventListener('pointermove', this._onPointerMove);
    // 指针抬起
    window.addEventListener('pointerup', this._onPointerUp);
    // 指针取消（如触摸被系统打断）
    window.addEventListener('pointercancel', this._onPointerUp);
    // 滚轮缩放，passive:false 以便阻止页面滚动
    this.canvas.addEventListener('wheel', this._onWheel, { passive: false });
    // 键盘监听挂在 window 上
    window.addEventListener('keydown', this._onKeyDown);
  }

  /**
   * 关闭键鼠控制。
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
   * 指针按下：开始拖拽。
   * @param {PointerEvent} e 事件对象
   */
  _onPointerDown(e) {
    // 只响应鼠标左键或触摸
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // 标记拖拽中
    this._dragging = true;
    // 记录起点
    this._lastX = e.clientX;
    // 记录起点
    this._lastY = e.clientY;
    // 重置累计距离
    this._dragDistance = 0;
  }

  /**
   * 指针移动：拖拽时转动视角，非拖拽时产生视差。
   * @param {PointerEvent} e 事件对象
   */
  _onPointerMove(e) {
    // 未拖拽时：用指针位置产生轻微视差，让画面「活」起来
    if (!this._dragging) {
      // 归一化到 -1 ~ 1
      const nx = (e.clientX / window.innerWidth) * 2 - 1;
      // 归一化到 -1 ~ 1
      const ny = (e.clientY / window.innerHeight) * 2 - 1;
      // 广播视差事件，强度比手势弱一些，避免喧宾夺主
      this.emit('parallax', { x: nx * 0.35, y: ny * 0.35 });
      // 兼容鼠标：同时产生视差
      return;
    }

    // 计算本次位移
    const dx = e.clientX - this._lastX;
    // 计算本次位移
    const dy = e.clientY - this._lastY;
    // 更新起点
    this._lastX = e.clientX;
    // 更新起点
    this._lastY = e.clientY;
    // 累加拖拽距离
    this._dragDistance += Math.abs(dx) + Math.abs(dy);

    // 累积视角偏移（向右拖拽 → 视角向右转）
    this._yaw -= dx * DRAG_SENSITIVITY;
    // 垂直方向：向上拖拽 → 视角抬高
    this._pitch += dy * DRAG_SENSITIVITY;
    // 夹紧水平角度
    this._yaw = clamp(this._yaw, -0.9, 0.9);
    // 夹紧垂直角度
    this._pitch = clamp(this._pitch, -0.5, 0.5);
    // 写入舞台
    this.stage.setOrbit(this._yaw, this._pitch);
  }

  /**
   * 指针抬起：结束拖拽，若位移足够小则视为「点击确认」。
   * @param {PointerEvent} e 事件对象
   */
  _onPointerUp(e) {
    // 未处于拖拽状态则忽略
    if (!this._dragging) return;
    // 结束拖拽
    this._dragging = false;
    // 位移很小视为点击
    if (this._dragDistance < 6) {
      // 广播确认事件
      this.emit('confirm', { source: 'click' });
    }
    // 让视角缓缓回正：把目标偏移归零，由舞台的阻尼自然回位
    this._yaw = 0;
    // 垂直方向同样归零
    this._pitch = 0;
    // 写入舞台
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
    // 若焦点在输入框里，则不拦截任何按键
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
        // 广播浏览事件（与手势 swipe 语义一致）
        this.emit('browse', { direction: -1, steps: 1, source: 'keyboard' });
        // 结束
        break;
      // 向右浏览
      case 'ArrowRight':
      case 'd':
      case 'D':
        // 阻止页面滚动
        e.preventDefault();
        // 广播浏览事件
        this.emit('browse', { direction: 1, steps: 1, source: 'keyboard' });
        // 结束
        break;
      // 确认
      case ' ':
      case 'Enter':
        // 阻止默认行为（空格会滚动页面）
        e.preventDefault();
        // 广播确认事件
        this.emit('confirm', { source: 'keyboard' });
        // 结束
        break;
      // 其余按键不处理
      default:
        // 什么都不做
        break;
    }
  }
}
