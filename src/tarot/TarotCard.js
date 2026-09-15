// ============================================================================
// tarot/TarotCard.js —— 三维卡牌实体
// ----------------------------------------------------------------------------
// 一张牌由四层结构组成（由外到内）：
//   TarotCard (Group)        位置与朝向由牌阵控制，本身只做阻尼跟随
//     └ model (Group)        负责「翻面」——绕 Y 轴旋转 0 或 π
//         └ spin (Group)     负责「正逆位」——绕 Z 轴旋转 0 或 π
//             ├ body         圆角矩形挤出体，金色金属材质构成牌的厚度
//             ├ backPlane    牌背贴图
//             └ facePlane    牌面贴图（延迟到首次翻开前才生成，节省启动时间）
//     └ glow (Sprite)        卡牌后方的光晕，聚焦时点亮，配合泛光形成光晕
// 动画策略：
//   浏览阶段用「指数阻尼跟随目标位姿」，天然平滑且帧率无关；
//   选牌时切换到「贝塞尔飞行补间」，让卡牌沿弧线飞入牌位。
// ============================================================================

// 引入 three.js 核心命名空间
import * as THREE from 'three';
// 引入数学工具
import { damp, Easing, quadraticBezier } from '../core/mathUtils.js';

// ---------------------------------------------------------------------------
// 共享几何体：78 张牌的形状完全一致，因此全局只构建一次，显著节省显存
// ---------------------------------------------------------------------------
let SHARED_CARD_GEOMETRY = null;
// 共享的正面/背面平面几何体
let SHARED_PLANE_GEOMETRY = null;
// 牌体在 Z 方向的真实半厚度。
// 关键坑：ExtrudeGeometry 开启 bevel 之后，实际 Z 跨度是 depth + 2 × bevelThickness，
// 而不是单纯的 depth。牌背/牌面平面必须贴在这个真实半厚度之外，否则会被牌体吞掉，
// 导致「牌背永远显示为一块纯金板」这种极难排查的问题。
let CARD_HALF_DEPTH = 0;

// 卡牌宽度（世界单位）
export const CARD_WIDTH = 1.5;
// 卡牌高度，保持 1 : 1.664 的经典塔罗比例
export const CARD_HEIGHT = 2.496;
// 卡牌厚度
export const CARD_DEPTH = 0.026;

/**
 * 构建圆角矩形形状（用于挤出）。
 * @param {number} w 宽
 * @param {number} h 高
 * @param {number} r 圆角半径
 * @returns {THREE.Shape} 形状对象
 */
function makeRoundedRectShape(w, h, r) {
  // 新建形状
  const shape = new THREE.Shape();
  // 半宽
  const hw = w / 2;
  // 半高
  const hh = h / 2;
  // 移动到上边起点
  shape.moveTo(-hw + r, hh);
  // 上边
  shape.lineTo(hw - r, hh);
  // 右上圆角
  shape.quadraticCurveTo(hw, hh, hw, hh - r);
  // 右边
  shape.lineTo(hw, -hh + r);
  // 右下圆角
  shape.quadraticCurveTo(hw, -hh, hw - r, -hh);
  // 下边
  shape.lineTo(-hw + r, -hh);
  // 左下圆角
  shape.quadraticCurveTo(-hw, -hh, -hw, -hh + r);
  // 左边
  shape.lineTo(-hw, hh - r);
  // 左上圆角
  shape.quadraticCurveTo(-hw, hh, -hw + r, hh);
  // 返回形状
  return shape;
}

/**
 * 获取（或首次创建）共享的卡牌几何体。
 * @returns {{body: THREE.ExtrudeGeometry, plane: THREE.PlaneGeometry, halfDepth: number}}
 */
function getSharedGeometry() {
  // 已经创建过则直接复用
  if (!SHARED_CARD_GEOMETRY) {
    // 生成圆角矩形路径
    const shape = makeRoundedRectShape(CARD_WIDTH, CARD_HEIGHT, 0.085);
    // 挤出成体：开启小尺寸倒角，让牌边有细微的高光转折
    SHARED_CARD_GEOMETRY = new THREE.ExtrudeGeometry(shape, {
      // 挤出厚度
      depth: CARD_DEPTH,
      // 曲线细分段数，8 段足以让圆角平滑
      curveSegments: 8,
      // 开启倒角
      bevelEnabled: true,
      // 倒角厚度
      bevelThickness: 0.005,
      // 倒角尺寸
      bevelSize: 0.005,
      // 倒角细分：2 段在视觉上是性价比最高的选择
      bevelSegments: 2,
    });
    // 计算法线，保证光照正确
    SHARED_CARD_GEOMETRY.computeVertexNormals();
    // 计算包围盒，用它来求出真实的 Z 跨度
    SHARED_CARD_GEOMETRY.computeBoundingBox();
    // 取出包围盒
    const bbox = SHARED_CARD_GEOMETRY.boundingBox;
    // 求 Z 方向的中点（开启倒角后它并不在原点，必须先求出来）
    const centerZ = (bbox.min.z + bbox.max.z) / 2;
    // 把几何体沿 Z 平移，使旋转轴精确穿过牌的中心
    SHARED_CARD_GEOMETRY.translate(0, 0, -centerZ);
    // 平移后包围盒失效，重新计算
    SHARED_CARD_GEOMETRY.computeBoundingBox();
    // 重新取出包围盒
    const bb2 = SHARED_CARD_GEOMETRY.boundingBox;
    // 记录真实半厚度，供牌面/牌背平面定位使用
    CARD_HALF_DEPTH = Math.max(Math.abs(bb2.min.z), Math.abs(bb2.max.z));
  }
  // 平面几何体同样只创建一次
  if (!SHARED_PLANE_GEOMETRY) {
    // 创建一个略小于牌体的平面，避免边缘与挤出体产生 z-fighting
    SHARED_PLANE_GEOMETRY = new THREE.PlaneGeometry(CARD_WIDTH - 0.012, CARD_HEIGHT - 0.012);
  }
  // 返回两个共享几何体以及真实半厚度
  return { body: SHARED_CARD_GEOMETRY, plane: SHARED_PLANE_GEOMETRY, halfDepth: CARD_HALF_DEPTH };
}

/**
 * TarotCard —— 单张三维塔罗牌
 */
export class TarotCard extends THREE.Group {
  /**
   * 构造函数。
   * @param {object} cardData 卡牌数据（来自 cardData.js）
   * @param {object} deps 依赖注入
   * @param {import('./CardTextures.js').TextureFactory} deps.textures 贴图工厂
   * @param {THREE.Texture} deps.backTexture 牌背贴图（整副共用）
   * @param {THREE.Material} deps.bodyMaterial 牌体材质（整副共用）
   * @param {THREE.Material} deps.backMaterial 牌背材质（整副共用）
   * @param {THREE.Material} deps.facePlaceholderMaterial 牌面占位材质（整副共用）
   */
  constructor(cardData, { textures, backTexture, bodyMaterial, backMaterial, facePlaceholderMaterial }) {
    // 调用父类构造函数，把自己变成一个 Group
    super();

    // 保存卡牌数据引用
    this.data = cardData;
    // 保存贴图工厂引用，用于延迟生成牌面
    this.textures = textures;
    // 保存牌背贴图
    this.backTexture = backTexture;
    // 保存牌体共享材质
    this.bodyMaterial = bodyMaterial;
    // 保存牌背共享材质
    this.backMaterial = backMaterial;
    // 保存牌面占位共享材质
    this.facePlaceholderMaterial = facePlaceholderMaterial;

    // 当前是否已生成牌面贴图
    this._faceReady = false;
    // 当前是否处于「已翻开」状态（正面朝向镜头）
    this.faceUp = false;
    // 该牌在本次占卜中是否为逆位
    this.isReversed = false;
    // 当前状态：'fan' 在牌阵中 | 'flying' 飞行中 | 'settled' 已落位
    this.state = 'fan';
    // 已落位的牌位序号（0/1/2），未落位为 -1
    this.slotIndex = -1;

    // 聚焦程度 0~1，由牌阵每帧写入
    this.focusTarget = 0;
    // 平滑后的聚焦程度
    this._focus = 0;
    // 布局缩放系数 0~1，由牌阵根据“离焦点有多远”写入，用于边缘渐隐
    this.layoutScale = 1;

    // 相机引用（由牌阵注入），用于光晕公告板对齐
    this._cameraRef = null;
    // 复用的临时向量，避免每帧新建对象
    this._tmpCamPos = new THREE.Vector3();

    // 牌阵给出的目标位置
    this._targetPosition = new THREE.Vector3();
    // 牌阵给出的目标四元数
    this._targetQuaternion = new THREE.Quaternion();

    // 飞行补间状态
    this._flight = null;

    // 待执行的属性补间列表
    this._tweens = [];

    // 牌的随机相位，用于让每张牌的漂浮动画错开，避免整体同步晃动
    this._phase = Math.random() * Math.PI * 2;
    // 漂浮幅度
    this._floatAmp = 0.018 + Math.random() * 0.014;

    // 构建内部节点
    this._build();
  }

  /**
   * 构建内部结构与材质。
   */
  _build() {
    // 取出共享几何体与真实半厚度
    const { body, plane, halfDepth } = getSharedGeometry();

    // ------------------------------------------------------------------
    // 1. 牌体：金色金属挤出体
    // ------------------------------------------------------------------
    // 创建牌体网格
    const bodyMesh = new THREE.Mesh(body, this.bodyMaterial);
    // 开启投影，让卡牌在桌面上留下阴影
    bodyMesh.castShadow = true;
    // 接收阴影，牌与牌之间会互相投影
    bodyMesh.receiveShadow = true;
    // 记录到实例上便于后续操作
    this.bodyMesh = bodyMesh;

    // ------------------------------------------------------------------
    // 2. 翻转与正逆位节点
    // ------------------------------------------------------------------
    // model 负责翻面
    this.model = new THREE.Group();
    // spin 负责正逆位（在 model 内部，保证正逆位是绕牌面法线旋转）
    this.spin = new THREE.Group();
    // 把 spin 挂到 model 下
    this.model.add(this.spin);
    // 把牌体挂到 spin 下
    this.spin.add(bodyMesh);
    // 初始状态为牌背朝外：绕 Y 轴转 π
    this.model.rotation.y = Math.PI;

    // ------------------------------------------------------------------
    // 3. 牌背平面
    // ------------------------------------------------------------------
    // 直接复用牌阵下发的共享材质：78 张牌的牌背完全一致，没有必要各持一份。
    // 注意必须用 this.xxx 访问——_build() 是方法，看不到构造函数里解构出来的局部变量。
    const backPlane = new THREE.Mesh(plane, this.backMaterial);
    // 放到牌的负 Z 侧：必须贴在真实半厚度之外，否则会被牌体遮住
    backPlane.position.z = -halfDepth - 0.0008;
    // 绕 Y 轴转 π，让它的正面朝外
    backPlane.rotation.y = Math.PI;
    // 挂到 spin 下
    this.spin.add(backPlane);

    // ------------------------------------------------------------------
    // 4. 牌面平面（材质与贴图都延迟到第一次翻开时才创建）
    // ------------------------------------------------------------------
    // 未翻开时用共享的暗色占位材质即可——牌背朝上时玩家根本看不到这一面，
    // 为 78 张牌各建一份牌面材质是纯粹的浪费。
    // 真正需要时（ensureFaceTexture）再替换成带贴图的独立材质。
    // 本张牌专属的牌面材质，未创建前为 null
    this.faceMaterial = null;
    // 创建牌面平面网格，初始使用共享占位材质
    const facePlane = new THREE.Mesh(plane, this.facePlaceholderMaterial);
    // 放到牌的正 Z 侧：同样贴在真实半厚度之外
    facePlane.position.z = halfDepth + 0.0008;
    // 挂到 spin 下
    this.spin.add(facePlane);
    // 记录牌面网格，后续换材质时要重新指向它
    this.facePlane = facePlane;

    // 把 model 挂到本组
    this.add(this.model);

    // ------------------------------------------------------------------
    // 5. 背后光晕：聚焦时点亮，配合 Bloom 形成金色光晕
    // ------------------------------------------------------------------
    // 用加色混合的平面实现，成本远低于真实光源
    const glowMat = new THREE.MeshBasicMaterial({
      // 径向渐变光晕贴图
      map: this.textures.createRadialSprite('rgba(255, 226, 160, 0.95)', 'rgba(255, 200, 90, 0)'),
      // 加色混合，让光晕叠加而不遮挡
      blending: THREE.AdditiveBlending,
      // 关闭深度写入，避免光晕遮挡卡牌
      depthWrite: false,
      // 完全透明，聚焦时淡入
      transparent: true,
      // 初始透明度 0
      opacity: 0,
      // 双面渲染
      side: THREE.DoubleSide,
    });
    // 保存材质引用
    this.glowMaterial = glowMat;
    // 创建光晕网格，尺寸比牌大一圈
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(CARD_WIDTH * 1.9, CARD_HEIGHT * 1.45), glowMat);
    // 放在卡牌后方
    glow.position.z = -0.22;
    // 关闭视锥剔除（光晕尺寸大，容易被误剔）
    glow.frustumCulled = false;
    // 挂到本组
    this.add(glow);
    // 记录光晕网格
    this.glow = glow;

    // 初始化为不可见，由牌阵按聚焦程度控制
    this.glow.visible = false;
  }

  /**
   * 确保牌面贴图已生成（首次翻开时调用）。
   * 这是「按需画牌」的入口：78 张牌在启动时只共享一张牌背贴图，
   * 只有真正被翻开的那几张才会现场绘制牌面并建立独立材质。
   */
  ensureFaceTexture() {
    // 已生成则直接返回
    if (this._faceReady) return;
    // 创建本张牌专属的牌面材质
    this.faceMaterial = new THREE.MeshPhysicalMaterial({
      // 现场绘制并缓存过的牌面贴图
      map: this.textures.createCardFace(this.data),
      // 近乎纯介质：牌面是印刷卡纸，不该有金属反射
      metalness: 0.02,
      // 粗糙度偏高，模拟纸张的漫反射，图案才不会被高光盖住
      roughness: 0.78,
      // 清漆只留极轻一层，避免聚光灯在牌面上糊出一片白
      clearcoat: 0.12,
      // 清漆粗糙度拉高，让残存的高光彻底散开
      clearcoatRoughness: 0.6,
    });
    // 把牌面网格的材质换成新建的这份
    this.facePlane.material = this.faceMaterial;
    // 标记为已生成
    this._faceReady = true;
  }

  /**
   * 设置牌阵给出的目标位姿（浏览阶段每帧调用）。
   * @param {THREE.Vector3} position 目标位置
   * @param {THREE.Quaternion} quaternion 目标朝向
   */
  setLayoutTarget(position, quaternion) {
    // 记录目标位置
    this._targetPosition.copy(position);
    // 记录目标朝向
    this._targetQuaternion.copy(quaternion);
  }

  /**
   * 以贝塞尔弧线飞向目标位姿（选牌落位时调用）。
   * @param {THREE.Vector3} position 终点位置
   * @param {THREE.Quaternion} quaternion 终点朝向
   * @param {number} duration 持续时间（秒）
   * @param {number} arcHeight 弧线抬升高度
   * @param {Function} [onComplete] 完成回调
   */
  flyTo(position, quaternion, duration, arcHeight, onComplete) {
    // 记录起点位置（克隆，避免后续被修改）
    const from = this.position.clone();
    // 记录起点朝向
    const fromQuat = this.quaternion.clone();
    // 计算弧线控制点：起点与终点的中点，再向上抬起
    const control = from.clone().add(position).multiplyScalar(0.5);
    // 抬升控制点
    control.y += arcHeight;
    // 在水平方向也给一点偏移，让轨迹更像抛物线而不是垂直抛物线
    control.z += 0.6;
    // 记录飞行状态
    this._flight = {
      // 起点
      from,
      // 控制点
      control,
      // 终点（克隆，避免外部修改）
      to: position.clone(),
      // 起点朝向
      fromQuat,
      // 终点朝向
      toQuat: quaternion.clone(),
      // 已用时间
      t: 0,
      // 总时长
      duration,
      // 完成回调
      onComplete,
      // 复用的临时向量
      _tmp: new THREE.Vector3(),
    };
    // 切换状态为飞行中
    this.state = 'flying';
  }

  /**
   * 播放翻面动画。
   * @param {boolean} faceUp 目标是否正面朝上
   * @param {boolean} isReversed 是否逆位
   * @param {number} duration 时长（秒）
   */
  flipTo(faceUp, isReversed, duration = 0.75) {
    // 记录本次的逆位标记
    this.isReversed = isReversed;
    // 目标翻面角度：正面朝上为 0，背面朝上为 π
    const targetY = faceUp ? 0 : Math.PI;
    // 目标正逆位角度
    const targetZ = isReversed ? Math.PI : 0;
    // 记录起始角度
    const fromY = this.model.rotation.y;
    // 记录起始正逆位角度
    const fromZ = this.spin.rotation.z;
    // 若翻到正面则提前生成贴图，避免翻转过程中出现占位色
    if (faceUp) this.ensureFaceTexture();
    // 注册一个补间
    this._addTween(duration, Easing.easeInOutCubic, (v) => {
      // 插值翻面角
      this.model.rotation.y = fromY + (targetY - fromY) * v;
      // 插值正逆位角
      this.spin.rotation.z = fromZ + (targetZ - fromZ) * v;
    });
    // 记录状态
    this.faceUp = faceUp;
  }

  /**
   * 注册一个属性补间。
   * @param {number} duration 时长（秒）
   * @param {Function} ease 缓动函数
   * @param {Function} apply 应用函数，接收 0~1 的缓动进度
   * @param {Function} [onComplete] 完成回调
   * @returns {object} 补间对象（可被外部提前移除）
   */
  _addTween(duration, ease, apply, onComplete) {
    // 构建补间对象
    const tween = {
      // 已用时间
      t: 0,
      // 总时长（至少 0.001 秒，避免除零）
      duration: Math.max(duration, 0.001),
      // 缓动函数
      ease,
      // 应用函数
      apply,
      // 完成回调
      onComplete,
    };
    // 加入列表
    this._tweens.push(tween);
    // 返回引用
    return tween;
  }

  /**
   * 每帧更新：推进补间、处理飞行、阻尼跟随、漂浮与光晕。
   * @param {number} dt 帧间隔（秒）
   * @param {number} elapsed 累计运行时间（秒）
   */
  update(dt, elapsed) {
    // ------------------------------------------------------------------
    // 1. 推进普通补间
    // ------------------------------------------------------------------
    // 倒序遍历，便于安全删除
    for (let i = this._tweens.length - 1; i >= 0; i--) {
      // 取出补间
      const tw = this._tweens[i];
      // 累加时间
      tw.t += dt;
      // 计算归一化进度
      const p = Math.min(tw.t / tw.duration, 1);
      // 应用缓动后的值
      tw.apply(tw.ease(p));
      // 播放完毕
      if (p >= 1) {
        // 从列表中移除
        this._tweens.splice(i, 1);
        // 执行完成回调
        if (tw.onComplete) tw.onComplete();
      }
    }

    // ------------------------------------------------------------------
    // 2. 平滑聚焦程度：用阻尼而不是线性插值，得到柔和的“点亮”过程
    // ------------------------------------------------------------------
    this._focus = damp(this._focus, this.focusTarget, 0.0004, dt);

    // ------------------------------------------------------------------
    // 3. 位置与朝向处理：飞行中走贝塞尔轨迹，其余情况阻尼跟随
    // ------------------------------------------------------------------
    if (this.state === 'flying' && this._flight) {
      // 取出飞行状态
      const f = this._flight;
      // 累加飞行时间
      f.t += dt;
      // 归一化进度
      const p = Math.min(f.t / f.duration, 1);
      // 用缓出曲线让飞行的收尾更柔和
      const e = Easing.easeOutCubic(p);
      // 求贝塞尔曲线上的点
      quadraticBezier(f._tmp, f.from, f.control, f.to, e);
      // 应用位置
      this.position.copy(f._tmp);
      // 朝向用球面插值，避免翻转过程中出现扭曲
      this.quaternion.slerpQuaternions(f.fromQuat, f.toQuat, e);
      // 飞行过程中给一个轻微的翻滚，让动作更有生命力
      this.model.rotation.z = Math.sin(p * Math.PI) * 0.22 * (1 - p);
      // 飞行结束
      if (p >= 1) {
        // 精确贴合终点，避免累积误差
        this.position.copy(f.to);
        // 朝向精准贴合
        this.quaternion.copy(f.toQuat);
        // 清除翻滚
        this.model.rotation.z = 0;
        // 切换状态为已落位
        this.state = 'settled';
        // 取出回调并清空引用
        const cb = f.onComplete;
        // 清空飞行状态
        this._flight = null;
        // 执行回调
        if (cb) cb();
      }
    } else if (this.state === 'fan') {
      // 浏览阶段：向牌阵给出的目标位姿阻尼靠拢
      this.position.x = damp(this.position.x, this._targetPosition.x, 0.0006, dt);
      // y 方向同样阻尼，但加上漂浮偏移
      const floatOffset = Math.sin(elapsed * 0.85 + this._phase) * this._floatAmp;
      // 位置 y
      this.position.y = damp(this.position.y, this._targetPosition.y + floatOffset, 0.0006, dt);
      // z 方向阻尼
      this.position.z = damp(this.position.z, this._targetPosition.z, 0.0006, dt);
      // 朝向用球面插值阻尼（slerp 的 t 由阻尼系数换算）
      this.quaternion.slerp(this._targetQuaternion, 1 - Math.pow(0.0006, dt));
      // 聚焦时轻微前倾，像是在“点头示意”
      this.model.rotation.x = -this._focus * 0.06;
    } else if (this.state === 'settled') {
      // 已落位：只做极轻微的呼吸浮动，保持画面活性
      const bob = Math.sin(elapsed * 0.7 + this._phase) * 0.006;
      // 在落位基准上加浮动（基准位置由牌阵写入 _targetPosition）
      this.position.y = damp(this.position.y, this._targetPosition.y + bob, 0.002, dt);
    }

    // ------------------------------------------------------------------
    // 4. 缩放：聚焦时放大，形成“被选中”的视觉层级
    // ------------------------------------------------------------------
    // 聚焦时放大到 1.13 倍，同时乘以牌阵给出的边缘缩放系数
    const targetScale = (1 + this._focus * 0.13) * this.layoutScale;
    // 用阻尼平滑缩放，避免弹跳感
    const s = damp(this.scale.x, targetScale, 0.0008, dt);
    // 三轴统一缩放
    this.scale.set(s, s, s);

    // ------------------------------------------------------------------
    // 5. 光晕与自发光：聚焦时点亮，配合泛光通道发光
    // ------------------------------------------------------------------
    // 光晕透明度随聚焦程度变化
    this.glowMaterial.opacity = this._focus * 0.58;
    // 只有透明度大于极小值时才渲染光晕，省下无谓的绘制
    this.glow.visible = this._focus > 0.01;
    // 光晕始终面向相机（用公告板方式手动对齐）
    if (this.glow.visible && this.parent) {
      // 取相机世界位置
      const cam = this._cameraRef;
      // 相机存在时才做对齐
      if (cam) {
        // 让光晕朝向相机
        this.glow.lookAt(cam.getWorldPosition(this._tmpCamPos));
      }
    }

    // ------------------------------------------------------------------
    // 6. 聚焦时给表面加一点自发光，让牌面“透出光来”
    // ------------------------------------------------------------------
    // 牌面材质是懒创建的（未翻开时不存在），因此这里必须先判空
    if (this.faceMaterial) {
      // 自发光强度随聚焦程度变化
      this.faceMaterial.emissive.setRGB(0.32 * this._focus, 0.24 * this._focus, 0.1 * this._focus);
    }
  }

  /**
   * 设置相机引用，供光晕做公告板对齐。
   * @param {THREE.Camera} camera 相机
   */
  setCameraRef(camera) {
    // 记录相机引用
    this._cameraRef = camera;
    // 复用的临时向量
    this._tmpCamPos = new THREE.Vector3();
  }

  /**
   * 释放本实例独占的资源（贴图与材质由外部统一释放，这里只清理引用）。
   */
  dispose() {
    // 清空补间列表
    this._tweens.length = 0;
    // 释放光晕几何体（每个实例独占）
    this.glow.geometry.dispose();
    // 释放光晕材质
    this.glowMaterial.dispose();
    // 只释放本张牌专属的牌面材质（共享材质由 Deck 统一释放，不能在这里销毁）
    if (this.faceMaterial) this.faceMaterial.dispose();
  }
}
