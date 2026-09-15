// ============================================================================
// ui/UIManager.js —— 界面管理器
// ----------------------------------------------------------------------------
// 把「查 DOM、改文案、切状态、渲染解读」这类脏活全部收拢在这里，
// 让 App 只关心业务流转，读代码时不会被一堆 querySelector 打断。
// 交互回调统一以构造参数的形式注入，保证 UI 层不反向依赖任何业务模块。
// ============================================================================

// 引入快捷问题列表
import { QUICK_ASKS } from '../reading/meanings.js';
// 引入数学工具
import { clamp } from '../core/mathUtils.js';

// ---------------------------------------------------------------------------
// 牌位标签：与 Deck 中的 SLOT_LABELS 保持一致
// ---------------------------------------------------------------------------
const SLOT_LABELS = ['现状', '转折', '走向'];

/**
 * UIManager —— 界面管理器
 */
export class UIManager {
  /**
   * 构造函数。
   * @param {object} callbacks 交互回调集合
   * @param {Function} callbacks.onAsk 点击「开始抽牌」时触发，参数为问题文本
   * @param {Function} callbacks.onReset 点击「重新开始」时触发
   * @param {Function} callbacks.onReadingClose 关闭解读面板时触发
   */
  constructor(callbacks = {}) {
    // 保存回调集合
    this.callbacks = callbacks;

    // ------------------------------------------------------------------
    // 缓存所有需要操作的 DOM 节点
    // ------------------------------------------------------------------
    // 状态胶囊与其内部文案
    this.statusChip = document.getElementById('status-chip');
    // 状态文案
    this.statusText = document.getElementById('status-text');
    // 帮助按钮
    this.btnHelp = document.getElementById('btn-help');
    // 帮助弹层
    this.helpModal = document.getElementById('help-modal');
    // 关闭帮助弹层
    this.btnHelpClose = document.getElementById('btn-help-close');

    // 牌位指示点容器
    this.slotDotsEl = document.getElementById('slot-dots');
    // 操作提示文案
    this.focusHint = document.getElementById('focus-hint');

    // 提问面板
    this.askPanel = document.getElementById('ask-panel');
    // 问题输入框
    this.questionInput = document.getElementById('question-input');
    // 字数提示
    this.questionCount = document.getElementById('question-count');
    // 快捷问题容器
    this.quickAsksEl = document.getElementById('quick-asks');
    // 开始抽牌按钮
    this.btnDraw = document.getElementById('btn-draw');
    // 重新开始按钮
    this.btnReset = document.getElementById('btn-reset');

    // 解读面板
    this.readingPanel = document.getElementById('reading-panel');
    // 解读正文容器
    this.readingBody = document.getElementById('reading-body');
    // 关闭解读面板
    this.btnReadingClose = document.getElementById('btn-reading-close');

    // 提示条
    this.toastEl = document.getElementById('toast');

    // 加载遮罩
    this.loadingEl = document.getElementById('loading');
    // 进度条填充
    this.loadingBarFill = document.getElementById('loading-bar-fill');
    // 加载文案
    this.loadingTip = document.getElementById('loading-tip');
    // 进度百分比
    this.loadingPercent = document.getElementById('loading-percent');

    // 牌位指示点元素数组（由 renderSlotDots 填充）
    this.slotDots = [];

    // 提示条的隐藏定时器
    this._toastTimer = 0;
    // 上一次设置的提示文案，避免重复写入触发重排
    this._lastHint = '';
  }

  /**
   * 绑定所有界面事件。
   */
  bindEvents() {
    // ------------------------------------------------------------------
    // 帮助弹层
    // ------------------------------------------------------------------
    this.btnHelp?.addEventListener('click', () => {
      // 显示弹层
      this.helpModal.hidden = false;
    });
    // 关闭按钮
    this.btnHelpClose?.addEventListener('click', () => {
      // 隐藏弹层
      this.helpModal.hidden = true;
    });
    // 点击遮罩空白处也能关闭
    this.helpModal?.addEventListener('click', (e) => {
      // 只有点在遮罩本身（而非内容卡片）时才关闭
      if (e.target === this.helpModal) this.helpModal.hidden = true;
    });

    // ------------------------------------------------------------------
    // 输入框字数统计
    // ------------------------------------------------------------------
    this.questionInput?.addEventListener('input', () => {
      // 更新计数
      this._updateQuestionCount();
    });

    // ------------------------------------------------------------------
    // 快捷问题标签
    // ------------------------------------------------------------------
    this._renderQuickAsks();

    // ------------------------------------------------------------------
    // 开始抽牌
    // ------------------------------------------------------------------
    this.btnDraw?.addEventListener('click', () => {
      // 取输入内容
      const q = this.questionInput?.value?.trim() || '';
      // 交给外部处理
      this.callbacks.onAsk?.(q);
    });

    // ------------------------------------------------------------------
    // 重新开始
    // ------------------------------------------------------------------
    this.btnReset?.addEventListener('click', () => {
      // 交给外部处理
      this.callbacks.onReset?.();
    });

    // ------------------------------------------------------------------
    // 关闭解读面板
    // ------------------------------------------------------------------
    this.btnReadingClose?.addEventListener('click', () => {
      // 交给外部处理
      this.callbacks.onReadingClose?.();
    });

    // ------------------------------------------------------------------
    // 解读面板内的动态按钮：使用事件委托，
    // 因为解读正文是通过 innerHTML 动态生成的，直接绑定会随重渲染失效。
    // ------------------------------------------------------------------
    this.readingBody?.addEventListener('click', (e) => {
      // 向上查找带 data-action 的祖先节点
      const trigger = e.target.closest?.('[data-action="restart"]');
      // 找到了才触发重置
      if (trigger) this.callbacks.onReset?.();
    });

    // ------------------------------------------------------------------
    // 键盘快捷键：Esc 关闭弹层
    // ------------------------------------------------------------------
    window.addEventListener('keydown', (e) => {
      // 只在按下 Esc 时处理
      if (e.key !== 'Escape') return;
      // 优先关闭帮助弹层
      if (!this.helpModal.hidden) this.helpModal.hidden = true;
    });

    // 初始化字数统计
    this._updateQuestionCount();
  }

  /**
   * 渲染快捷问题标签。
   */
  _renderQuickAsks() {
    // 容器不存在则跳过
    if (!this.quickAsksEl) return;
    // 清空占位内容
    this.quickAsksEl.innerHTML = '';
    // 逐个创建标签
    QUICK_ASKS.forEach((text) => {
      // 创建按钮元素
      const btn = document.createElement('button');
      // 设置为按钮类型
      btn.type = 'button';
      // 加上样式类
      btn.className = 'quick-ask';
      // 写入文案
      btn.textContent = text;
      // 点击后填入输入框
      btn.addEventListener('click', () => {
        // 写入输入框
        this.questionInput.value = text;
        // 更新字数
        this._updateQuestionCount();
        // 让输入框获得焦点，便于用户继续修改
        this.questionInput.focus();
      });
      // 加入容器
      this.quickAsksEl.appendChild(btn);
    });
  }

  /**
   * 更新输入框字数提示。
   */
  _updateQuestionCount() {
    // 元素不存在则跳过
    if (!this.questionCount || !this.questionInput) return;
    // 当前长度
    const len = this.questionInput.value.length;
    // 输入框允许的最大长度
    const max = Number(this.questionInput.getAttribute('maxlength')) || 120;
    // 写入文案
    this.questionCount.textContent = `${len} / ${max}`;
  }

  /**
   * 渲染三个牌位指示点。
   * @param {number} filledCount 已填充的数量
   * @param {number} activeIndex 当前待填充的索引
   */
  renderSlotDots(filledCount, activeIndex) {
    // 容器不存在则跳过
    if (!this.slotDotsEl) return;
    // 首次调用时创建节点
    if (this.slotDots.length === 0) {
      // 逐个创建
      SLOT_LABELS.forEach((label) => {
        // 创建 span
        const dot = document.createElement('span');
        // 样式类
        dot.className = 'slot-dot';
        // 把标签写进 data 属性，供 CSS 的 ::after 使用
        dot.setAttribute('data-label', label);
        // 加入容器
        this.slotDotsEl.appendChild(dot);
        // 记录引用
        this.slotDots.push(dot);
      });
    }
    // 更新每个指示点的状态
    this.slotDots.forEach((dot, i) => {
      // 是否已填充
      dot.classList.toggle('is-filled', i < filledCount);
      // 是否为当前待填充位
      dot.classList.toggle('is-active', i === activeIndex && filledCount < 3);
    });
  }

  /**
   * 设置顶部状态胶囊。
   * @param {string} text 状态文案
   * @param {'idle'|'ok'|'warn'|'error'} [state] 状态类型
   */
  setStatus(text, state = 'idle') {
    // 文案元素存在则写入
    if (this.statusText) this.statusText.textContent = text;
    // 状态属性存在则写入
    if (this.statusChip) this.statusChip.setAttribute('data-state', state);
  }

  /**
   * 设置底部操作提示。
   * @param {string} text 提示文案
   */
  setHint(text) {
    // 内容未变则不写入，避免无谓的重排
    if (this._lastHint === text) return;
    // 记录
    this._lastHint = text;
    // 元素存在则写入
    if (this.focusHint) this.focusHint.textContent = text;
  }

  /**
   * 显示提示条。  /**
   * 显示提示条。
   * @param {string} text 提示文案
   * @param {number} [duration] 显示时长（毫秒）
   */
  toast(text, duration = 2200) {
    // 元素不存在则跳过
    if (!this.toastEl) return;
    // 写入文案
    this.toastEl.textContent = text;
    // 加上显示类
    this.toastEl.classList.add('is-visible');
    // 清除上一个定时器
    clearTimeout(this._toastTimer);
    // 设置新的隐藏定时器
    this._toastTimer = setTimeout(() => {
      // 移除显示类
      this.toastEl.classList.remove('is-visible');
    }, duration);
  }

  /**
   * 更新加载进度。
   * @param {number} ratio 0~1
   * @param {string} [tip] 进度文案
   */
  setLoadingProgress(ratio, tip) {
    // 夹紧比例
    const p = clamp(ratio, 0, 1);
    // 更新进度条宽度
    if (this.loadingBarFill) this.loadingBarFill.style.width = `${(p * 100).toFixed(1)}%`;
    // 更新百分比文字
    if (this.loadingPercent) this.loadingPercent.textContent = `${Math.round(p * 100)}%`;
    // 更新文案
    if (tip && this.loadingTip) this.loadingTip.textContent = tip;
  }

  /**
   * 隐藏加载遮罩。
   */
  hideLoading() {
    // 加上完成类，由 CSS 播放淡出
    this.loadingEl?.classList.add('is-done');
  }

  /**
   * 切换「阅读模式」：阅读模式下提问面板滑出，解读面板滑入。
   * @param {boolean} on 是否处于阅读模式
   */
  setReadingMode(on) {
    // 通过 body 上的 class 驱动 CSS
    document.body.classList.toggle('is-reading', on);
    // 显示或隐藏解读面板
    if (this.readingPanel) this.readingPanel.hidden = !on;
  }

  /**
   * 在解读面板中渲染「正在生成」状态。
   */
  renderReadingLoading() {
    // 容器不存在则跳过
    if (!this.readingBody) return;
    // 写入加载结构
    this.readingBody.innerHTML = `
      <div class="reading-loading">
        <span class="spinner"></span>
        <span>正在解读牌阵…</span>
      </div>
    `;
  }

  /**
   * 渲染完整解读结果。
   * @param {object} reading generateReading 的返回值
   */
  renderReading(reading) {
    // 容器不存在则跳过
    if (!this.readingBody) return;

    // 用于拼接 HTML 片段
    const parts = [];

    // ------------------------------------------------------------------
    // 1. 问题回显
    // ------------------------------------------------------------------
    // 有有效问题才显示
    if (reading.cleanQuestion) {
      // 转义后再插入，避免用户输入破坏结构
      parts.push(
        `<div class="reading-question">「${this._escape(reading.cleanQuestion)}」<br><span style="opacity:.6;font-size:11px;letter-spacing:.1em">类别：${
          reading.category.label
        } · 类型：${reading.questionType.label}</span></div>`
      );
    }

    // ------------------------------------------------------------------
    // 2. 问题类型说明
    // ------------------------------------------------------------------
    parts.push(`<p class="reading-paragraph">${this._escape(reading.questionType.intro)}</p>`);

    // ------------------------------------------------------------------
    // 3. 三张牌概览
    // ------------------------------------------------------------------
    parts.push('<div class="reading-section-title">牌面</div>');
    parts.push('<div class="card-summary-list">');
    // 逐张渲染
    reading.cards.forEach((c) => {
      // 正逆位样式类
      const orientClass = c.isReversed ? ' is-reversed' : '';
      // 概览卡片结构
      parts.push(`
        <div class="card-summary">
          <div class="card-summary-pos">${c.position.label}</div>
          <div class="card-summary-content">
            <div class="card-summary-title">
              <span class="card-summary-name">${this._escape(c.data.name)}</span>
              <span class="card-summary-en">${this._escape(c.data.en)}</span>
              <span class="card-summary-orient${orientClass}">${c.orientation}</span>
            </div>
            <div class="card-summary-keywords">${c.keywords.map((k) => this._escape(k)).join(' · ')}</div>
          </div>
        </div>
      `);
    });
    parts.push('</div>');

    // ------------------------------------------------------------------
    // 4. 逐张解读
    // ------------------------------------------------------------------
    parts.push('<div class="reading-section-title">逐张解读</div>');
    reading.cards.forEach((c) => {
      // 小节标题
      parts.push(`<div class="reading-section-title">${this._escape(c.headline)}</div>`);
      // 段落
      c.paragraphs.forEach((p) => {
        // 转义后插入
        parts.push(`<p class="reading-paragraph">${this._escape(p)}</p>`);
      });
    });

    // ------------------------------------------------------------------
    // 5. 综合结论
    // ------------------------------------------------------------------
    parts.push(`<div class="reading-section-title">${this._escape(reading.synthesis.title)}</div>`);
    // 逐个段落
    reading.synthesis.paragraphs.forEach((p) => {
      // 插入
      parts.push(`<p class="reading-paragraph">${this._escape(p)}</p>`);
    });

    // ------------------------------------------------------------------
    // 6. 能量评估
    // ------------------------------------------------------------------
    parts.push('<div class="reading-section-title">能量评估</div>');
    // 能量标签与百分比
    parts.push(
      `<p class="reading-paragraph" style="margin-bottom:2px">${this._escape(
        reading.energy.label
      )} · 正位 ${reading.energy.uprights}/3 · 大阿卡纳 ${reading.energy.majors}/3</p>`
    );
    // 能量条
    parts.push(`
      <div class="energy-meter"><i style="width:${reading.energy.percent}%"></i></div>
      <p class="energy-caption">沟通度 ${reading.energy.percent}%</p>
    `);
    // 等级说明
    parts.push(`<p class="reading-paragraph" style="margin-top:10px">${this._escape(reading.energy.caption)}</p>`);

    // ------------------------------------------------------------------
    // 7. 行动建议
    // ------------------------------------------------------------------
    parts.push('<div class="reading-section-title">行动建议</div>');
    parts.push('<ul class="advice-list">');
    // 逐条渲染，序号由 data-index 提供给 CSS
    reading.advice.forEach((a, i) => {
      // 插入列表项
      parts.push(`<li data-index="${i + 1}">${this._escape(a)}</li>`);
    });
    parts.push('</ul>');

    // ------------------------------------------------------------------
    // 8. 需要留意
    // ------------------------------------------------------------------
    parts.push('<div class="reading-section-title">需要留意</div>');
    // 警示块
    parts.push(`<div class="caution-block">${this._escape(reading.caution)}</div>`);

    // ------------------------------------------------------------------
    // 9. 底部操作：解读面板展开时提问面板会滑出屏幕，
    //    因此必须在这里提供「重新开始」的入口，否则用户会被困在解读里。
    // ------------------------------------------------------------------
    parts.push(
      `<button type="button" class="btn btn-gold reading-restart" data-action="restart">重新开始 · 再抽一次</button>`
    );

    // 写入页面
    this.readingBody.innerHTML = parts.join('\n');
    // 重置滚动位置到顶部
    this.readingBody.scrollTop = 0;
  }

  /**
   * HTML 转义，防止用户输入破坏页面结构。
   * @param {string} str 原始字符串
   * @returns {string} 转义后的字符串
   */
  _escape(str) {
    // 空值兜底
    if (str === undefined || str === null) return '';
    // 依次替换五个危险字符
    return String(str)
      // & 必须最先替换
      .replace(/&/g, '&amp;')
      // 小于号
      .replace(/</g, '&lt;')
      // 大于号
      .replace(/>/g, '&gt;')
      // 双引号
      .replace(/"/g, '&quot;')
      // 单引号
      .replace(/'/g, '&#39;');
  }

  /**
   * 读取当前输入的问题。
   * @returns {string} 问题文本
   */
  getQuestion() {
    // 读取并去空白
    return (this.questionInput?.value || '').trim();
  }

  /**
   * 清空输入框。
   */
  clearQuestion() {
    // 元素存在才清空
    if (this.questionInput) this.questionInput.value = '';
    // 重置计数
    this._updateQuestionCount();
  }

  /**
   * 设置「开始抽牌」按钮的可用状态。
   * @param {boolean} enabled 是否可用
   * @param {string} [label] 自定义文案
   */
  setDrawButton(enabled, label) {
    // 元素不存在则跳过
    if (!this.btnDraw) return;
    // 设置可用状态
    this.btnDraw.disabled = !enabled;
    // 自定义文案
    if (label) this.btnDraw.textContent = label;
  }
}
