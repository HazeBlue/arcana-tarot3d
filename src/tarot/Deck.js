// ============================================================================
// tarot/Deck.js —— 牌阵管理器
// ----------------------------------------------------------------------------
// 这是整个应用的核心业务对象，负责：
//   1. 构建 32 张牌组成的弧形牌阵（真实塔罗洗牌后取一部分铺开）；
//   2. 维护「聚焦索引」，让被聚焦的牌浮起、放大、发光；
//   3. 处理选牌：卡牌沿贝塞尔弧线飞向「现状 / 转折 / 走向」三个桌面牌位并翻开；
//   4. 在选牌瞬间喷射金色粒子，强化仪式感；
//   5. 重置牌局，重新洗牌发牌。
// 布局采用「相对角度轮播」：每张牌的角度是 (自身序号 - 聚焦索引) × 步长，
// 因此移动聚焦时整副牌会像轮盘一样平滑滑动，天然支持环形无限滚动。
// ============================================================================

// 引入 three.js 核心命名空间
import * as THREE from 'three';
// 引入卡牌实体
import { TarotCard } from './TarotCard.js';
// 引入牌库与洗牌函数
import { createShuffledDeck } from './cardData.js';
// 引入数学工具
import { damp, clamp, wrapDegrees, Easing } from '../core/mathUtils.js';

// ---------------------------------------------------------------------------
// 牌阵布局参数：集中定义便于统一调参
// ---------------------------------------------------------------------------

// 牌阵中展示的卡牌数量。
// 取值需要与步长配合：数量 × 步长决定整副牌的展开角度，
// 而步长 × 半径决定相邻牌的实际间距——间距太小会让 32 张牌互相压盖 65%，
// 牌背上的曼陀罗纹样会被压成碎片，整体看起来像一堵金色板墙。
const FAN_COUNT = 23;
// 相邻卡牌之间的角度步长（角度制）。
// 12 度 × 5.6 的半径 ≈ 1.17 个世界单位间距，对 1.5 宽的牌来说只有约两成重叠——
// 每一张牌的曼陀罗纹样都能完整露出来，整体读起来是"扇形铺开的一副牌"
// 而不是一堵互相压盖的板墙。
const FAN_STEP_DEG = 12;
// 角度步长的弧度值
const FAN_STEP = (FAN_STEP_DEG * Math.PI) / 180;
// 牌阵所在圆的半径：越大牌阵越平缓，同时卡牌在画面中越小
const FAN_RADIUS = 5.6;
// 牌阵圆心的 Z 坐标（圆心往后推，牌阵就整体靠后）
const FAN_CENTER_Z = 1.15;
// 牌阵卡牌的基础高度
const FAN_BASE_Y = 1.52;
// 完全清晰的角度上限（角度制）：小于该角度时卡牌完全可见
const FAN_FADE_IN_DEG = 36;
// 完全隐去的角度下限（角度制）：大于该角度时卡牌彻底隐藏
const FAN_FADE_OUT_DEG = 47;
// 聚焦卡牌的抬升高度
const FOCUS_LIFT_Y = 0.42;
// 聚焦卡牌向镜头方向推进的距离
const FOCUS_LIFT_Z = 0.62;

// 三个桌面牌位的横向间距（横屏基准值）。
// 竖屏时画面水平空间极窄，需要在 setViewportAspect 里收窄，否则两侧牌位会被裁掉。
const SLOT_SPREAD_LANDSCAPE = 1.92;
// 竖屏下的牌位间距
const SLOT_SPREAD_PORTRAIT = 1.05;
// 牌位的垂直高度：取「半张牌在竖直方向的投影高度」，让牌底刚好贴在桌面上
const SLOT_Y = 1.08;
// 牌位的纵深位置
const SLOT_Z = 1.5;
// 牌位的后仰角度（弧度）：让牌面略微朝向镜头
const SLOT_TILT_X = -0.68;
// 牌位的水平朝向（弧度）：外侧两张向内收，形成聚焦感
const SLOT_YAW = [0.24, 0, -0.24];
// 三个牌位的名称
const SLOT_LABELS = ['现状', '转折', '走向'];
// 牌位名称文字悬浮在牌面上方的高度
const SLOT_LABEL_Y = 2.52;
// 牌面缓存的上限：只保留最近生成的若干张牌面贴图，避免反复占卜导致显存膨胀
const FACE_CACHE_LIMIT = 12;

// 粒子系统的粒子总数
const SPARK_COUNT = 240;
// 每次选牌激活的粒子数
const SPARK_PER_BURST = 46;
// 粒子寿命（秒）
const SPARK_LIFE = 1.5;

/**
 * Deck —— 牌阵管理器
 */
export class Deck {
  /**
   * 构造函数。
   * @param {object} deps 依赖注入
   * @param {THREE.Scene} deps.scene 场景
   * @param {THREE.Camera} deps.camera 相机
   * @param {import('./CardTextures.js').TextureFactory} deps.textures 贴图工厂
   */
  constructor({ scene, camera, textures }) {
    // 保存场景引用
    this.scene = scene;
    // 保存相机引用
    this.camera = camera;
    // 保存贴图工厂引用
    this.textures = textures;

    // 牌阵根节点：所有仍在牌阵中的卡牌都挂在这里
    this.fanGroup = new THREE.Group();
    // 挂到场景
    this.scene.add(this.fanGroup);

    // 牌位根节点：牌位标签挂在这里
    this.slotGroup = new THREE.Group();
    // 挂到场景
    this.scene.add(this.slotGroup);

    // 保存全部卡牌实例（32 张）
    this.cards = [];
    // 保存已选中的卡牌（最多 3 张）
    this.selected = [];

    // 聚焦索引的当前值（浮点数，实现平滑滑动）
    this.focus = 0;
    // 聚焦索引的目标值（整数）
    this.focusTarget = 0;
    // 聚焦可移动的范围（留出边距，保证视野内始终有牌）
    this.focusMin = Math.ceil(FAN_FADE_OUT_DEG / FAN_STEP_DEG);
    // 聚焦上限
    this.focusMax = FAN_COUNT - 1 - this.focusMin;

    // 复用的临时对象，避免每帧新建导致 GC 抖动
    this._tmpVec = new THREE.Vector3();
    // 临时四元数
    this._tmpQuat = new THREE.Quaternion();
    // 临时欧拉角
    this._tmpEuler = new THREE.Euler();

    // 共享的牌体材质：78 张牌的金色金属边完全一致
    this.bodyMaterial = new THREE.MeshPhysicalMaterial({
      // 香槟金
      color: 0xd8b877,
      // 高金属度，形成真正的镜面反射
      metalness: 0.96,
      // 较低粗糙度，让牌边有锐利的高光
      roughness: 0.22,
      // 清漆层强化金箔光泽
      clearcoat: 1,
      // 清漆粗糙度
      clearcoatRoughness: 0.16,
      // 侧面自发光微弱金色，避免暗部完全死黑
      emissive: 0x2a1d08,
      // 自发光强度
      emissiveIntensity: 1,
    });

    // 牌背贴图（全副共用）
    this.backTexture = null;

    // 三个牌位当前的横向位置（会随视口比例变化）
    this.slotX = [-SLOT_SPREAD_LANDSCAPE, 0, SLOT_SPREAD_LANDSCAPE];

    // 三个牌位的文字标签精灵
    this.slotLabels = [];
    // 三个牌位下方的地面光池
    this.slotPools = [];

    // 粒子系统引用
    this.sparks = null;
  }

  /**
   * 构建牌阵（异步，便于分批让出主线程并汇报进度）。
   * @param {Function} [onProgress] 进度回调，接收 0~1
   */
  async build(onProgress) {
    // 生成牌背贴图
    this.backTexture = this.textures.createCardBack();
    // 汇报第一步进度
    if (onProgress) onProgress(0.2);
    // 让出主线程一帧，保证加载动画不卡顿
    await new Promise((r) => requestAnimationFrame(r));

    // 洗牌并取前 32 张作为牌阵
    const deck = createShuffledDeck().slice(0, FAN_COUNT);

    // 逐张创建卡牌实例
    for (let i = 0; i < deck.length; i++) {
      // 创建卡牌
      const card = new TarotCard(deck[i], {
        // 注入贴图工厂
        textures: this.textures,
        // 注入共享牌背贴图
        backTexture: this.backTexture,
        // 注入共享牌体材质
        bodyMaterial: this.bodyMaterial,
      });
      // 注入相机引用，供光晕做公告板对齐
      card.setCameraRef(this.camera);
      // 记录其在牌阵中的序号
      card.fanIndex = i;
      // 把卡牌挂到牌阵根节点
      this.fanGroup.add(card);
      // 加入数组
      this.cards.push(card);
      // 每 8 张让出一次主线程，避免长时间阻塞
      if (i % 8 === 7) {
        // 汇报进度
        if (onProgress) onProgress(0.2 + (i / deck.length) * 0.55);
        // 让出主线程
        await new Promise((r) => requestAnimationFrame(r));
      }
    }

    // 初始聚焦在中间偏后的位置，让构图均衡
    this.focus = Math.round((this.focusMin + this.focusMax) / 2);
    // 目标与当前保持一致
    this.focusTarget = this.focus;

    // 构建桌面牌位（标签 + 地面光池）
    this._buildSlots();
    // 汇报完成
    if (onProgress) onProgress(0.78);

    // 构建粒子系统（只在首次构建时创建，重置牌局时复用）
    if (!this.sparks) this._buildSparks();
    // 汇报完成
    if (onProgress) onProgress(0.86);

    // 首帧先把所有卡牌摆到正确位置，避免出现从原点散开的现象
    this._layoutCards(0);
    // 直接同步一次位姿（跳过阻尼过程）
    this.cards.forEach((card) => {
      // 位置直接对齐
      card.position.copy(card._targetPosition);
      // 朝向直接对齐
      card.quaternion.copy(card._targetQuaternion);
    });
    // 汇报完成
    if (onProgress) onProgress(0.9);
  }

  /**
   * 构建三个桌面牌位：文字标签与地面光池。
   * 注意：重置牌局时本方法会被再次调用，因此必须先清理上一轮创建的节点，
   * 否则标签与光池会在场景中不断累积。
   */
  _buildSlots() {
    // 先释放上一轮的标签
    this.slotLabels.forEach((label) => {
      // 从父节点移除
      this.slotGroup.remove(label);
      // 释放材质
      label.material.dispose();
    });
    // 清空数组
    this.slotLabels.length = 0;
    // 再释放上一轮的光池
    this.slotPools.forEach((pool) => {
      // 从父节点移除
      this.slotGroup.remove(pool);
      // 释放几何体
      pool.geometry.dispose();
      // 释放材质
      pool.material.dispose();
    });
    // 清空数组
    this.slotPools.length = 0;

    // 逐个牌位创建
    for (let i = 0; i < 3; i++) {
      // 生成文字纹理
      const labelTex = this.textures.createLabelTexture(SLOT_LABELS[i], {
        // 字号
        fontSize: 58,
        // 字距
        letterSpacing: 16,
      });
      // 用纹理创建精灵材质
      const labelMat = new THREE.SpriteMaterial({
        // 贴图
        map: labelTex,
        // 透明
        transparent: true,
        // 关闭深度写入，避免遮挡卡牌
        depthWrite: false,
        // 初始透明度偏低，等牌位被占用后再提亮
        opacity: 0.42,
      });
      // 创建精灵
      const label = new THREE.Sprite(labelMat);
      // 设置缩放，保持文字的宽高比
      label.scale.set(0.56 * (labelTex.image.width / labelTex.image.height), 0.56, 1);
      // 悬浮在牌位正上方：既不会遮挡牌面，也不会与后方牌阵重叠
      label.position.set(this.slotX[i], SLOT_LABEL_Y, SLOT_Z - 0.55);
      // 挂到牌位根节点
      this.slotGroup.add(label);

      // 记录到实例上便于后续提亮
      this.slotLabels.push(label);

      // 地面光池：用加色混合的平面在牌位下方投出一团柔光
      const poolMat = new THREE.MeshBasicMaterial({
        // 径向渐变光晕
        map: this.textures.createRadialSprite('rgba(227, 195, 122, 0.5)', 'rgba(227, 195, 122, 0)'),
        // 加色混合
        blending: THREE.AdditiveBlending,
        // 透明
        transparent: true,
        // 关闭深度写入
        depthWrite: false,
        // 初始透明度很低
        opacity: 0.12,
      });
      // 创建平面
      const pool = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 3.2), poolMat);
      // 平躺在地面上（绕 X 轴转 -90 度）
      pool.rotation.x = -Math.PI / 2;
      // 放到牌位正下方
      pool.position.set(this.slotX[i], 0.012, SLOT_Z);
      // 挂到牌位根节点
      this.slotGroup.add(pool);
      // 记录引用
      this.slotPools.push(pool);
    }
  }

  /**
   * 构建选牌粒子系统。
   * 实现要点：用加色混合 + 顶点色实现淡出，无需自定义 Shader。
   */
  _buildSparks() {
    // 位置数组
    const positions = new Float32Array(SPARK_COUNT * 3);
    // 颜色数组（加色混合下，颜色趋近黑色即为淡出）
    const colors = new Float32Array(SPARK_COUNT * 3);
    // 粒子速度（不进入 GPU，仅 CPU 使用）
    const velocities = new Float32Array(SPARK_COUNT * 3);
    // 剩余寿命
    const lives = new Float32Array(SPARK_COUNT);
    // 初始全部粒子都处于「已死亡」状态，放到远处避免误入视野
    for (let i = 0; i < SPARK_COUNT; i++) {
      // 位置放到极远处
      positions[i * 3 + 1] = -9999;
    }
    // 创建缓冲几何体
    const geo = new THREE.BufferGeometry();
    // 写入位置属性
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    // 写入颜色属性
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    // 创建点材质
    const mat = new THREE.PointsMaterial({
      // 星点贴图
      map: this.textures.createStarSprite(),
      // 基准尺寸（世界单位）
      size: 0.085,
      // 开启近大远小
      sizeAttenuation: true,
      // 使用顶点色
      vertexColors: true,
      // 加色混合
      blending: THREE.AdditiveBlending,
      // 透明
      transparent: true,
      // 关闭深度写入，粒子之间不会互相遮挡
      depthWrite: false,
    });
    // 创建点云
    const points = new THREE.Points(geo, mat);
    // 关闭视锥剔除，因为粒子位置每帧都在变
    points.frustumCulled = false;
    // 挂到场景
    this.scene.add(points);
    // 记录到实例
    this.sparks = {
      // 点云对象
      points,
      // 几何体
      geometry: geo,
      // 材质
      material: mat,
      // 位置数组引用
      positions,
      // 颜色数组引用
      colors,
      // 速度数组引用
      velocities,
      // 寿命数组引用
      lives,
      // 下一个待复用的粒子下标（环形分配）
      cursor: 0,
    };
  }

  /**
   * 在指定位置喷发一束金色粒子。
   * @param {THREE.Vector3} origin 喷发点（世界坐标）
   */
  spawnBurst(origin) {
    // 未初始化则跳过
    if (!this.sparks) return;
    // 取出引用
    const s = this.sparks;
    // 逐个激活粒子
    for (let k = 0; k < SPARK_PER_BURST; k++) {
      // 环形取下标，天然复用最老的粒子
      const i = s.cursor % SPARK_COUNT;
      // 游标前进
      s.cursor++;
      // 球面随机方向
      const theta = Math.random() * Math.PI * 2;
      // 仰角：偏向上方，让粒子呈喷泉状
      const phi = Math.acos(1 - Math.random() * 1.35);
      // 初速度大小
      const speed = 0.9 + Math.random() * 2.1;
      // 方向向量分量
      const vx = Math.sin(phi) * Math.cos(theta) * speed;
      // 方向向量分量
      const vy = Math.cos(phi) * speed * 0.95 + 0.9;
      // 方向向量分量
      const vz = Math.sin(phi) * Math.sin(theta) * speed;
      // 写入速度
      s.velocities[i * 3] = vx;
      // 写入速度
      s.velocities[i * 3 + 1] = vy;
      // 写入速度
      s.velocities[i * 3 + 2] = vz;
      // 写入初始位置（加一点随机抖动，避免所有粒子从同一点出发）
      s.positions[i * 3] = origin.x + (Math.random() - 0.5) * 0.32;
      // 写入初始位置
      s.positions[i * 3 + 1] = origin.y + (Math.random() - 0.5) * 0.42;
      // 写入初始位置
      s.positions[i * 3 + 2] = origin.z + (Math.random() - 0.5) * 0.32;
      // 寿命加一点随机，让消散有先后
      s.lives[i] = SPARK_LIFE * (0.7 + Math.random() * 0.6);
      // 初始颜色：接近白色的暖金
      s.colors[i * 3] = 1;
      // 绿色分量略低，形成金色的偏暖感
      s.colors[i * 3 + 1] = 0.88;
      // 蓝色分量最低
      s.colors[i * 3 + 2] = 0.6;
    }
    // 标记属性需要重新上传
    s.geometry.attributes.position.needsUpdate = true;
    // 颜色属性同样需要上传
    s.geometry.attributes.color.needsUpdate = true;
  }

  /**
   * 每帧更新粒子系统。
   * @param {number} dt 帧间隔（秒）
   */
  _updateSparks(dt) {
    // 未初始化则跳过
    if (!this.sparks) return;
    // 取出引用
    const s = this.sparks;
    // 是否真的有粒子在活动，用来决定是否需要上传缓冲
    let active = false;
    // 遍历全部粒子
    for (let i = 0; i < SPARK_COUNT; i++) {
      // 寿命已尽则跳过
      if (s.lives[i] <= 0) continue;
      // 标记有活动粒子
      active = true;
      // 扣减寿命
      s.lives[i] -= dt;
      // 计算寿命归一化值
      const lifeRatio = clamp(s.lives[i] / SPARK_LIFE, 0, 1);
      // 重力与阻尼：让粒子先上升后回落
      s.velocities[i * 3 + 1] -= 2.6 * dt;
      // 水平方向施加空气阻力
      s.velocities[i * 3] *= 1 - 1.9 * dt;
      // 垂直方向也施加轻微阻力
      s.velocities[i * 3 + 1] *= 1 - 0.7 * dt;
      // 纵深方向施加阻力
      s.velocities[i * 3 + 2] *= 1 - 1.9 * dt;
      // 更新位置
      s.positions[i * 3] += s.velocities[i * 3] * dt;
      // 更新位置
      s.positions[i * 3 + 1] += s.velocities[i * 3 + 1] * dt;
      // 更新位置
      s.positions[i * 3 + 2] += s.velocities[i * 3 + 2] * dt;
      // 颜色随寿命衰减：加色混合下这等同于淡出
      const fade = lifeRatio * lifeRatio;
      // 红色分量
      s.colors[i * 3] = fade;
      // 绿色分量
      s.colors[i * 3 + 1] = fade * 0.86;
      // 蓝色分量
      s.colors[i * 3 + 2] = fade * 0.55;
      // 寿命耗尽则把粒子移到远处
      if (s.lives[i] <= 0) {
        // 移到视野之外
        s.positions[i * 3 + 1] = -9999;
        // 颜色归零
        s.colors[i * 3] = 0;
        // 颜色归零
        s.colors[i * 3 + 1] = 0;
        // 颜色归零
        s.colors[i * 3 + 2] = 0;
      }
    }
    // 有活动粒子时才上传缓冲，省下无谓的带宽
    if (active) {
      // 位置属性更新
      s.geometry.attributes.position.needsUpdate = true;
      // 颜色属性更新
      s.geometry.attributes.color.needsUpdate = true;
    }
  }

  /**
   * 依据当前的聚焦索引，计算并写入所有卡牌的目标位姿。
   * @param {number} dt 帧间隔（秒），传给聚焦程度的阻尼计算
   */
  _layoutCards(dt) {
    // 遍历牌阵中的全部卡牌
    for (let i = 0; i < this.cards.length; i++) {
      // 取出卡牌
      const card = this.cards[i];
      // 已经飞走或落位的牌不再参与布局
      if (card.state !== 'fan') continue;
      // 计算相对角度（角度制），并取最短路径
      const relDeg = wrapDegrees((i - this.focus) * FAN_STEP_DEG);
      // 转为弧度
      const rel = (relDeg * Math.PI) / 180;
      // 取绝对值用于可见性判定
      const absDeg = Math.abs(relDeg);

      // ---- 可见性与渐隐系数 ----
      // 超出完全隐去角度的牌直接隐藏
      if (absDeg >= FAN_FADE_OUT_DEG) {
        // 隐藏
        card.visible = false;
        // 聚焦程度归零
        card.focusTarget = 0;
        // 跳过后续计算
        continue;
      }
      // 显示卡牌
      card.visible = true;
      // 计算渐隐系数：1 表示完全清晰，0 表示完全隐去
      const fadeK = 1 - clamp((absDeg - FAN_FADE_IN_DEG) / (FAN_FADE_OUT_DEG - FAN_FADE_IN_DEG), 0, 1);
      // 用三次曲线让渐隐更柔和
      const softFade = Easing.easeInOutCubic(fadeK);

      // ---- 聚焦程度：以聚焦位置为中心的高斯核 ----
      // 核宽取步长的 0.78 倍，保证只有当前牌和半途中的邻牌被点亮
      const kernel = Math.exp(-Math.pow(rel / (FAN_STEP * 0.78), 2));
      // 乘以渐隐系数，边缘的牌不会被点亮
      card.focusTarget = kernel * softFade;

      // ---- 计算目标位置 ----
      // 目标位置：以 (0, FAN_BASE_Y, FAN_CENTER_Z) 为圆心，半径 FAN_RADIUS 的圆弧
      this._tmpVec.set(
        // x 分量由角度决定
        Math.sin(rel) * FAN_RADIUS,
        // y 分量在基础高度上叠加聚焦抬升
        FAN_BASE_Y + kernel * FOCUS_LIFT_Y,
        // z 分量由角度决定，并叠加聚焦前推与边缘后退
        FAN_CENTER_Z - Math.cos(rel) * FAN_RADIUS + kernel * FOCUS_LIFT_Z + (1 - softFade) * 1.5
      );
      // 写入目标位置
      card.setLayoutTarget(this._tmpVec, this._computeQuaternion(rel, card));

      // ---- 边缘缩放：让渐隐的牌同时缩小，视觉上自然“退场” ----
      card.layoutScale = 0.55 + softFade * 0.45;
    }
  }

  /**
   * 计算卡牌在圆弧上的目标朝向。
   * @param {number} rel 相对角度（弧度）
   * @returns {THREE.Quaternion} 目标四元数
   */
  _computeQuaternion(rel) {
    // 绕 Y 轴旋转 -rel，让卡牌始终朝向圆弧内侧（也就是镜头方向）
    this._tmpEuler.set(0, -rel, 0);
    // 从欧拉角生成四元数
    this._tmpQuat.setFromEuler(this._tmpEuler);
    // 返回
    return this._tmpQuat;
  }

  /**
   * 依据视口宽高比调整三个牌位的横向间距。
   * 竖屏时画面水平空间很窄，必须收窄牌位，否则左右两张牌会被屏幕边缘裁掉。
   * @param {number} aspect 视口宽高比
   */
  setViewportAspect(aspect) {
    // 竖屏用窄间距，横屏用宽间距
    const spread = aspect < 0.95 ? SLOT_SPREAD_PORTRAIT : SLOT_SPREAD_LANDSCAPE;
    // 写入三个位置
    this.slotX = [-spread, 0, spread];
    // 同步标签位置
    this.slotLabels.forEach((label, i) => {
      // 逐个更新横坐标
      label.position.x = this.slotX[i];
    });
    // 同步地面光池位置
    this.slotPools.forEach((pool, i) => {
      // 逐个更新横坐标
      pool.position.x = this.slotX[i];
    });
    // 已经落位的牌也要跟着挪到新位置，避免旋转屏幕后错位
    this.selected.forEach((card, i) => {
      // 计算新的目标位置
      const pos = new THREE.Vector3(this.slotX[i], SLOT_Y, SLOT_Z);
      // 写入目标位姿（保留原朝向）
      card.setLayoutTarget(pos, card._targetQuaternion);
    });
  }

  /**
   * 每帧更新。
   * @param {number} dt 帧间隔（秒）
   * @param {number} elapsed 累计运行时间（秒）
   */
  update(dt, elapsed) {
    // 聚焦索引平滑滑向目标值，制造轮盘滑动的过程
    this.focus = damp(this.focus, this.focusTarget, 0.000012, dt);
    // 依据最新的聚焦索引重算布局
    this._layoutCards(dt);
    // 逐张更新卡牌自身（补间、阻尼、漂浮、光晕）
    for (let i = 0; i < this.cards.length; i++) {
      // 更新卡牌
      this.cards[i].update(dt, elapsed);
    }
    // 更新粒子
    this._updateSparks(dt);
    // 更新牌位光池的呼吸效果
    this._updateSlotPools(elapsed, dt);
  }

  /**
   * 让牌位下方的光池缓慢呼吸，同时被占用后提亮。
   * @param {number} elapsed 累计运行时间（秒）
   * @param {number} dt 帧间隔（秒）
   */
  _updateSlotPools(elapsed, dt) {
    // 遍历三个光池
    for (let i = 0; i < this.slotPools.length; i++) {
      // 取出光池
      const pool = this.slotPools[i];
      // 是否已被占用
      const occupied = this.selected.length > i;
      // 基础透明度：未占用低亮，已占用高亮
      const base = occupied ? 0.42 : 0.13;
      // 叠加呼吸波动
      const breath = Math.sin(elapsed * 1.25 + i * 1.7) * 0.05;
      // 平滑写入透明度
      pool.material.opacity = damp(pool.material.opacity, base + breath, 0.02, dt);
      // 同步标签亮度
      if (this.slotLabels[i]) {
        // 目标透明度
        const targetLabel = occupied ? 1 : 0.42;
        // 阻尼过渡
        this.slotLabels[i].material.opacity = damp(
          this.slotLabels[i].material.opacity,
          targetLabel,
          0.02,
          dt
        );
      }
    }
  }

  /**
   * 浏览牌阵：把聚焦索引移动指定的步数。
   * @param {number} steps 步数，正数向后移动，负数向前
   */
  browse(steps) {
    // 计算新的目标索引
    let next = this.focusTarget + steps;
    // 跳过已经被选走的牌
    next = this._skipTaken(next, Math.sign(steps) || 1);
    // 夹紧到合法范围
    this.focusTarget = clamp(next, this.focusMin, this.focusMax);
  }

  /**
   * 从指定索引出发，跳过已选中的卡牌，找到下一个可用的索引。
   * @param {number} index 起始索引
   * @param {number} dir 搜索方向（1 或 -1）
   * @returns {number} 可用的索引（若找不到则返回原索引）
   */
  _skipTaken(index, dir) {
    // 先夹紧
    let idx = clamp(index, this.focusMin, this.focusMax);
    // 最多尝试一整圈
    for (let guard = 0; guard <= this.focusMax - this.focusMin + 1; guard++) {
      // 取出该位置的卡牌
      const card = this.cards[idx];
      // 该牌仍在牌阵中，可用
      if (card && card.state === 'fan') return idx;
      // 否则向后搜索
      idx += dir;
      // 越界则回卷
      if (idx > this.focusMax) idx = this.focusMin;
      // 越界则回卷
      if (idx < this.focusMin) idx = this.focusMax;
    }
    // 全部被占用时返回夹紧后的索引
    return clamp(index, this.focusMin, this.focusMax);
  }

  /**
   * 确认当前聚焦的卡牌，把它送入下一个空牌位。
   * @returns {object|null} 被选中的卡牌信息，或 null（无法选中时）
   */
  confirm() {
    // 已经选满三张则不再接受
    if (this.selected.length >= 3) return null;
    // 取当前聚焦的卡牌
    const card = this.cards[Math.round(this.focusTarget)];
    // 卡牌不存在或已离场则失败
    if (!card || card.state !== 'fan') return null;

    // 分配牌位序号
    const slot = this.selected.length;
    // 写入卡牌的牌位序号
    card.slotIndex = slot;
    // 取消聚焦
    card.focusTarget = 0;
    // 恢复满尺寸（牌在牌阵边缘时 layoutScale 会小于 1，落位后必须还原）
    card.layoutScale = 1;
    // 随机决定正逆位：约 34% 概率出现逆位
    card.isReversed = Math.random() < 0.34;
    // 预先准备好牌面贴图，避免翻转时出现占位色
    card.ensureFaceTexture();

    // 计算牌位的世界位置（卡牌几何体已居中，所以中心高度直接取牌位高度）
    const targetPos = new THREE.Vector3(this.slotX[slot], SLOT_Y, SLOT_Z);
    // 计算牌位的世界朝向
    this._tmpEuler.set(SLOT_TILT_X, SLOT_YAW[slot], 0);
    // 生成目标四元数
    const targetQuat = new THREE.Quaternion().setFromEuler(this._tmpEuler);

    // 把卡牌从牌阵根节点转移到场景根节点，保留当前世界变换
    this.scene.attach(card);
    // 记录落位基准位姿，落位后仍需要它做呼吸浮动
    card.setLayoutTarget(targetPos, targetQuat);

    // 在卡牌当前位置喷发粒子
    this.spawnBurst(card.getWorldPosition(new THREE.Vector3()));

    // 播放飞行动画
    card.flyTo(targetPos, targetQuat, 0.98, 1.75, () => {
      // 飞行结束后再翻开，仪式感更强
      card.flipTo(true, card.isReversed, 0.62);
      // 翻开瞬间再喷一次粒子，强化反馈
      this.spawnBurst(targetPos.clone().setY(targetPos.y - 0.3));
    });

    // 记录到已选列表
    this.selected.push(card);
    // 自动把聚焦移到下一张可用的牌上
    this.browse(1);
    // 返回结果
    return { card, slot };
  }

  /**
   * 获取已选中的卡牌数据数组（供解读引擎使用）。
   * @returns {object[]} 每项包含 data / isReversed / slot
   */
  getSelection() {
    // 把卡牌实例映射成数据对象
    return this.selected.map((card, index) => ({
      // 卡牌原始数据
      data: card.data,
      // 是否逆位
      isReversed: card.isReversed,
      // 牌位序号
      slot: index,
    }));
  }

  /**
   * 重置牌局：清空已选、重新洗牌发牌。
   * @param {Function} [onProgress] 进度回调
   */
  async reset(onProgress) {
    // 清空已选列表
    this.selected.length = 0;
    // 重置牌位标签与光池的亮度
    if (this.slotLabels) {
      // 逐个重置
      this.slotLabels.forEach((l) => {
        // 恢复低亮
        l.material.opacity = 0.42;
      });
    }
    // 重置光池
    if (this.slotPools) {
      // 逐个重置
      this.slotPools.forEach((p) => {
        // 恢复低亮
        p.material.opacity = 0.12;
      });
    }
    // 销毁旧的卡牌实例，释放独占资源
    this.cards.forEach((card) => {
      // 从父节点移除
      card.parent?.remove(card);
      // 释放独占资源
      card.dispose();
    });
    // 清空数组
    this.cards.length = 0;
    // 清理贴图工厂中过期的牌面缓存，避免长时间使用后显存膨胀
    this.textures.pruneFaceCache(FACE_CACHE_LIMIT);
    // 重新构建牌阵
    await this.build(onProgress);
  }

  /**
   * 释放全部资源。
   */
  dispose() {
    // 释放卡牌
    this.cards.forEach((card) => {
      // 从父节点移除
      card.parent?.remove(card);
      // 释放资源
      card.dispose();
    });
    // 清空数组
    this.cards.length = 0;
    // 释放牌体共享材质
    this.bodyMaterial.dispose();
    // 释放粒子几何体
    if (this.sparks) {
      // 释放几何体
      this.sparks.geometry.dispose();
      // 释放材质
      this.sparks.material.dispose();
      // 从场景移除
      this.scene.remove(this.sparks.points);
    }
    // 释放牌位相关资源
    if (this.slotPools) {
      // 逐个释放
      this.slotPools.forEach((p) => {
        // 释放几何体
        p.geometry.dispose();
        // 释放材质
        p.material.dispose();
      });
    }
    // 释放标签材质
    if (this.slotLabels) {
      // 逐个释放
      this.slotLabels.forEach((l) => {
        // 释放材质
        l.material.dispose();
      });
    }
    // 从场景移除根节点
    this.scene.remove(this.fanGroup);
    // 从场景移除牌位根节点
    this.scene.remove(this.slotGroup);
  }
}
