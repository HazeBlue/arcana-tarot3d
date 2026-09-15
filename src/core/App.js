// ============================================================================
// core/App.js —— 应用主类（总装配与状态机）
// ----------------------------------------------------------------------------
// 这是整个项目的「大脑」，但它本身几乎不做具体的事：
//   它负责创建各个子系统、把它们接线在一起、驱动每帧更新、维护交互状态机。
// 状态机：
//   boot      启动中（加载贴图与牌阵）
//   asking    等待用户写下问题
//   browsing  正在浏览牌阵并挑选三张牌
//   reading   三张已选，解读面板已打开
// 无论操作来自摄像头手势、键鼠，还是 UI 按钮，最终都汇聚到同一组方法上，
// 因此三条输入路径的行为完全一致。
// ============================================================================

// 引入三维舞台
import { Stage } from './Stage.js';
// 引入环境构建器
import { Environment } from './Environment.js';
// 引入贴图工厂
import { TextureFactory } from '../tarot/CardTextures.js';
// 引入牌阵管理器
import { Deck } from '../tarot/Deck.js';
// 引入手势识别器
import { GestureRecognizer } from '../interaction/GestureRecognizer.js';
// 引入手部追踪器
import { HandTracker } from '../interaction/HandTracker.js';
// 引入手部叠加层
import { HandOverlay } from '../interaction/HandOverlay.js';
// 引入键鼠控制器
import { PointerControls } from '../interaction/PointerControls.js';
// 引入界面管理器
import { UIManager } from '../ui/UIManager.js';
// 引入解读引擎
import { generateReading } from '../reading/ReadingEngine.js';
// 引入数学工具
import { damp } from './mathUtils.js';

// 默认问题：用户没有写问题就直接抽牌时使用
const DEFAULT_QUESTION = '请为我揭示当下最需要看见的指引';

// 选满三张后延迟多久弹出解读面板（秒），留出看牌落位的时间
const READING_DELAY = 1.5;

// 视差保持多久没有输入就自动归零（秒）
const PARALLAX_TIMEOUT = 0.6;

/**
 * App —— 应用主类
 */
export class App {
  /**
   * 构造函数。
   * @param {HTMLCanvasElement} canvas 3D 画布
   */
  constructor(canvas) {
    // 保存画布引用
    this.canvas = canvas;

    // 当前状态
    this.state = 'boot';
    // 用户输入的问题
    this.question = '';
    // 解读结果缓存
    this.reading = null;

    // 各子系统实例（在 init 中创建）
    this.stage = null;
    // 贴图工厂
    this.textures = null;
    // 环境
    this.environment = null;
    // 牌阵
    this.deck = null;
    // 界面管理器
    this.ui = null;
    // 手势识别器
    this.recognizer = null;
    // 手部追踪器
    this.handTracker = null;
    // 手部叠加层
    this.overlay = null;
    // 键鼠控制器
    this.pointer = null;

    // 视差目标值与过期计时
    this._parallaxTarget = { x: 0, y: 0 };
    // 视差剩余有效时间
    this._parallaxTTL = 0;

    // 解读弹出用的定时器
    this._readingTimer = 0;
    // 正在生成解读的标记，避免重复触发
    this._generating = false;
  }

  /**
   * 异步初始化整个应用。
   */
  async init() {
    // ------------------------------------------------------------------
    // 1. 界面管理器（先建，方便后面实时汇报加载进度）
    // ------------------------------------------------------------------
    this.ui = new UIManager({
      // 手势开关
      onToggleGesture: () => this.toggleGesture(),
      // 提交问题
      onAsk: (q) => this.submitQuestion(q),
      // 重置牌局
      onReset: () => this.reset(),
      // 关闭解读面板
      onReadingClose: () => this.ui.setReadingMode(false),
    });
    // 绑定界面事件
    this.ui.bindEvents();
    // 汇报进度
    this.ui.setLoadingProgress(0.04, '正在初始化渲染器…');
    // 初始化牌位指示点
    this.ui.renderSlotDots(0, 0);

    // ------------------------------------------------------------------
    // 2. 三维舞台
    // ------------------------------------------------------------------
    this.stage = new Stage(this.canvas);
    // 初始化渲染器、场景、相机与后期管线
    this.stage.init();
    // 汇报进度
    this.ui.setLoadingProgress(0.12, '正在烘焙环境光照…');
    // 让浏览器有机会把这一帧画出来，避免进度条卡住
    await this._nextFrame();

    // ------------------------------------------------------------------
    // 3. 贴图工厂：把渲染器的各向异性能力注入，让斜视卡牌更清晰
    // ------------------------------------------------------------------
    this.textures = new TextureFactory();
    // 读取渲染器支持的最大各向异性值
    this.textures.setAnisotropy(this.stage.renderer.capabilities.getMaxAnisotropy());

    // ------------------------------------------------------------------
    // 4. 环境：星空、星云、桌面与灯光
    // ------------------------------------------------------------------
    this.environment = new Environment({ scene: this.stage.scene, textures: this.textures });
    // 构建环境内容
    this.environment.build();
    // 汇报进度
    this.ui.setLoadingProgress(0.2, '正在描摹牌面纹样…');
    // 让出主线程
    await this._nextFrame();

    // ------------------------------------------------------------------
    // 5. 牌阵：构建 32 张牌的弧形牌阵
    // ------------------------------------------------------------------
    this.deck = new Deck({
      // 场景
      scene: this.stage.scene,
      // 相机
      camera: this.stage.camera,
      // 贴图工厂
      textures: this.textures,
    });
    // 构建牌阵，并实时汇报进度（映射到 0.2 ~ 0.92 区间）
    await this.deck.build((p) => {
      // 根据牌阵构建进度更新加载条
      this.ui.setLoadingProgress(0.2 + p * 0.72, '正在描摹牌面纹样…');
    });

    // ------------------------------------------------------------------
    // 6. 交互层：手势 + 键鼠
    // ------------------------------------------------------------------
    this.recognizer = new GestureRecognizer();
    // 绑定手势事件
    this._bindGestureEvents();
    // 创建手部追踪器
    this.handTracker = new HandTracker({
      // 摄像头预览元素
      video: document.getElementById('hand-video'),
    });
    // 创建手部叠加层
    this.overlay = new HandOverlay({
      // 叠加画布
      canvas: document.getElementById('hand-overlay'),
      // 手势光标元素
      cursor: this.ui.gestureCursor,
      // 手势识别器
      recognizer: this.recognizer,
    });
    // 监听追踪状态变化
    this._bindTrackerEvents();

    // 键鼠控制器始终启用，作为手势的完整替代路径
    this.pointer = new PointerControls({ canvas: this.canvas, stage: this.stage });
    // 绑定键鼠事件
    this._bindPointerEvents();
    // 启用键鼠
    this.pointer.enable();

    // 监听视口宽高比变化：竖屏切换时同步收窄三个牌位
    this.stage.onViewportChange = (aspect) => this.deck.setViewportAspect(aspect);
    // 首次按当前视口同步一次
    this.deck.setViewportAspect(window.innerWidth / window.innerHeight);

    // ------------------------------------------------------------------
    // 7. 注册每帧更新
    // ------------------------------------------------------------------
    this.stage.onUpdate((dt, elapsed) => this._update(dt, elapsed));

    // ------------------------------------------------------------------
    // 8. 收尾：隐藏加载遮罩，进入等待提问状态
    // ------------------------------------------------------------------
    this.ui.setLoadingProgress(1, '牌阵已就绪');
    // 稍等一下让进度条跑满，再淡出遮罩
    await this._delay(420);
    // 隐藏遮罩
    this.ui.hideLoading();
    // 切换到等待提问状态
    this._enterAsking();

    // 首次进入时自动展示一次操作说明，降低上手成本
    setTimeout(() => {
      // 读取弹层元素
      const modal = document.getElementById('help-modal');
      // 存在才显示
      if (modal) modal.hidden = false;
    }, 900);
  }

  /**
   * 启动渲染循环。
   */
  start() {
    // 交给舞台启动
    this.stage.start();
  }

  // ==========================================================================
  // 状态机
  // ==========================================================================

  /**
   * 进入「等待提问」状态。
   */
  _enterAsking() {
    // 更新状态
    this.state = 'asking';
    // 顶部状态胶囊
    this.ui.setStatus('写下你的问题，开始占卜', 'idle');
    // 底部提示
    this.ui.setHint('先写下问题，再点击「开始抽牌」');
    // 主按钮文案
    this.ui.setDrawButton(true, '开始抽牌');
  }

  /**
   * 进入「浏览牌阵」状态。
   */
  _enterBrowsing() {
    // 更新状态
    this.state = 'browsing';
    // 顶部状态
    this.ui.setStatus('牌阵已展开 · 请挑选三张牌', 'ok');
    // 底部提示
    this._refreshHint();
    // 主按钮文案
    this.ui.setDrawButton(false, '牌阵已展开');
  }

  /**
   * 进入「解读」状态。
   */
  _enterReading() {
    // 更新状态
    this.state = 'reading';
    // 顶部状态
    this.ui.setStatus('解读已生成', 'ok');
    // 底部提示
    this.ui.setHint('解读已生成 · 可点击「重新开始」再来一次');
    // 切换到阅读模式
    this.ui.setReadingMode(true);
  }

  /**
   * 依据当前进度刷新底部提示文案。
   */
  _refreshHint() {
    // 已选数量
    const n = this.deck.selected.length;
    // 手势是否开启
    const gestureOn = this.handTracker && this.handTracker.started;
    // 依据输入方式给出不同的提示
    if (gestureOn) {
      // 手势模式提示
      this.ui.setHint(
        n === 0
          ? '✋ 张开手掌左右滑动浏览 · ✊ 握拳确认第一张牌'
          : `✋ 滑动继续浏览 · ✊ 握拳确认第 ${n + 1} 张牌`
      );
      // 结束
      return;
    }
    // 键鼠模式提示
    this.ui.setHint(
      n === 0
        ? '← / → 浏览牌阵 · 空格确认第一张牌'
        : `← / → 继续浏览 · 空格确认第 ${n + 1} 张牌`
    );
  }

  // ==========================================================================
  // 事件绑定
  // ==========================================================================

  /**
   * 绑定手势识别器事件。
   */
  _bindGestureEvents() {
    // 滑动：浏览牌阵
    this.recognizer.on('swipe', ({ direction, steps }) => {
      // 阅读状态下不再响应浏览
      this.deck.browse(direction * steps);
      // 给出轻微提示
      this.ui.setHandBadge(direction > 0 ? '→ 向右滑动' : '← 向左滑动');
      // 刷新底部提示
      this._refreshHint();
    });

    // 握拳保持：确认当前聚焦的牌
    this.recognizer.on('confirm', () => {
      // 转交统一处理
      this.handleConfirm('gesture');
    });

    // 手掌移动：驱动镜头视差
    this.recognizer.on('move', ({ x, y }) => {
      // 把 0~1 的归一化坐标映射到 -1~1
      const nx = (x - 0.5) * 2;
      // y 方向同样映射
      const ny = (y - 0.5) * 2;
      // 写入视差目标
      this._parallaxTarget.x = nx;
      // 写入视差目标
      this._parallaxTarget.y = ny;
      // 刷新视差有效期
      this._parallaxTTL = PARALLAX_TIMEOUT;
    });

    // 姿态变化：更新角标
    this.recognizer.on('posture', ({ posture }) => {
      // 依姿态切换角标文案
      if (posture === 'open') this.ui.setHandBadge('✋ 张开 · 滑动浏览');
      // 握拳
      else if (posture === 'fist') this.ui.setHandBadge('✊ 握拳 · 保持以确认');
      // 其它
      else this.ui.setHandBadge('手势未识别');
    });

    // 手部出现 / 消失
    this.recognizer.on('hand', ({ present }) => {
      // 更新角标
      this.ui.setHandBadge(present ? '已检测到手' : '等待手势');
      // 手离开时把视差归零
      if (!present) this._parallaxTTL = 0;
    });
  }

  /**
   * 绑定手部追踪器的状态事件。
   */
  _bindTrackerEvents() {
    // 状态变化
    this.handTracker.on('status', ({ state, message }) => {
      // 切换按钮状态
      this.ui.setGestureButton(state === 'ready', state === 'loading');
      // 顶部状态提示
      if (state === 'loading') this.ui.setStatus(message, 'warn');
      // 就绪
      else if (state === 'ready') this.ui.setStatus('手势已开启', 'ok');
      // 失败或拒绝
      else if (state === 'error' || state === 'denied') this.ui.setStatus(message, 'warn');
      // 关闭
      else this.ui.setStatus('手势已关闭', 'idle');
      // 弹出提示条
      this.ui.toast(message);
      // 刷新底部提示
      this._refreshHint();
    });

    // 每一帧的推理结果：交给手势识别器与叠加层
    this.handTracker.on('frame', ({ landmarks, videoWidth, videoHeight, dt: inferenceDt }) => {
      // 把关键点交给识别器，并传入这一帧真实经过的时间
      // （不能固定传 1/60：推理上限是 30fps，那样会让所有手势判定时长翻倍）
      this.recognizer.feed(landmarks, inferenceDt || 1 / 30);
      // 把关键点交给叠加层绘制
      this.overlay.setFrame(landmarks, videoWidth, videoHeight);
    });
  }

  /**
   * 绑定键鼠事件。
   */
  _bindPointerEvents() {
    // 浏览
    this.pointer.on('browse', ({ direction, steps }) => {
      // 转交牌阵
      this.deck.browse(direction * steps);
      // 刷新提示
      this._refreshHint();
    });
    // 确认
    this.pointer.on('confirm', () => {
      // 转交统一处理
      this.handleConfirm('pointer');
    });
    // 视差
    this.pointer.on('parallax', ({ x, y }) => {
      // 写入视差目标
      this._parallaxTarget.x = x;
      // 写入视差目标
      this._parallaxTarget.y = y;
      // 刷新有效期
      this._parallaxTTL = PARALLAX_TIMEOUT;
    });
  }

  // ==========================================================================
  // 核心业务动作
  // ==========================================================================

  /**
   * 提交问题，进入浏览阶段。
   * @param {string} question 用户输入的问题
   */
  submitQuestion(question) {
    // 若已经在解读状态，先重置牌局
    if (this.state === 'reading') {
      // 重置（不等待）
      this.reset();
    }
    // 记录问题，空输入使用默认问题
    this.question = question || '';
    // 若已有选牌则先清空重来
    if (this.deck.selected.length > 0) {
      // 重新发牌
      this.deck.reset((p) => this.ui.setLoadingProgress(p, '正在重新洗牌…'));
    }
    // 提示用户
    this.ui.toast(question ? '问题已记下 · 开始浏览牌阵' : '未填写问题 · 将使用默认指引');
    // 进入浏览状态
    this._enterBrowsing();
    // 若手势已开启，提示手势用法
    if (this.handTracker.started) {
      // 提示
      this.ui.toast('✋ 张开手掌滑动浏览 · ✊ 握拳确认', 3200);
    }
  }

  /**
   * 统一处理「确认选牌」。
   * @param {'gesture'|'pointer'} _source 事件来源（当前仅用于日志）
   */
  handleConfirm(_source) {
    // 正在生成解读时不响应
    if (this._generating) return;
    // 已经选满三张则不再响应
    if (this.deck.selected.length >= 3) return;

    // 若还在「等待提问」阶段，先隐式进入浏览状态
    if (this.state === 'asking') this._enterBrowsing();

    // 执行选牌
    const result = this.deck.confirm();
    // 选中失败（卡牌已被选走等）
    if (!result) {
      // 给出提示
      this.ui.toast('这张牌已经离开牌阵了，换一张试试');
      // 结束
      return;
    }

    // 更新牌位指示点
    this.ui.renderSlotDots(this.deck.selected.length, this.deck.selected.length);
    // 提示选中的牌
    this.ui.toast(
      `第 ${result.slot + 1} 张 · ${result.card.data.name}（${result.card.isReversed ? '逆位' : '正位'}）`
    );
    // 刷新底部提示
    this._refreshHint();

    // 三张齐备则生成解读
    if (this.deck.selected.length === 3) {
      // 标记正在生成，避免重复触发
      this._generating = true;
      // 更新状态
      this.ui.setStatus('三张牌已就位 · 正在解读…', 'warn');
      // 延迟一小段时间，让用户看清最后一张牌落位
      clearTimeout(this._readingTimer);
      // 设置定时器
      this._readingTimer = setTimeout(() => this._generateReading(), READING_DELAY * 1000);
    }
  }

  /**
   * 生成并渲染解读。
   */
  _generateReading() {
    // 取出已选中的牌
    const selection = this.deck.getSelection();
    // 数量不足则放弃
    if (selection.length < 3) {
      // 解除标记
      this._generating = false;
      // 结束
      return;
    }

    // 使用用户问题，空则用默认问题
    const question = this.question || DEFAULT_QUESTION;

    // 先展示加载态，给「解读中」一个可见的过程
    this.ui.setReadingMode(true);
    // 渲染加载结构
    this.ui.renderReadingLoading();
    // 更新顶部状态
    this.ui.setStatus('正在解读牌阵…', 'warn');

    // 稍作停顿再渲染结果：一方面让加载动画可见，另一方面避免卡顿感
    setTimeout(() => {
      // 生成解读
      this.reading = generateReading({ question, selection });
      // 渲染
      this.ui.renderReading(this.reading);
      // 进入解读状态
      this._enterReading();
      // 解除生成标记
      this._generating = false;
    }, 620);
  }

  /**
   * 重置整个牌局。
   */
  async reset() {
    // 取消待执行的解读弹出
    clearTimeout(this._readingTimer);
    // 解除生成标记
    this._generating = false;
    // 清空解读结果
    this.reading = null;
    // 关闭阅读模式
    this.ui.setReadingMode(false);
    // 清空输入框
    this.ui.clearQuestion();
    // 清空问题
    this.question = '';
    // 重置牌位指示点
    this.ui.renderSlotDots(0, 0);
    // 顶部状态
    this.ui.setStatus('正在重新洗牌…', 'warn');
    // 重置牌阵（内部会重新洗牌发牌）
    await this.deck.reset((p) => this.ui.setLoadingProgress(p, '正在重新洗牌…'));
    // 提示
    this.ui.toast('牌阵已重置 · 可以重新提问了');
    // 回到等待提问
    this._enterAsking();
  }

  /**
   * 切换手势追踪的开关。
   */
  async toggleGesture() {
    // 已开启则关闭
    if (this.handTracker.started) {
      // 停止追踪
      this.handTracker.stop();
      // 重置识别器状态
      this.recognizer.reset();
      // 隐藏摄像头面板
      this.ui.setCameraPanelVisible(false);
      // 隐藏手势光标
      if (this.ui.gestureCursor) this.ui.gestureCursor.hidden = true;
      // 刷新提示
      this._refreshHint();
      // 结束
      return;
    }

    // 显示摄像头面板（先显示，让用户看到权限弹窗时画面已经在准备）
    this.ui.setCameraPanelVisible(true);
    // 按钮进入加载态
    this.ui.setGestureButton(false, true);
    // 启动追踪
    const ok = await this.handTracker.start();
    // 启动失败
    if (!ok) {
      // 隐藏面板
      this.ui.setCameraPanelVisible(false);
      // 恢复按钮
      this.ui.setGestureButton(false, false);
      // 刷新提示（回到键鼠）
      this._refreshHint();
    }
  }

  // ==========================================================================
  // 每帧更新
  // ==========================================================================

  /**
   * 每帧更新所有子系统。
   * @param {number} dt 帧间隔（秒）
   * @param {number} elapsed 累计运行时间（秒）
   */
  _update(dt, elapsed) {
    // 更新环境（星空自转、星云漂流、浮尘上升）
    this.environment.update(dt, elapsed);
    // 更新牌阵（布局、卡牌动画、粒子）
    this.deck.update(dt, elapsed);

    // 手势开启时才跑推理与叠加层
    if (this.handTracker.started) {
      // 执行一次推理（内部有帧率上限）
      this.handTracker.update(dt);
      // 绘制叠加层与光标
      this.overlay.update(dt);
    }

    // ------------------------------------------------------------------
    // 视差衰减：一段时间没有新的输入就把镜头缓缓拉回中位
    // ------------------------------------------------------------------
    if (this._parallaxTTL > 0) {
      // 递减有效期
      this._parallaxTTL -= dt;
      // 把目标值写入舞台
      this.stage.setParallax(this._parallaxTarget.x, this._parallaxTarget.y);
    } else {
      // 没有输入时阻尼归零
      this.stage.setParallax(
        // 平滑衰减 x
        damp(this.stage.parallax.x, 0, 0.02, dt),
        // 平滑衰减 y
        damp(this.stage.parallax.y, 0, 0.02, dt)
      );
    }
  }

  // ==========================================================================
  // 工具
  // ==========================================================================

  /**
   * 等待下一帧。
   * @returns {Promise<void>}
   */
  _nextFrame() {
    // 用 requestAnimationFrame 包装成 Promise
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  /**
   * 延时等待。
   * @param {number} ms 毫秒数
   * @returns {Promise<void>}
   */
  _delay(ms) {
    // 用 setTimeout 包装成 Promise
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 释放全部资源。
   */
  dispose() {
    // 停止手部追踪
    this.handTracker?.stop();
    // 关闭键鼠控制
    this.pointer?.disable();
    // 释放牌阵
    this.deck?.dispose();
    // 释放环境
    this.environment?.dispose();
    // 释放贴图
    this.textures?.dispose();
    // 释放舞台
    this.stage?.dispose();
  }
}
