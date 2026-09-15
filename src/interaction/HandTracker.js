// ============================================================================
// interaction/HandTracker.js —— 摄像头手部追踪
// ----------------------------------------------------------------------------
// 职责：申请摄像头权限 → 从 CDN 加载 MediaPipe Tasks Vision 与手部关键点模型 →
//       在渲染循环中逐帧推理 → 把 21 个关键点交给手势识别器。
// 设计取舍：
//   * MediaPipe 走动态 import 从 CDN 加载，不进入 npm 依赖树，
//     这样 npm install 只需要装 three.js，仓库更轻；
//   * 加载失败、权限被拒、环境不支持时统统走「降级」而不是抛错，
//     因为键鼠操作始终是可用的备选方案。
// ============================================================================

// 引入事件总线
import { Emitter } from '../core/Emitter.js';

// ---------------------------------------------------------------------------
// MediaPipe 资源地址：版本号集中在这里，升级时只需改一处
// ---------------------------------------------------------------------------

// MediaPipe Tasks Vision 的 ESM 打包文件
const VISION_BUNDLE_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
// WASM 运行时目录（必须与上面的版本严格一致）
const VISION_WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
// 手部关键点模型文件（float16 量化版，约 7MB，精度与体积平衡得最好）
const HAND_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

// 推理帧率上限：30fps 对交互来说完全够用，同时给 GPU 留出余量
const MAX_INFERENCE_FPS = 30;
// 两次推理之间的最小间隔（秒）
const MIN_INFERENCE_INTERVAL = 1 / MAX_INFERENCE_FPS;

/**
 * HandTracker —— 手部追踪器
 * @extends Emitter
 * 事件：
 *   'status'  { state: 'idle'|'loading'|'ready'|'error'|'denied', message }
 *   'frame'   { landmarks, videoWidth, videoHeight } 一帧推理结果
 */
export class HandTracker extends Emitter {
  /**
   * 构造函数。
   * @param {object} deps 依赖注入
   * @param {HTMLVideoElement} deps.video 用于播放摄像头画面的 video 元素
   */
  constructor({ video }) {
    // 调用父类构造函数
    super();
    // 保存 video 元素引用
    this.video = video;

    // MediaPipe HandLandmarker 实例
    this.landmarker = null;
    // 摄像头媒体流
    this.stream = null;
    // 是否已经启动
    this.started = false;
    // 上一次推理的时间（秒）
    this._lastInference = 0;
    // 上一次交给 MediaPipe 的时间戳（毫秒），必须严格递增
    this._lastTimestamp = -1;
    // 最近一帧的关键点（供叠加层绘制）
    this.landmarks = null;
    // 视频就绪标记
    this._videoReady = false;
  }

  /**
   * 启动摄像头与模型。
   * @returns {Promise<boolean>} 是否成功启动
   */
  async start() {
    // 已启动则直接返回
    if (this.started) return true;
    // 广播加载状态
    this.emit('status', { state: 'loading', message: '正在加载手势模型…' });

    try {
      // ------------------------------------------------------------------
      // 1. 申请摄像头权限
      // ------------------------------------------------------------------
      // 只要视频轨，分辨率控制在 640×480，够用且省流量
      this.stream = await navigator.mediaDevices.getUserMedia({
        // 视频约束
        video: {
          // 期望宽度
          width: { ideal: 640 },
          // 期望高度
          height: { ideal: 480 },
          // 优先前置摄像头
          facingMode: 'user',
        },
        // 不需要音频
        audio: false,
      });

      // 把媒体流接到 video 元素
      this.video.srcObject = this.stream;
      // 等待视频元数据就绪
      await new Promise((resolve, reject) => {
        // 元数据就绪回调
        const onLoaded = () => {
          // 清理监听
          this.video.removeEventListener('loadedmetadata', onLoaded);
          // 解析
          resolve();
        };
        // 绑定监听
        this.video.addEventListener('loadedmetadata', onLoaded, { once: true });
        // 超时兜底：3 秒内没有元数据视为失败
        setTimeout(() => reject(new Error('摄像头元数据超时')), 3000);
      });
      // 播放视频
      await this.video.play();
      // 标记就绪
      this._videoReady = true;

      // ------------------------------------------------------------------
      // 2. 动态加载 MediaPipe（不进入 npm 依赖）
      // ------------------------------------------------------------------
      // 广播状态
      this.emit('status', { state: 'loading', message: '正在下载手势识别库…' });
      // 动态导入 ESM 打包文件；@vite-ignore 让打包器保持原样的外部 URL
      const vision = await import(/* @vite-ignore */ VISION_BUNDLE_URL);

      // ------------------------------------------------------------------
      // 3. 初始化 WASM 运行时并创建手部关键点检测器
      // ------------------------------------------------------------------
      // 广播状态
      this.emit('status', { state: 'loading', message: '正在初始化手势识别…' });
      // 解析 WASM 文件集
      const fileset = await vision.FilesetResolver.forVisionTasks(VISION_WASM_URL);
      // 创建检测器
      this.landmarker = await vision.HandLandmarker.createFromOptions(fileset, {
        // 基础配置
        baseOptions: {
          // 模型地址
          modelAssetPath: HAND_MODEL_URL,
          // 优先使用 GPU 推理，失败会自动回落到 CPU
          delegate: 'GPU',
        },
        // 视频模式：允许帧间追踪，比图片模式快得多
        runningMode: 'VIDEO',
        // 只追踪一只手，节省算力
        numHands: 1,
        // 手掌检测置信度阈值
        minHandDetectionConfidence: 0.5,
        // 手掌存在置信度阈值
        minHandPresenceConfidence: 0.5,
        // 关键点追踪置信度阈值
        minTrackingConfidence: 0.5,
      });

      // 标记为已启动
      this.started = true;
      // 广播就绪状态
      this.emit('status', { state: 'ready', message: '手势已就绪 · 张开手掌滑动浏览' });
      // 返回成功
      return true;
    } catch (err) {
      // 权限被拒时给出专门的提示
      const denied = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      // 广播错误状态
      this.emit('status', {
        // 状态枚举
        state: denied ? 'denied' : 'error',
        // 友好文案
        message: denied ? '摄像头权限被拒绝 · 已切换为键鼠操作' : '手势不可用 · 已切换为键鼠操作',
      });
      // 打印详细错误便于排查
      console.warn('[HandTracker] 启动失败：', err);
      // 清理已经申请到的资源
      this._releaseStream();
      // 返回失败
      return false;
    }
  }

  /**
   * 每帧调用：按帧率上限执行一次推理。
   * @param {number} dt 帧间隔（秒）
   */
  update(dt) {
    // 未就绪则跳过
    if (!this.started || !this.landmarker || !this._videoReady) return;
    // 页面不可见时跳过推理，省电
    if (document.hidden) return;
    // 视频尺寸为 0 说明还没真正出画
    if (!this.video.videoWidth) return;

    // 累加时间
    this._acc = (this._acc || 0) + dt;
    // 累计「距离上一次推理」的时间，它才是手势识别真正需要的时间步长
    this._sinceLastInference = (this._sinceLastInference || 0) + dt;
    // 未到下一次推理时间则跳过
    if (this._acc < MIN_INFERENCE_INTERVAL) return;
    // 重置计时（保留余数，避免累加漂移）
    this._acc = this._acc % MIN_INFERENCE_INTERVAL;
    // 取出本次推理对应的时间步长
    const inferenceDt = this._sinceLastInference;
    // 清零
    this._sinceLastInference = 0;

    // MediaPipe 要求时间戳单调递增，这里用 performance.now()
    let timestamp = performance.now();
    // 若与上一帧相同（同一毫秒内多次调用）则强行加 1
    if (timestamp <= this._lastTimestamp) timestamp = this._lastTimestamp + 1;
    // 记录时间戳
    this._lastTimestamp = timestamp;

    try {
      // 执行推理
      const result = this.landmarker.detectForVideo(this.video, timestamp);
      // 取出第一只手的关键点（未检测到时为 undefined）
      const landmarks = result && result.landmarks && result.landmarks.length ? result.landmarks[0] : null;
      // 记录最近一帧
      this.landmarks = landmarks;
      // 广播这一帧结果
      this.emit('frame', {
        // 关键点数组（可能为 null）
        landmarks,
        // 视频宽度，供叠加层换算
        videoWidth: this.video.videoWidth,
        // 视频高度
        videoHeight: this.video.videoHeight,
        // 本次推理实际经过的时间（秒）：手势识别器的所有计时都基于它，
        // 若误用渲染帧的 dt，握手保持时长会被放大一倍
        dt: inferenceDt,
      });
    } catch (err) {
      // 单帧推理出错不影响整体运行，只记录一次
      if (!this._warnedInference) {
        // 打印警告
        console.warn('[HandTracker] 推理异常：', err);
        // 只提示一次
        this._warnedInference = true;
      }
    }
  }

  /**
   * 停止追踪并释放摄像头。
   */
  stop() {
    // 释放媒体流
    this._releaseStream();
    // 关闭检测器
    if (this.landmarker) {
      // 调用 close 释放模型占用的资源
      try {
        this.landmarker.close();
      } catch {
        // 忽略关闭异常
      }
      // 清空引用
      this.landmarker = null;
    }
    // 重置标记
    this.started = false;
    // 清空关键点
    this.landmarks = null;
    // 清除就绪标记
    this._videoReady = false;
    // 广播空闲状态
    this.emit('status', { state: 'idle', message: '手势已关闭' });
  }

  /**
   * 释放摄像头的轨道（内部方法）。
   */
  _releaseStream() {
    // 存在媒体流才处理
    if (this.stream) {
      // 逐个停止轨道
      this.stream.getTracks().forEach((track) => track.stop());
      // 清空引用
      this.stream = null;
    }
    // 断开 video 的数据源
    if (this.video) {
      // 置空
      this.video.srcObject = null;
    }
  }
}
