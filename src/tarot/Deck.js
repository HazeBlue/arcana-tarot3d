// ============================================================================
// tarot/Deck.js —— 牌阵管理器
// ----------------------------------------------------------------------------
// 这是整个应用的核心业务对象，负责：
//   1. 构建完整 78 张牌组成的环形牌阵；
//   2. 维护「聚焦索引」，让被聚焦的牌浮起、放大、发光；
//   3. 处理选牌：卡牌沿贝塞尔弧线飞向「现状 / 转折 / 走向」三个桌面牌位并翻开；
//   4. 在选牌瞬间喷射金色粒子，强化仪式感；
//   5. 重置牌局，重新洗牌发牌。
//
// 布局采用「环形相对角度轮播」，这是无限滑动的关键：
//   每张牌的角度 = wrapDegrees((自身序号 - 聚焦索引) × 步长)
//   而步长被精确设置为 360 / 78 度——也就是说，78 张牌正好铺满一整圈。
//   由此得到两个重要性质：
//     ① 序号与角度一一对应，环形滚动时永远不会有两张牌落在同一个角度上；
//     ② 整副牌首尾天然相接，聚焦索引可以无限增大或减小，
//        折算到 (-180, 180] 后永远有牌可用，因此不存在「滑到头」的状态。
// ============================================================================

// 引入 three.js 核心命名空间
import * as THREE from 'three';
// 引入卡牌实体
import { TarotCard } from './TarotCard.js';
// 引入牌库与洗牌函数
import { createShuffledDeck } from './cardData.js';
// 引入数学工具
import { damp, clamp, wrapDegrees, mod, Easing } from '../core/mathUtils.js';

// ---------------------------------------------------------------------------
// 牌阵布局参数：集中定义便于统一调参
// ---------------------------------------------------------------------------

// 牌阵中展示的卡牌数量：一副完整的塔罗牌共 78 张，这里全部铺进牌阵。
// 牌面贴图是懒生成的（牌背朝上时整副牌只共用一张牌背贴图），
// 因此 78 张牌在启动阶段几乎不产生额外显存开销。
const FAN_COUNT = 78;
// 相邻卡牌之间的角度步长（角度制）。
// 必须是 360 / 78，让 78 张牌恰好铺满一圈——这是「无碰撞」与「无限滑动」的前提。
const FAN_STEP_DEG = 360 / FAN_COUNT;
// 角度步长的弧度值
const FAN_STEP = (FAN_STEP_DEG * Math.PI) / 180;
// 牌阵所在圆的半径。
// 78 张牌铺满一圈后，相邻间距 = 半径 × 步长弧度 ≈ 0.58 个世界单位，
// 相对 1.5 宽的牌约为六成重叠——读起来就是一副"密密扇开"的牌。
// 半径再小会让重叠过重糊成一片，再大则卡牌在画面里过小。
const FAN_RADIUS = 7.2;
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
// 聚焦卡牌向镜头方向推进的距离。
// 因为牌与牌之间重叠较多，这里给得比之前更大，让被聚焦的牌明确"抽出"于牌扇之外。
const FOCUS_LIFT_Z = 0.78;

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

    // 聚焦索引的当前值（浮点数，实现平滑滑动）。
    // 注意：这是一个「环形无限」索引——可以任意增减，不设上下限。
    // 它每变化 FAN_COUNT，整副牌在视觉上正好平移一圈，因此永远滑不到尽头。
    this.focus = 0;
    // 聚焦索引的目标值（整数，同样无上下限）
    this.focusTarget = 0;

    // 复用的临时对象，避免每帧新建导致 GC 抖动
    this._tmpVec = new THREE.Vector3();
    // 临时四元数
    this._tmpQuat = new THREE.Quaternion();
    // 临时欧拉角
    this._tmpEuler = new THREE.Euler();

    // ------------------------------------------------------------------
    // 共享材质：78 张牌如果每张都持有自己的材质，会产生 150 多个
    // MeshPhysicalMaterial 实例，白白吃掉一批 uniform 内存。
    // 牌体、牌背、以及未翻开时的牌面占位，都做成全副共用的单例。
    // （已翻开的牌面贴图各不相同，那部分仍由每张牌按需创建。）
    // ------------------------------------------------------------------

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

    // 共享的牌背材质：所有牌背朝上的牌共用同一份材质
    this.backMaterial = new THREE.MeshPhysicalMaterial({
      // 基础色为白色，只让贴图决定颜色
      color: 0xffffff,
      // 金属度偏低：卡纸是介质而不是金属，金属度太高会让贴图被环境反射冲淡
      metalness: 0.3,
      // 粗糙度中等，保留一点覆膜卡牌的光泽
      roughness: 0.52,
      // 清漆层只留一点点，太强会在聚光灯下糊成一片白
      clearcoat: 0.35,
      // 清漆粗糙度偏高，把高光打散
      clearcoatRoughness: 0.5,
    });

    // 共享的牌面占位材质：牌未翻开时不渲染正面，用一个 1×1 的暗色贴图占位即可
    this.facePlaceholderMaterial = new THREE.MeshPhysicalMaterial({
      // 极暗的底色，即使被瞥见也不突兀
      color: 0x1a1420,
      // 近乎纯介质
      metalness: 0.02,
      // 粗糙度偏高，模拟纸张
      roughness: 0.8,
    });

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
    // 挂到共享牌背材质上。
    // 这一步很容易漏：共享材质是整副牌共用的，牌背贴图必须显式赋给它，
    // 否则所有牌背都会渲染成没有贴图的纯色平面。
    this.backMaterial.map = this.backTexture;
    // 贴图是新建的，需要触发一次材质重新编译
    this.backMaterial.needsUpdate = true;
    // 汇报第一步进度
    if (onProgress) onProgress(0.2);
    // 让出主线程一帧，保证加载动画不卡顿
    await new Promise((r) => requestAnimationFrame(r));

    // 洗牌：整副 78 张全部铺进牌阵，不做任何截取
    const deck = createShuffledDeck();

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
        // 注入共享牌背材质
        backMaterial: this.backMaterial,
        // 注入共享牌面占位材质
        facePlaceholderMaterial: this.facePlaceholderMaterial,
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

    // 初始聚焦在牌阵的中间位置，让构图均衡
    this.focus = Math.floor(FAN_COUNT / 2);
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
    this._layoutCards();
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
   */
  _layoutCards() {
    // 遍历牌阵中的全部卡牌
    for (let i = 0; i < this.cards.length; i++) {
      // 取出卡牌
      const card = this.cards[i];
      // 已经飞走或落位的牌不再参与布局
      if (card.state !== 'fan') continue;

      // 计算相对角度：折算到 (-180, 180] 区间。
      // 这一步是无限滑动的核心——步长乘 78 恰好是 360 度，
      // 所以「牌的序号」与「相对角度」是一一对应的，环形滚动不会出现两张牌撞在一起。
      const relDeg = wrapDegrees((i - this.focus) * FAN_STEP_DEG);
      // 转为弧度
      const rel = (relDeg * Math.PI) / 180;
      // 取绝对值用于渐隐判定
      const absDeg = Math.abs(relDeg);

      // ---- 渐隐系数：1 表示完全清晰，0 表示完全隐去 ----
      const fadeK = 1 - clamp((absDeg - FAN_FADE_IN_DEG) / (FAN_FADE_OUT_DEG - FAN_FADE_IN_DEG), 0, 1);
      // 用三次曲线让渐隐更柔和
      const softFade = Easing.easeInOutCubic(fadeK);

      // ---- 聚焦程度：以聚焦位置为中心的高斯核 ----
      // 核宽取步长的 0.85 倍：因为步长很小（约 4.6 度），
      // 这样会让聚焦点左右各约四五张牌都受到一点抬升，形成一道平滑流动的"波峰"。
      const kernel = Math.exp(-Math.pow(rel / (FAN_STEP * 0.85), 2));
      // 乘以渐隐系数，边缘的牌不会被点亮
      card.focusTarget = kernel * softFade;

      // ---- 目标位置：以 (0, FAN_BASE_Y, FAN_CENTER_Z) 为圆心、FAN_RADIUS 为半径的圆弧 ----
      this._tmpVec.set(
        // x 分量由角度决定
        Math.sin(rel) * FAN_RADIUS,
        // y 分量在基础高度上叠加聚焦抬升
        FAN_BASE_Y + kernel * FOCUS_LIFT_Y,
        // z 分量：圆弧纵深 + 聚焦前推 + 边缘后退
        FAN_CENTER_Z - Math.cos(rel) * FAN_RADIUS + kernel * FOCUS_LIFT_Z + (1 - softFade) * 1.5
      );
      // 写入目标位姿。
      // 注意：不可见的牌也照常计算，这样它们重新滑入视野时已经在正确位置上，
      // 不会出现"从原点飞过来"的穿帮。
      card.setLayoutTarget(this._tmpVec, this._computeQuaternion(rel));

      // ---- 边缘缩放：让渐隐的牌同时缩小，视觉上自然退场 ----
      card.layoutScale = 0.55 + softFade * 0.45;

      // ---- 可见性：放在最后统一决定，避免因为提前 continue 而漏算位置 ----
      card.visible = absDeg < FAN_FADE_OUT_DEG;
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
    // ------------------------------------------------------------------
    // 聚焦索引归一化。
    // 78 张牌正好铺满一圈，因此把索引整体平移 78 在视觉上完全等价。
    // 定期做一次归一化，可以让浮点数长期停留在小区间内，
    // 避免用户长时间连续滑动后出现精度下降、卡牌抖动。
    // ------------------------------------------------------------------
    if (this.focusTarget >= FAN_COUNT || this.focusTarget < 0) {
      // 计算需要平移的整数圈
      const shift = Math.floor(this.focusTarget / FAN_COUNT) * FAN_COUNT;
      // 目标索引平移
      this.focusTarget -= shift;
      // 当前阻尼值同步平移，保证插值过程不被打断
      this.focus -= shift;
    }

    // 聚焦索引平滑滑向目标值，制造轮盘滑动的过程
    this.focus = damp(this.focus, this.focusTarget, 0.000012, dt);
    // 依据最新的聚焦索引重算布局
    this._layoutCards();
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
   * 索引是环形的、无上下限的，因此无论朝哪个方向都能一直滑下去，
   * 永远不会出现「滑到头」而停住的情况。
   * @param {number} steps 步数，正数向后移动，负数向前
   */
  browse(steps) {
    // 直接把步数累加到目标索引上（不做任何夹紧）
    const raw = this.focusTarget + steps;
    // 跳过已经被选走的牌位，落到下一个仍然在场的牌上
    this.focusTarget = this._nextFree(raw, Math.sign(steps) || 1);
  }

  /**
   * 从指定逻辑索引出发，跳过已经被选走的卡牌，找到下一个仍然在场的索引。
   * 逻辑索引可以任意正负，因此这里用恒正取模把它折算回 0~77 的物理牌上。
   * @param {number} index 起始逻辑索引
   * @param {number} dir 搜索方向（1 或 -1）
   * @returns {number} 可用的逻辑索引
   */
  _nextFree(index, dir) {
    // 最多探查一整圈，保证不会死循环
    for (let guard = 0; guard < FAN_COUNT; guard++) {
      // 折算成物理下标
      const physical = mod(index, FAN_COUNT);
      // 取出该位置的卡牌
      const card = this.cards[physical];
      // 仍在牌阵中即视为可用
      if (card && card.state === 'fan') return index;
      // 否则沿指定方向继续寻找
      index += dir;
    }
    // 理论上不会走到这里（78 张牌不可能被选空），兜底返回原索引
    return index;
  }

  /**
   * 确认当前聚焦的卡牌，把它送入下一个空牌位。
   * @returns {object|null} 被选中的卡牌信息，或 null（无法选中时）
   */
  confirm() {
    // 已经选满三张则不再接受
    if (this.selected.length >= 3) return null;
    // 取当前聚焦的卡牌：把无上下限的逻辑索引折算成物理下标
    const card = this.cards[mod(Math.round(this.focusTarget), FAN_COUNT)];
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
    // 释放牌背共享材质
    this.backMaterial.dispose();
    // 释放牌面占位共享材质
    this.facePlaceholderMaterial.dispose();
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
