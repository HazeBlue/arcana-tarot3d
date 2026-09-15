// ============================================================================
// interaction/GestureRecognizer.js —— 手势识别器（纯逻辑，不碰 DOM）
// ----------------------------------------------------------------------------
// 输入：MediaPipe HandLandmarker 输出的 21 个手部关键点（归一化坐标 0~1）
// 输出：语义化事件
//     'hand'     是否检测到手（用于 UI 提示）
//     'move'     手掌中心移动（用于镜头视差与光标）
//     'posture'  姿态变化：'open' 张开 | 'fist' 握拳 | 'other' 其它
//     'swipe'    张开手掌快速横滑：{ direction: 1|-1, steps: 1~4 }
//     'confirm'  握拳保持一段时间：确认当前聚焦的牌
//
// 关键点编号约定（MediaPipe 标准）：
//     0 手腕
//     1~4   拇指（CMC / MCP / IP / TIP）
//     5~8   食指（MCP / PIP / DIP / TIP）
//     9~12  中指
//     13~16 无名指
//     17~20 小指
// ============================================================================

// 引入事件总线
import { Emitter } from '../core/Emitter.js';
// 引入数学工具
import { clamp } from '../core/mathUtils.js';

// ---------------------------------------------------------------------------
// 识别阈值：集中定义便于调参
// ---------------------------------------------------------------------------

// 判定手指「伸直」的比值阈值：指尖到手腕的距离需大于该关节到手腕距离的若干倍
const EXTEND_RATIO = 1.14;
// 判定拇指「张开」的阈值：拇指尖与小指根的距离需大于手长的若干倍
const THUMB_OPEN_RATIO = 0.86;
// 判定「张开手掌」所需的最少伸直手指数
const OPEN_MIN_FINGERS = 4;
// 判定「握拳」允许的最大伸直手指数
const FIST_MAX_FINGERS = 1;
// 姿态需要连续保持的时长（秒）才被确认，避免抖动误判
const POSTURE_HOLD = 0.09;
// 触发滑动的速度阈值（归一化坐标 / 秒）
const SWIPE_SPEED = 0.62;
// 触发滑动所需的最小位移（归一化坐标）
const SWIPE_MIN_DISTANCE = 0.085;
// 两次滑动之间的冷却时间（秒）
const SWIPE_COOLDOWN = 0.34;
// 滑动后需要把手速降下来的阈值，避免一次滑动连续触发
const SWIPE_RELEASE_SPEED = 0.3;
// 触发确认手势需要握拳保持的时长（秒）
const CONFIRM_HOLD = 0.42;
// 两次确认之间的冷却时间（秒）
const CONFIRM_COOLDOWN = 0.9;
// 速度采样的时间窗口（秒）
const VELOCITY_WINDOW = 0.19;
// 手部丢失多久后重置状态（秒）
const LOST_TIMEOUT = 0.4;

/**
 * GestureRecognizer —— 手势识别器
 * @extends Emitter
 */
export class GestureRecognizer extends Emitter {
  /**
   * 构造函数。
   */
  constructor() {
    // 调用父类构造函数，获得事件能力
    super();

    // 速度采样缓冲：每项为 { t, x, y }
    this._samples = [];
    // 上次滑动的时间戳（秒）
    this._lastSwipeAt = -99;
    // 上次确认的时间戳（秒）
    this._lastConfirmAt = -99;
    // 上一次的横滑速度（用于判定“释放”）
    this._lastSwipeSpeed = 0;
    // 滑动是否处于「已触发、等待释放」状态
    this._swipeArmed = false;

    // 当前姿态与其维持时长
    this._posture = 'none';
    // 候选姿态（等待确认中）
    this._pendingPosture = 'none';
    // 候选姿态已保持的时长
    this._pendingDuration = 0;

    // 最近一次检测到手的时间
    this._lastSeenAt = 0;
    // 当前是否检测到手
    this.handPresent = false;

    // 平滑后的手掌中心位置，避免光标抖动
    this.palmX = 0.5;
    // 平滑后的手掌中心 y
    this.palmY = 0.5;
    // 是否已有有效的平滑基准
    this._hasPalm = false;
  }

  /**
   * 重置全部状态（手部丢失或重新开启手势时调用）。
   */
  reset() {
    // 清空采样缓冲
    this._samples.length = 0;
    // 清空姿态
    this._posture = 'none';
    // 清空候选姿态
    this._pendingPosture = 'none';
    // 清零计时
    this._pendingDuration = 0;
    // 解除滑动锁定
    this._swipeArmed = false;
    // 清除平滑基准
    this._hasPalm = false;
    // 标记手部不在场
    this.handPresent = false;
  }

  /**
   * 主入口：喂入一帧关键点数据。
   * @param {Array<{x:number,y:number,z:number}>|null} landmarks 21 个归一化关键点；未检测到时传 null
   * @param {number} dt 距上一帧的时间（秒）
   */
  feed(landmarks, dt) {
    // 累加时间戳（用一个内部时钟即可，无需绝对时间）
    this._clock = (this._clock || 0) + dt;
    // 取出当前时刻
    const now = this._clock;

    // ------------------------------------------------------------------
    // 1. 未检测到手：超时后重置并通知外部
    // ------------------------------------------------------------------
    if (!landmarks || landmarks.length < 21) {
      // 若之前是「有手」状态，且超时
      if (this.handPresent && now - this._lastSeenAt > LOST_TIMEOUT) {
        // 重置状态
        this.reset();
        // 通知外部手部丢失
        this.emit('hand', { present: false });
      }
      // 直接返回
      return;
    }

    // ------------------------------------------------------------------
    // 2. 首次检测到手：通知外部
    // ------------------------------------------------------------------
    if (!this.handPresent) {
      // 标记在场
      this.handPresent = true;
      // 通知外部
      this.emit('hand', { present: true });
    }
    // 记录最后出现时间
    this._lastSeenAt = now;

    // ------------------------------------------------------------------
    // 3. 计算手掌中心（镜像处理：让「手往右移」等价于「画面往右」）
    // ------------------------------------------------------------------
    // 手掌中心取手腕与四个掌指的均值
    const palm = this._palmCenter(landmarks);
    // 镜像 x 坐标
    const mx = 1 - palm.x;
    // y 坐标保持不变
    const my = palm.y;

    // 首次获得位置时直接作为基准，避免从默认值缓慢飘移
    if (!this._hasPalm) {
      // 写入基准
      this.palmX = mx;
      // 写入基准
      this.palmY = my;
      // 标记已有基准
      this._hasPalm = true;
    } else {
      // 用指数平滑降低抖动（约 12 帧的时间常数）
      const k = 1 - Math.pow(0.0001, dt);
      // 平滑 x
      this.palmX += (mx - this.palmX) * k;
      // 平滑 y
      this.palmY += (my - this.palmY) * k;
    }

    // 广播移动事件，载荷为归一化坐标（0~1）
    this.emit('move', { x: this.palmX, y: this.palmY, rawX: mx, rawY: my });

    // ------------------------------------------------------------------
    // 4. 姿态判定：统计伸直的手指数
    // ------------------------------------------------------------------
    // 计算手部尺度（手腕到中指根的欧氏距离），用于归一化各种距离
    const handScale = Math.max(this._dist(landmarks[0], landmarks[9]), 1e-4);
    // 统计伸直的手指数（含拇指）
    const extended = this._countExtended(landmarks, handScale);

    // 初步判定姿态
    let rawPosture = 'other';
    // 张开手掌：伸直指数达到阈值
    if (extended >= OPEN_MIN_FINGERS) rawPosture = 'open';
    // 握拳：伸直指数极少
    else if (extended <= FIST_MAX_FINGERS) rawPosture = 'fist';

    // ------------------------------------------------------------------
    // 5. 姿态去抖：需要连续保持一小段时间才生效
    // ------------------------------------------------------------------
    if (rawPosture === this._pendingPosture) {
      // 继续累加保持时长
      this._pendingDuration += dt;
    } else {
      // 切换到新的候选姿态
      this._pendingPosture = rawPosture;
      // 计时清零
      this._pendingDuration = 0;
    }
    // 达到保持时长且与当前姿态不同时才真正切换
    if (this._pendingDuration >= POSTURE_HOLD && this._posture !== this._pendingPosture) {
      // 更新姿态
      this._posture = this._pendingPosture;
      // 广播姿态变化
      this.emit('posture', { posture: this._posture });
    }

    // ------------------------------------------------------------------
    // 6. 速度采样：只记录最近窗口内的样本
    // ------------------------------------------------------------------
    this._samples.push({ t: now, x: mx, y: my });
    // 丢弃过期样本
    while (this._samples.length > 2 && now - this._samples[0].t > VELOCITY_WINDOW) {
      // 移除最旧的样本
      this._samples.shift();
    }
    // 样本不足则无法计算速度
    if (this._samples.length < 2) return;

    // 取窗口内最早与最新的样本
    const oldest = this._samples[0];
    // 最新样本
    const newest = this._samples[this._samples.length - 1];
    // 时间跨度（避免除零）
    const span = Math.max(newest.t - oldest.t, 1e-3);
    // 横向速度（归一化坐标 / 秒）
    const vx = (newest.x - oldest.x) / span;
    // 纵向速度
    const vy = (newest.y - oldest.y) / span;
    // 速度模长
    const speed = Math.hypot(vx, vy);
    // 记录横滑速度
    this._lastSwipeSpeed = Math.abs(vx);

    // ------------------------------------------------------------------
    // 7. 滑动识别
    // ------------------------------------------------------------------
    // 释放判定：速度降下来后重新允许触发
    if (this._swipeArmed && speed < SWIPE_RELEASE_SPEED) {
      // 解除锁定
      this._swipeArmed = false;
    }
    // 判定本次位移是否够大
    const displacement = Math.abs(newest.x - oldest.x);
    // 满足全部条件才触发滑动
    const canSwipe =
      this._posture === 'open' && // 必须是张开手掌
      !this._swipeArmed && // 上一次滑动已释放
      now - this._lastSwipeAt > SWIPE_COOLDOWN && // 冷却结束
      Math.abs(vx) > SWIPE_SPEED && // 横向速度足够快
      displacement > SWIPE_MIN_DISTANCE && // 位移足够大
      Math.abs(vx) > Math.abs(vy) * 1.25; // 以横向为主，避免上下挥手误触

    // 触发滑动
    if (canSwipe) {
      // 记录触发时间
      this._lastSwipeAt = now;
      // 锁定，等待速度回落
      this._swipeArmed = true;
      // 方向：向右滑为 +1
      const direction = vx > 0 ? 1 : -1;
      // 根据速度换算跨越的牌数（1~4 步），滑得越快翻得越多
      const steps = clamp(Math.round(Math.abs(vx) / 0.75), 1, 4);
      // 广播滑动事件
      this.emit('swipe', { direction, steps, speed: Math.abs(vx) });
      // 清空采样，避免余速再次触发
      this._samples.length = 0;
      // 本次处理结束
      return;
    }

    // ------------------------------------------------------------------
    // 8. 确认手势识别：握拳并保持
    // ------------------------------------------------------------------
    // 握拳状态下累加持续时间（此处复用 pendingDuration：姿态已是 fist 时它就在累积）
    if (
      this._posture === 'fist' &&
      this._pendingDuration >= CONFIRM_HOLD &&
      now - this._lastConfirmAt > CONFIRM_COOLDOWN
    ) {
      // 记录触发时间
      this._lastConfirmAt = now;
      // 广播确认事件
      this.emit('confirm', {});
    }
  }

  /**
   * 计算手掌中心的归一化坐标。
   * @param {Array} lm 21 个关键点
   * @returns {{x:number,y:number}} 中心坐标
   */
  _palmCenter(lm) {
    // 取手腕与四个掌指根作为参考点
    const ids = [0, 5, 9, 13, 17];
    // 累加 x
    let sx = 0;
    // 累加 y
    let sy = 0;
    // 逐个累加
    for (const i of ids) {
      // 累加 x
      sx += lm[i].x;
      // 累加 y
      sy += lm[i].y;
    }
    // 返回平均值
    return { x: sx / ids.length, y: sy / ids.length };
  }

  /**
   * 两点欧氏距离。
   * @param {{x:number,y:number}} a 点 A
   * @param {{x:number,y:number}} b 点 B
   * @returns {number} 距离
   */
  _dist(a, b) {
    // 标准距离公式
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /**
   * 统计伸直的手指数。
   * 判定思路：手指伸直时，指尖离手腕的距离会明显大于近端指节离手腕的距离；
   * 这个方法对整只手的旋转不敏感，因此比「比较 y 坐标」稳健得多。
   * @param {Array} lm 关键点
   * @param {number} handScale 手部尺度（用于归一化）
   * @returns {number} 伸直的指数（0~5）
   */
  _countExtended(lm, handScale) {
    // 定义四指的 [近端指节, 指尖] 索引对
    const fingers = [
      [6, 8], // 食指
      [10, 12], // 中指
      [14, 16], // 无名指
      [18, 20], // 小指
    ];
    // 伸直计数
    let count = 0;
    // 逐个判定
    for (const [pip, tip] of fingers) {
      // 指尖到手腕的距离
      const dTip = this._dist(lm[0], lm[tip]);
      // 指节到手腕的距离
      const dPip = this._dist(lm[0], lm[pip]);
      // 超过阈值即认为伸直
      if (dTip > dPip * EXTEND_RATIO) count++;
    }
    // 拇指单独判定：拇指尖离小指根足够远即为张开
    const thumbSpread = this._dist(lm[4], lm[17]) / handScale;
    // 满足阈值则计入
    if (thumbSpread > THUMB_OPEN_RATIO) count++;
    // 返回总数
    return count;
  }

  /**
   * 读取当前姿态（供 UI 展示）。
   * @returns {'none'|'open'|'fist'|'other'} 姿态标识
   */
  getPosture() {
    // 直接返回内部状态
    return this._posture;
  }
}
