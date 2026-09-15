// ============================================================================
// core/Emitter.js —— 极简事件总线
// ----------------------------------------------------------------------------
// 手势识别、牌阵、UI 之间需要松耦合地互相通知，因此实现一个不到 60 行的
// 发布/订阅工具，避免引入任何第三方事件库。
// ============================================================================

/**
 * Emitter —— 极简事件发射器
 * 用法：
 *   const bus = new Emitter();
 *   const off = bus.on('swipe', (payload) => { ... });  // 订阅，返回取消函数
 *   bus.emit('swipe', { direction: 1 });                // 发布
 */
export class Emitter {
  /**
   * 构造函数：初始化事件表
   */
  constructor() {
    // 事件表结构：{ 事件名: Set<回调函数> }，使用 Set 自动去重
    this._handlers = new Map();
  }

  /**
   * 订阅事件
   * @param {string} type 事件名
   * @param {Function} handler 回调函数
   * @returns {Function} 取消订阅的函数（调用即解绑，方便在组件销毁时清理）
   */
  on(type, handler) {
    // 若该事件尚无订阅者，先创建一个空的 Set
    if (!this._handlers.has(type)) this._handlers.set(type, new Set());
    // 把回调加入集合
    this._handlers.get(type).add(handler);
    // 返回取消订阅的闭包
    return () => this.off(type, handler);
  }

  /**
   * 订阅一次性事件（触发后自动解绑）
   * @param {string} type 事件名
   * @param {Function} handler 回调函数
   * @returns {Function} 取消订阅的函数
   */
  once(type, handler) {
    // 包一层包装函数：先解绑自身，再执行原回调
    const wrapper = (payload) => {
      // 先解绑，避免回调内部再次触发导致重复执行
      this.off(type, wrapper);
      // 再执行真正的业务回调
      handler(payload);
    };
    // 注册包装函数
    return this.on(type, wrapper);
  }

  /**
   * 取消订阅
   * @param {string} type 事件名
   * @param {Function} handler 回调函数
   */
  off(type, handler) {
    // 取出该事件的订阅集合
    const set = this._handlers.get(type);
    // 集合不存在则无需处理
    if (!set) return;
    // 删除指定回调
    set.delete(handler);
    // 集合为空时顺手清掉这个 key，避免事件表无限增长
    if (set.size === 0) this._handlers.delete(type);
  }

  /**
   * 发布事件
   * @param {string} type 事件名
   * @param {*} payload 任意载荷
   */
  emit(type, payload) {
    // 取出该事件的订阅集合
    const set = this._handlers.get(type);
    // 没有订阅者时直接返回
    if (!set) return;
    // 复制一份再遍历：防止回调内部调用 off 修改集合导致遍历异常
    for (const handler of [...set]) {
      // 单个回调出错不应影响其它回调，因此逐个 try/catch
      try {
        // 执行回调
        handler(payload);
      } catch (err) {
        // 打印错误但继续派发
        console.error(`[Emitter] 处理事件 "${type}" 时出错：`, err);
      }
    }
  }

  /**
   * 清空所有订阅（用于应用重置或销毁）
   */
  clear() {
    // 直接清空事件表
    this._handlers.clear();
  }
}
