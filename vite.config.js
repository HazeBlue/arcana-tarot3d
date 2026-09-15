// ============================================================================
// vite.config.js —— 构建与开发服务器配置
// ----------------------------------------------------------------------------
// 本项目只依赖 three.js 本体，MediaPipe 手势模型在运行时按需从 CDN 动态加载，
// 因此构建配置保持极简：一个静态站点产物即可直接部署到任意静态托管。
// ============================================================================

// 从 vite 引入配置辅助函数，用于获得参数类型提示
import { defineConfig } from 'vite';

// 导出配置对象
export default defineConfig({
  // 使用相对路径作为资源基础路径，保证产物可以放在任意子目录下访问
  base: './',

  // 开发服务器配置
  server: {
    // 只绑定 localhost：浏览器仅在 localhost 或 https 下才允许访问摄像头，
    // 因此这里不开放局域网 IP，避免用户从 http://192.168.x.x 打开时无法启用手势
    host: 'localhost',
    // 固定端口，方便记忆
    port: 5173,
    // 启动后自动打开浏览器
    open: true,
  },

  // 构建配置
  build: {
    // 产物输出目录
    outDir: 'dist',
    // 静态资源子目录
    assetsDir: 'assets',
    // 编译目标，现代浏览器即可满足 WebGL2 + ES Module 的要求
    target: 'es2020',
    // 关闭 sourcemap 以减小开源仓库中的产物体积（仅在构建时生效）
    sourcemap: false,
    // 产物体积警告阈值（KB），three.js 本体较大，这里放宽到 1200KB
    chunkSizeWarningLimit: 1200,
    // 针对 three.js 做手动分包，让核心库与业务代码分离，利于浏览器缓存
    rollupOptions: {
      output: {
        manualChunks: {
          // three.js 单独打包成一个 chunk
          three: ['three'],
        },
      },
    },
  },
});
