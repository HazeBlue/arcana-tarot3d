// ============================================================================
// core/Stage.js —— 三维舞台
// ----------------------------------------------------------------------------
// 职责：管理渲染器、场景、相机、后期合成器、尺寸自适应与主渲染循环。
// 设计：Stage 本身不包含任何业务逻辑，只对外暴露 scene / camera / renderer
//       以及一个 updater 注册机制，让各子系统自行挂载更新回调。
// ============================================================================

// 引入 three.js 核心命名空间
import * as THREE from 'three';
// 引入后期处理合成器：把多个 Pass 串联成一条渲染管线
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
// 引入基础渲染通道：把场景渲染到离屏纹理
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
// 引入泛光通道：让金色高光溢出形成光晕，是“炫酷”观感的关键
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
// 引入输出通道：统一处理色调映射与色彩空间转换
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
// 引入自研的暗色影棚环境贴图生成器（替代 three 自带的明亮 RoomEnvironment）
import { createStudioEnvTexture } from './studioEnvTexture.js';
// 引入数学工具中的阻尼函数，用于相机平滑
import { damp, clamp } from './mathUtils.js';

/**
 * Stage —— 三维舞台管理器
 */
export class Stage {
  /**
   * 构造函数：只记录画布，真正的初始化延迟到 init() 中执行，
   * 这样调用方可以自行决定初始化时机并显示加载进度。
   * @param {HTMLCanvasElement} canvas 页面上的画布元素
   */
  constructor(canvas) {
    // 保存画布引用
    this.canvas = canvas;

    // 场景实例（在 init 中创建）
    this.scene = null;
    // 透视相机实例
    this.camera = null;
    // WebGL 渲染器实例
    this.renderer = null;
    // 后期合成器实例
    this.composer = null;
    // 泛光通道引用，便于运行时调节强度
    this.bloomPass = null;

    // 主循环是否正在运行
    this._running = false;
    // 上一帧的时间戳（毫秒），用于计算帧间隔
    this._lastTime = 0;
    // 累计运行时间（秒），供需要周期性变化的动画使用
    this.elapsed = 0;
    // requestAnimationFrame 返回的句柄，用于取消
    this._rafId = 0;
    // 每帧需要执行的更新回调列表：每项为 (dt, elapsed) => void
    this._updaters = [];

    // 相机基础位置（不含视差偏移），供视差逻辑作为基准
    this.cameraHome = new THREE.Vector3(0, 2.5, 8.4);
    // 相机注视点（略微高于桌面，让构图更像“俯视牌桌”）
    this.cameraTarget = new THREE.Vector3(0, 1.35, -0.6);
    // 相机当前注视点（用于平滑跟随）
    this._lookAt = this.cameraTarget.clone();
    // 外部注入的视差偏移（由鼠标位置控制）
    this.parallax = new THREE.Vector2(0, 0);
    // 外部注入的缩放倍率（由滚轮控制）
    this.zoom = 1;
    // 当前平滑后的缩放值
    this._zoomSmooth = 1;

    // 缓存鼠标拖拽产生的额外视角偏移
    this.orbit = { yaw: 0, pitch: 0 };
    // 平滑后的视角偏移
    this._orbitSmooth = { yaw: 0, pitch: 0 };

    // 绑定 resize 与渲染方法，确保作为回调传递时 this 指向正确
    this._onResize = this._onResize.bind(this);
    this._render = this._render.bind(this);
  }

  /**
   * 初始化渲染器、场景、相机与后期管线。
   */
  init() {
    // ------------------------------------------------------------------
    // 1. 渲染器
    // ------------------------------------------------------------------
    // 创建 WebGL 渲染器：开启抗锯齿以获得干净的卡牌边缘
    this.renderer = new THREE.WebGLRenderer({
      // 复用页面上的画布
      canvas: this.canvas,
      // 开启 MSAA 抗锯齿
      antialias: true,
      // 关闭透明通道，让画布自带深色背景（后期处理也更省事）
      alpha: false,
      // 提升在高分屏上的精度表现
      powerPreference: 'high-performance',
      // 关闭 stencil，减少显存占用
      stencil: false,
    });
    // 设置设备像素比上限：既要清晰，又不能在高分屏上拖垮性能
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.85));
    // 设置初始尺寸
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    // 开启阴影贴图
    this.renderer.shadowMap.enabled = true;
    // 使用软阴影，让卡牌落在桌面上的投影更自然
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // 采用 ACES 电影级色调映射，让高光过渡更柔和、更有质感
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    // 色调映射曝光度，配合泛光通道联合调校
    this.renderer.toneMappingExposure = 0.8;

    // ------------------------------------------------------------------
    // 2. 场景
    // ------------------------------------------------------------------
    // 创建场景
    this.scene = new THREE.Scene();
    // 深空底色，与 CSS 背景保持一致，避免加载瞬间出现色差
    this.scene.background = new THREE.Color(0x07060b);
    // 加一层指数雾：让远处的星点自然消隐，同时增强纵深感
    this.scene.fog = new THREE.FogExp2(0x07060b, 0.045);

    // ------------------------------------------------------------------
    // 3. 环境贴图：给金属（金箔描边）提供可信的反射
    // ------------------------------------------------------------------
    // 使用自研的「暗色影棚」环境贴图：
    // 黑色房间 + 暖金/幽紫/暖橙三块发光板。相比 three 自带的白色摄影棚，
    // 它能让金属只反射出金色与紫色的光斑，画面保持深色而不被泛白冲淡。
    this.scene.environment = createStudioEnvTexture(this.renderer);
    // 环境强度可以放心取到接近 1：因为环境本身是暗的，不会再洗白画面
    this.scene.environmentIntensity = 0.95;

    // ------------------------------------------------------------------
    // 4. 相机
    // ------------------------------------------------------------------
    // 透视相机：默认视野 42 度（略窄，减少边缘畸变）、近裁剪 0.1、远裁剪 120
    this.camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 120);
    // 依据当前视口比例调整相机参数（竖屏需要退后并抬高）
    this._applyViewport(this.camera.aspect);
    // 设置初始位置
    this.camera.position.copy(this.cameraHome);
    // 看向构图中心
    this.camera.lookAt(this.cameraTarget);

    // ------------------------------------------------------------------
    // 5. 后期处理管线
    // ------------------------------------------------------------------
    // 创建合成器
    this.composer = new EffectComposer(this.renderer);
    // 设置合成器的工作分辨率与渲染器保持一致
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.85));
    // 设置合成器尺寸
    this.composer.setSize(window.innerWidth, window.innerHeight);
    // 添加基础渲染通道
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // 创建泛光通道：强度 0.45、半径 0.5、阈值 0.9
    // 阈值偏高意味着只有真正亮的部分（金色描边、光晕）才会溢出，画面不会糊
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.45,
      0.5,
      0.9
    );
    // 把泛光通道加入管线
    this.composer.addPass(this.bloomPass);
    // 最后加入输出通道，负责色调映射与 sRGB 转换
    this.composer.addPass(new OutputPass());

    // ------------------------------------------------------------------
    // 6. 事件绑定
    // ------------------------------------------------------------------
    // 监听窗口尺寸变化
    window.addEventListener('resize', this._onResize);
    // 监听屏幕旋转（移动端）
    window.addEventListener('orientationchange', this._onResize);

    // 返回自身便于链式调用
    return this;
  }

  /**
   * 注册每帧更新回调。
   * @param {Function} fn 形如 (dt, elapsed) => void 的函数
   * @returns {Function} 取消注册的函数
   */
  onUpdate(fn) {
    // 加入更新列表
    this._updaters.push(fn);
    // 返回移除函数
    return () => {
      // 找到下标
      const i = this._updaters.indexOf(fn);
      // 存在则移除
      if (i >= 0) this._updaters.splice(i, 1);
    };
  }

  /**
   * 启动渲染循环。
   */
  start() {
    // 已经在跑就不重复启动
    if (this._running) return;
    // 置为运行中
    this._running = true;
    // 记录起始时间，避免第一帧 dt 异常
    this._lastTime = performance.now();
    // 启动主循环
    this._render();
  }

  /**
   * 停止渲染循环。
   */
  stop() {
    // 置为停止
    this._running = false;
    // 取消待执行的帧
    if (this._rafId) cancelAnimationFrame(this._rafId);
    // 清空句柄
    this._rafId = 0;
  }

  /**
   * 主渲染循环（内部方法）。
   * @param {number} now requestAnimationFrame 传入的高精度时间戳
   */
  _render(now = performance.now()) {
    // 若已停止则不再递归
    if (!this._running) return;

    // 计算帧间隔（秒），并裁剪上限避免切换标签页回来后出现巨大跳变
    const dt = Math.min((now - this._lastTime) / 1000, 0.05);
    // 更新上一帧时间
    this._lastTime = now;
    // 累加运行时间
    this.elapsed += dt;

    // 先更新相机（视差、缩放、阻尼）
    this._updateCamera(dt);

    // 依次执行所有业务更新回调
    for (let i = 0; i < this._updaters.length; i++) {
      // 单个回调异常不应中断整个循环
      try {
        // 传入帧间隔与累计时间
        this._updaters[i](dt, this.elapsed);
      } catch (err) {
        // 打印错误便于排查
        console.error('[Stage] 更新回调异常：', err);
      }
    }

    // 通过后期合成器渲染一帧
    this.composer.render(dt);

    // 请求下一帧
    this._rafId = requestAnimationFrame(this._render);
  }

  /**
   * 每帧更新相机：叠加视差偏移、鼠标轨道偏移与平滑缩放。
   * @param {number} dt 帧间隔（秒）
   */
  _updateCamera(dt) {
    // 平滑缩放值：向目标缩放靠拢
    this._zoomSmooth = damp(this._zoomSmooth, this.zoom, 0.001, dt);
    // 平滑轨道的水平偏移
    this._orbitSmooth.yaw = damp(this._orbitSmooth.yaw, this.orbit.yaw, 0.0008, dt);
    // 平滑轨道的垂直偏移
    this._orbitSmooth.pitch = damp(this._orbitSmooth.pitch, this.orbit.pitch, 0.0008, dt);

    // 计算水平视差：鼠标的 x 位移映射到相机横向移动
    const px = this.parallax.x * 0.85;
    // 计算垂直视差：方向取反，让“手往上抬镜头往下压”的直觉更自然
    const py = -this.parallax.y * 0.42;
    // 计算最终相机 x 坐标（基础位置 + 视差）
    const targetX = this.cameraHome.x + px;
    // 计算最终相机 y 坐标（基础位置 + 视差，并限制下限避免穿到桌面下方）
    const targetY = Math.max(0.9, this.cameraHome.y + py);
    // 计算最终相机 z 坐标（基础位置乘上缩放倍率）
    const targetZ = this.cameraHome.z * this._zoomSmooth;

    // 用指数阻尼让相机追随目标位置，形成“惯性跟手”的手感
    this.camera.position.x = damp(this.camera.position.x, targetX, 0.0009, dt);
    // y 轴同样阻尼
    this.camera.position.y = damp(this.camera.position.y, targetY, 0.0009, dt);
    // z 轴同样阻尼
    this.camera.position.z = damp(this.camera.position.z, targetZ, 0.0009, dt);

    // 计算注视点：在基础注视点上叠加鼠标轨道偏移
    const lookX = this.cameraTarget.x + this._orbitSmooth.yaw;
    // y 方向偏移量
    const lookY = this.cameraTarget.y + this._orbitSmooth.pitch;
    // 用阻尼平滑注视点，避免拖拽时画面抖动
    this._lookAt.x = damp(this._lookAt.x, lookX, 0.0015, dt);
    // y 方向阻尼
    this._lookAt.y = damp(this._lookAt.y, lookY, 0.0015, dt);
    // z 方向直接跟随目标，保持稳定
    this._lookAt.z = this.cameraTarget.z;
    // 应用注视
    this.camera.lookAt(this._lookAt);
  }

  /**
   * 依据视口宽高比调整取景参数。
   * 竖屏时水平视野非常窄，若不退后并抬高相机，扇形牌阵会被两侧裁掉一大半；
   * 因此这里做一次整体的「拉远 + 抬高 + 放宽纵向视野」。
   * @param {number} aspect 宽高比
   */
  _applyViewport(aspect) {
    // 宽高比小于 0.95 视为竖屏（手机）
    const portrait = aspect < 0.95;
    // 纵向视野：竖屏放宽到 46 度，横屏保持 42 度
    this.camera.fov = portrait ? 46 : 42;
    // 相机基准位置：竖屏退后并抬高，保证整个扇形在画面内
    this.cameraHome.set(0, portrait ? 2.9 : 2.5, portrait ? 10 : 8.4);
    // 注视点：竖屏要明显下移，这样整个三维内容在画面里会整体上移，
    // 正好给底部的提问面板留出约 190px 的空间，避免牌面被面板压住。
    this.cameraTarget.set(0, portrait ? 0.95 : 1.35, -0.6);
    // 平滑注视点也同步重置，避免切换方向时相机先飘一下
    this._lookAt.copy(this.cameraTarget);
  }

  /**
   * 视口尺寸变化处理。
   */
  _onResize() {
    // 取得新的视口尺寸
    const w = window.innerWidth;
    // 高度
    const h = window.innerHeight;
    // 更新相机宽高比
    this.camera.aspect = w / h;
    // 依据新的比例重新调整相机取景（竖屏需要退后、抬高、放宽视野）
    this._applyViewport(this.camera.aspect);
    // 重新计算投影矩阵
    this.camera.updateProjectionMatrix();
    // 通知外部视口比例发生变化（牌阵需要据此收窄牌位间距）
    if (this.onViewportChange) this.onViewportChange(this.camera.aspect);
    // 更新渲染器尺寸（第三个参数 false 表示不改写画布 CSS 尺寸）
    this.renderer.setSize(w, h, false);
    // 更新像素比（窗口在不同显示器间移动时可能变化）
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.85));
    // 同步合成器尺寸
    this.composer.setSize(w, h);
    // 同步合成器像素比
    this.composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.85));
    // 同步泛光通道分辨率
    this.bloomPass.setSize(w, h);
  }

  /**
   * 设置鼠标轨道偏移（供 PointerControls 调用）。
   * @param {number} yaw 水平偏移量
   * @param {number} pitch 垂直偏移量
   */
  setOrbit(yaw, pitch) {
    // 水平偏移限制在正负 0.9 以内，避免转过头看到空荡的侧面
    this.orbit.yaw = clamp(yaw, -0.9, 0.9);
    // 垂直偏移限制在正负 0.5 以内
    this.orbit.pitch = clamp(pitch, -0.5, 0.5);
  }

  /**
   * 设置视差。
   * @param {number} x 归一化横向位移，范围约 [-1, 1]
   * @param {number} y 归一化纵向位移，范围约 [-1, 1]
   */
  setParallax(x, y) {
    // 写入横向视差
    this.parallax.x = clamp(x, -1.2, 1.2);
    // 写入纵向视差
    this.parallax.y = clamp(y, -1.2, 1.2);
  }

  /**
   * 释放资源（页面卸载或应用重置时调用）。
   */
  dispose() {
    // 停止渲染循环
    this.stop();
    // 移除事件监听
    window.removeEventListener('resize', this._onResize);
    // 移除旋转事件监听
    window.removeEventListener('orientationchange', this._onResize);
    // 释放渲染器占用的 GPU 资源
    this.renderer.dispose();
  }
}
