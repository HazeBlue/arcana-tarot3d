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
//
// 牌阵是 78 张牌铺成的闭环，浏览索引没有上下限，因此可以无限滑动、永远不会到头。
// 所有操作（键鼠、UI 按钮）都汇聚到同一组方法上，行为完全一致。
// ============================================================================

// 引入三维舞台
import { Stage } from './Stage.js';
// 引入环境构建器
import { Environment } from './Environment.js';
// 引入贴图工厂
import { TextureFactory } from '../tarot/CardTextures.js';
// 引入牌阵管理器
import { Deck } from '../tarot/Deck.js';
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
    // 6. 交互层：键鼠
    // ------------------------------------------------------------------
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
    // 78 张牌铺成闭环，可以无限滑动，因此提示里要明确「循环」这件事
    this.ui.setHint(
      n === 0
        ? '← / → 浏览牌阵（可无限循环）· 空格确认第一张牌'
        : `← / → 继续浏览 · 空格确认第 ${n + 1} 张牌`
    );
  }

  // ==========================================================================
  // 事件绑定
  // ==========================================================================

  /**
   * 绑定键鼠事件。
   *
   * 说明：项目早期版本提供过摄像头手势操作，实测在同一台机器上
   * MediaPipe 推理会持续占用 GPU、把渲染帧率拖到难以忍受，
   * 收益远小于代价，因此已整体移除。当前的浏览与选牌全部由键鼠驱动。
   */
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
