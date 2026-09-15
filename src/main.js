// ============================================================================
// main.js —— 应用入口
// ----------------------------------------------------------------------------
// 入口文件只做三件事：引入样式、创建应用实例、启动应用。
// 所有业务逻辑都拆分在 core / tarot / interaction / reading / ui 五个模块目录中，
// 入口保持极薄，方便阅读与后续扩展。
// ============================================================================

// 引入全局样式表（由 Vite 处理并注入到页面 head 中）
import './styles/main.css';
// 引入应用主类
import { App } from './core/App.js';

/**
 * 启动函数：创建应用实例并开始主循环。
 * 单独封装成函数是为了能统一捕获初始化期间的异步异常，给用户一个明确的反馈。
 */
async function bootstrap() {
  // 取得页面上的 3D 画布
  const canvas = document.getElementById('stage');
  // 画布缺失说明 HTML 结构异常，直接抛出便于快速定位
  if (!canvas) throw new Error('未找到 #stage 画布元素');

  // 创建应用实例
  const app = new App(canvas);
  // 执行异步初始化（生成贴图、构建牌阵、接线交互）
  await app.init();
  // 启动渲染循环
  app.start();

  // 把实例挂到 window 上，方便在开发者工具里调试各子系统
  window.__ARCANA__ = app;
}

// 执行启动，并捕获所有未处理的异常
bootstrap().catch((err) => {
  // 打印完整错误栈
  console.error('[Arcana] 启动失败：', err);
  // 在加载遮罩上显示错误文案，避免用户面对一片空白
  const tip = document.querySelector('#loading .loading-tip');
  // 元素存在才写入
  if (tip) tip.textContent = '启动失败，请打开控制台查看详细日志';
  // 同时把遮罩的进度条标红，形成明确的视觉提示
  const bar = document.getElementById('loading-bar-fill');
  // 存在则改色
  if (bar) bar.style.background = 'linear-gradient(90deg, #7a2a20, #e07a6a)';
});

// 页面卸载时释放 WebGL 与摄像头资源，避免开发热更新时残留上下文
window.addEventListener('beforeunload', () => {
  // 实例存在才释放
  if (window.__ARCANA__) {
    // 调用释放方法
    try {
      window.__ARCANA__.dispose();
    } catch {
      // 忽略释放过程中的异常
    }
  }
});
