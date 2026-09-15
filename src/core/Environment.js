// ============================================================================
// core/Environment.js —— 场景环境
// ----------------------------------------------------------------------------
// 负责搭建「舞台」本身：星空、星云、黑曜石桌面与整套灯光。
// 所有内容均为程序化生成，没有任何外部模型或贴图依赖。
// 灯光设计遵循三条原则：
//   1. 主光从上前方来，让金色牌面产生清晰的高光走向；
//   2. 两侧补一盏冷紫、一盏暖金轮廓光，把卡牌从深色背景中“切”出来；
//   3. 顶部聚光灯打在桌面中心，形成一个天然的视觉舞台。
// ============================================================================

// 引入 three.js 核心命名空间
import * as THREE from 'three';

/**
 * Environment —— 场景环境构建器
 */
export class Environment {
  /**
   * 构造函数。
   * @param {object} deps 依赖注入
   * @param {THREE.Scene} deps.scene 场景
   * @param {import('../tarot/CardTextures.js').TextureFactory} deps.textures 贴图工厂
   */
  constructor({ scene, textures }) {
    // 保存场景引用
    this.scene = scene;
    // 保存贴图工厂引用
    this.textures = textures;

    // 需要每帧更新的对象列表
    this._animatables = [];

    // 星空层数组
    this.starLayers = [];
    // 星云数组
    this.nebulae = [];
  }

  /**
   * 构建全部环境内容。
   */
  build() {
    // 依次构建各个部分
    this._buildLights();
    // 构建星空
    this._buildStarfield();
    // 构建星云
    this._buildNebulae();
    // 构建桌面
    this._buildFloor();
    // 构建环绕的光尘
    this._buildDust();
  }

  /**
   * 构建灯光。
   */
  _buildLights() {
    // ------------------------------------------------------------------
    // 环境光：提供最底层的可见度，颜色偏冷紫，避免画面死黑
    // ------------------------------------------------------------------
    const ambient = new THREE.AmbientLight(0x2a2340, 0.22);
    // 加入场景
    this.scene.add(ambient);

    // ------------------------------------------------------------------
    // 半球光：上方偏暖金、下方偏深紫，让物体上下有自然明暗过渡
    // ------------------------------------------------------------------
    const hemi = new THREE.HemisphereLight(0x8a7a5a, 0x140d24, 0.18);
    // 加入场景
    this.scene.add(hemi);

    // ------------------------------------------------------------------
    // 主光：从上前方打下来，负责卡牌的高光与投影
    // ------------------------------------------------------------------
    const key = new THREE.DirectionalLight(0xffe9c4, 1.0);
    // 光源位置：右上前方
    key.position.set(4.5, 9.5, 7.5);
    // 开启阴影投射
    key.castShadow = true;
    // 阴影贴图尺寸：1024 在清晰度与性能之间取得平衡
    key.shadow.mapSize.set(1024, 1024);
    // 正交阴影相机范围：刚好覆盖牌阵与牌位区域
    key.shadow.camera.left = -11;
    // 右边界
    key.shadow.camera.right = 11;
    // 上边界
    key.shadow.camera.top = 11;
    // 下边界
    key.shadow.camera.bottom = -11;
    // 近裁剪面
    key.shadow.camera.near = 1;
    // 远裁剪面
    key.shadow.camera.far = 40;
    // 阴影偏移，消除自阴影产生的摩尔纹
    key.shadow.bias = -0.0012;
    // 阴影采样半径，配合软阴影让边缘更柔
    key.shadow.radius = 3;
    // 加入场景
    this.scene.add(key);
    // 记录为关键光源
    this.keyLight = key;

    // ------------------------------------------------------------------
    // 左侧轮廓光：暖金，从后方斜切，勾出卡牌左缘的金边
    // ------------------------------------------------------------------
    const rimGold = new THREE.PointLight(0xffca6e, 6, 22, 2);
    // 位置：左后方
    rimGold.position.set(-7.5, 4.2, -5.5);
    // 加入场景
    this.scene.add(rimGold);

    // ------------------------------------------------------------------
    // 右侧轮廓光：冷紫，与暖金形成互补对比
    // ------------------------------------------------------------------
    const rimViolet = new THREE.PointLight(0x8a63ff, 5, 22, 2);
    // 位置：右后方
    rimViolet.position.set(7.8, 3.6, -4.2);
    // 加入场景
    this.scene.add(rimViolet);

    // ------------------------------------------------------------------
    // 顶部聚光灯：在桌面中心打出一个圆形光池，把视线牢牢锁在牌阵上
    // ------------------------------------------------------------------
    const spot = new THREE.SpotLight(0xfff0d0, 8, 24, Math.PI / 5.2, 0.7, 1.6);
    // 位置：正上方偏前
    spot.position.set(0, 12, 3.5);
    // 目标：桌面中心
    spot.target.position.set(0, 0.6, 0.2);
    // 加入场景
    this.scene.add(spot);
    // 目标对象也必须加入场景才会生效
    this.scene.add(spot.target);

    // 记录灯光引用，供后续可能的动态调光使用
    this.rimGold = rimGold;
    // 记录紫色轮廓光
    this.rimViolet = rimViolet;
    // 记录聚光灯
    this.spot = spot;
  }

  /**
   * 构建星空：三层不同尺度的粒子，形成纵深层次。
   */
  _buildStarfield() {
    // 星点纹理（三层共用）
    const sprite = this.textures.createStarSprite();
    // 定义三层参数：数量、半径范围、粒子尺寸、基础亮度
    const layers = [
      { count: 1200, rMin: 42, rMax: 78, size: 0.42, brightness: 0.75 },
      { count: 700, rMin: 26, rMax: 46, size: 0.3, brightness: 0.9 },
      { count: 260, rMin: 14, rMax: 26, size: 0.22, brightness: 1 },
    ];

    // 逐层构建
    layers.forEach((layer, layerIndex) => {
      // 位置数组
      const positions = new Float32Array(layer.count * 3);
      // 颜色数组：让星点有冷白、暖金、淡紫三种色调
      const colors = new Float32Array(layer.count * 3);
      // 逐个生成星点
      for (let i = 0; i < layer.count; i++) {
        // 球面均匀分布：先随机一个方向
        const u = Math.random() * 2 - 1;
        // 方位角的余弦与正弦
        const theta = Math.random() * Math.PI * 2;
        // 半径：在区间内取平方分布，让星点更集中在外层
        const r = layer.rMin + Math.pow(Math.random(), 0.6) * (layer.rMax - layer.rMin);
        // 水平投影半径
        const s = Math.sqrt(Math.max(0, 1 - u * u));
        // 写入 x
        positions[i * 3] = Math.cos(theta) * s * r;
        // 写入 y：整体上移，让星空更多分布在画面上方
        positions[i * 3 + 1] = u * r * 0.75 + 8;
        // 写入 z
        positions[i * 3 + 2] = Math.sin(theta) * s * r;

        // 随机挑选一种色调
        const tint = Math.random();
        // 色调一：冷白（最常见）
        let cr = 1;
        // 绿色分量
        let cg = 1;
        // 蓝色分量
        let cb = 1;
        // 色调二：暖金
        if (tint > 0.82) {
          // 偏暖
          cr = 1;
          // 绿色略低
          cg = 0.86;
          // 蓝色更低
          cb = 0.58;
        } else if (tint > 0.68) {
          // 色调三：淡紫
          cr = 0.78;
          // 绿色中等
          cg = 0.7;
          // 蓝色最高
          cb = 1;
        }
        // 亮度随机衰减，制造明暗层次
        const b = layer.brightness * (0.35 + Math.random() * 0.65);
        // 写入颜色
        colors[i * 3] = cr * b;
        // 写入颜色
        colors[i * 3 + 1] = cg * b;
        // 写入颜色
        colors[i * 3 + 2] = cb * b;
      }

      // 创建几何体
      const geo = new THREE.BufferGeometry();
      // 绑定位置属性
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      // 绑定颜色属性
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      // 创建点材质
      const mat = new THREE.PointsMaterial({
        // 星点贴图
        map: sprite,
        // 粒子尺寸
        size: layer.size,
        // 开启透视缩放
        sizeAttenuation: true,
        // 使用顶点色
        vertexColors: true,
        // 加色混合，星点叠加时更亮
        blending: THREE.AdditiveBlending,
        // 透明
        transparent: true,
        // 关闭深度写入，星点之间不互相遮挡
        depthWrite: false,
        // 让贴图自带透明生效
        alphaTest: 0.001,
      });

      // 创建点云
      const points = new THREE.Points(geo, mat);
      // 关闭视锥剔除（星空包围整个场景）
      points.frustumCulled = false;
      // 加入场景
      this.scene.add(points);
      // 记录该层与其旋转速度（越外层转得越慢，形成视差）
      this.starLayers.push({ points, speed: 0.008 / (layerIndex + 1), base: mat });
      // 注册到动画列表
      this._animatables.push((dt) => {
        // 缓慢自转
        points.rotation.y += this.starLayers[layerIndex].speed * dt;
      });
    });
  }

  /**
   * 构建星云：几团巨大的柔光，为深空背景增加色彩层次。
   */
  _buildNebulae() {
    // 定义几团星云的颜色与位置
    const defs = [
      { color: 'rgba(120, 90, 200, 0.5)', pos: [-14, 6, -30], size: 46, speed: 0.02 },
      { color: 'rgba(70, 60, 160, 0.42)', pos: [16, 2, -34], size: 54, speed: -0.017 },
      { color: 'rgba(200, 160, 90, 0.3)', pos: [4, -4, -26], size: 40, speed: 0.026 },
      { color: 'rgba(150, 70, 130, 0.28)', pos: [-10, -6, -28], size: 38, speed: -0.022 },
      { color: 'rgba(90, 130, 190, 0.24)', pos: [12, 9, -32], size: 44, speed: 0.019 },
    ];

    // 逐个创建
    defs.forEach((def) => {
      // 用径向渐变贴图构造柔光
      const mat = new THREE.MeshBasicMaterial({
        // 径向渐变
        map: this.textures.createRadialSprite(def.color, 'rgba(0,0,0,0)'),
        // 加色混合
        blending: THREE.AdditiveBlending,
        // 透明
        transparent: true,
        // 关闭深度写入
        depthWrite: false,
        // 双面渲染
        side: THREE.DoubleSide,
        // 参与深度测试：这样地面能正确遮挡位于地平线以下的星云，
        // 否则半透明物体永远最后绘制，会“穿透”桌面糊在画面前景
        depthTest: true,
      });
      // 创建平面
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(def.size, def.size), mat);
      // 设置初始位置
      mesh.position.set(def.pos[0], def.pos[1], def.pos[2]);
      // 随机初始旋转
      mesh.rotation.z = Math.random() * Math.PI * 2;
      // 渲染顺序设为最底层
      mesh.renderOrder = -10;
      // 关闭视锥剔除
      mesh.frustumCulled = false;
      // 加入场景
      this.scene.add(mesh);
      // 记录
      this.nebulae.push(mesh);
      // 注册动画：缓慢旋转，制造流动感
      this._animatables.push((dt) => {
        // 自转
        mesh.rotation.z += def.speed * dt;
      });
    });
  }

  /**
   * 构建黑曜石桌面。
   */
  _buildFloor() {
    // 生成地面贴图
    const floorTex = this.textures.createFloorTexture(1024);
    // 让贴图重复铺一次（虽然只有一张，但保持可扩展）
    floorTex.wrapS = THREE.RepeatWrapping;
    // 纵向同样允许重复
    floorTex.wrapT = THREE.RepeatWrapping;

    // 创建地面几何体：尺寸足够大，延伸到雾的尽处
    const geo = new THREE.PlaneGeometry(70, 70);
    // 创建物理材质，追求打磨石材的质感
    const mat = new THREE.MeshPhysicalMaterial({
      // 地面纹样
      map: floorTex,
      // 深色基调：偏冷的黑曜石色
      color: 0x0e0b18,
      // 金属度偏低：避免地面变成一面把环境光成片反射出来的镜子
      metalness: 0.35,
      // 粗糙度偏高，把反射进一步打散
      roughness: 0.56,
      // 清漆层让反射更“润”
      clearcoat: 0.7,
      // 清漆粗糙度
      clearcoatRoughness: 0.28,
      // 接收阴影
      // （此项在 Mesh 上设置，这里先占位说明）
    });

    // 创建地面网格
    const floor = new THREE.Mesh(geo, mat);
    // 绕 X 轴旋转 -90 度变成水平面
    floor.rotation.x = -Math.PI / 2;
    // 稍微下沉，避免与粒子等共面元素打架
    floor.position.y = -0.02;
    // 接收阴影
    floor.receiveShadow = true;
    // 加入场景
    this.scene.add(floor);
    // 记录引用
    this.floor = floor;

    // ------------------------------------------------------------------
    // 桌面中心再叠一层柔光，强化“仪式场”的中心感
    // ------------------------------------------------------------------
    const glowMat = new THREE.MeshBasicMaterial({
      // 金色径向渐变
      map: this.textures.createRadialSprite('rgba(227, 195, 122, 0.22)', 'rgba(227, 195, 122, 0)'),
      // 加色混合
      blending: THREE.AdditiveBlending,
      // 透明
      transparent: true,
      // 关闭深度写入
      depthWrite: false,
      // 双面
      side: THREE.DoubleSide,
    });
    // 创建光池平面
    const glowPool = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), glowMat);
    // 水平放置
    glowPool.rotation.x = -Math.PI / 2;
    // 略高于地面，避免深度冲突
    glowPool.position.y = 0.006;
    // 加入场景
    this.scene.add(glowPool);
    // 记录
    this.floorGlow = glowPool;
    // 注册呼吸动画
    this._animatables.push((dt, elapsed) => {
      // 缓慢呼吸
      glowMat.opacity = 0.1 + Math.sin(elapsed * 0.5) * 0.04;
    });
  }

  /**
   * 构建环绕的浮尘：散布在相机附近的微量粒子，增强空气感。
   */
  _buildDust() {
    // 粒子数量
    const COUNT = 420;
    // 位置数组
    const positions = new Float32Array(COUNT * 3);
    // 为每颗粒子记录一个独立漂移速度（放在用户数据里）
    const speeds = new Float32Array(COUNT);
    // 逐个生成
    for (let i = 0; i < COUNT; i++) {
      // 分布在相机前方的盒状区域
      positions[i * 3] = (Math.random() - 0.5) * 22;
      // 高度集中在桌面之上
      positions[i * 3 + 1] = Math.random() * 7 - 0.4;
      // 纵深分布
      positions[i * 3 + 2] = (Math.random() - 0.5) * 20 - 2;
      // 漂移速度
      speeds[i] = 0.06 + Math.random() * 0.16;
    }
    // 创建几何体
    const geo = new THREE.BufferGeometry();
    // 绑定位置
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    // 创建材质：颜色使用淡淡的香槟金
    const mat = new THREE.PointsMaterial({
      // 星点贴图
      map: this.textures.createStarSprite(),
      // 尺寸很小
      size: 0.055,
      // 开启透视缩放
      sizeAttenuation: true,
      // 暖金色
      color: 0xffdca8,
      // 加色混合
      blending: THREE.AdditiveBlending,
      // 透明
      transparent: true,
      // 整体透明度很低，只做点缀
      opacity: 0.4,
      // 关闭深度写入
      depthWrite: false,
    });
    // 创建点云
    const dust = new THREE.Points(geo, mat);
    // 关闭视锥剔除
    dust.frustumCulled = false;
    // 加入场景
    this.scene.add(dust);
    // 记录
    this.dust = { points: dust, speeds, geo };
    // 注册动画
    this._animatables.push((dt) => {
      // 取出位置数组
      const pos = this.dust.geo.attributes.position.array;
      // 逐颗粒子向上漂浮
      for (let i = 0; i < COUNT; i++) {
        // 上升
        pos[i * 3 + 1] += speeds[i] * dt;
        // 轻微的横向摆动，模拟气流
        pos[i * 3] += Math.sin(pos[i * 3 + 1] * 0.6 + i) * 0.006 * dt * 60;
        // 超出高度上限则回到底部
        if (pos[i * 3 + 1] > 6.8) pos[i * 3 + 1] = -0.4;
      }
      // 标记位置需要上传
      this.dust.geo.attributes.position.needsUpdate = true;
    });
  }

  /**
   * 每帧更新环境动画。
   * @param {number} dt 帧间隔（秒）
   * @param {number} elapsed 累计运行时间（秒）
   */
  update(dt, elapsed) {
    // 依次执行注册的动画回调
    for (let i = 0; i < this._animatables.length; i++) {
      // 执行
      this._animatables[i](dt, elapsed);
    }
  }

  /**
   * 释放资源。
   */
  dispose() {
    // 清空动画列表
    this._animatables.length = 0;
    // 释放地面几何体与材质
    if (this.floor) {
      // 释放几何体
      this.floor.geometry.dispose();
      // 释放材质
      this.floor.material.dispose();
    }
    // 释放地面光池
    if (this.floorGlow) {
      // 释放几何体
      this.floorGlow.geometry.dispose();
      // 释放材质
      this.floorGlow.material.dispose();
    }
    // 释放星空
    this.starLayers.forEach((layer) => {
      // 释放几何体
      layer.points.geometry.dispose();
      // 释放材质
      layer.base.dispose();
    });
    // 释放星云
    this.nebulae.forEach((n) => {
      // 释放几何体
      n.geometry.dispose();
      // 释放材质
      n.material.dispose();
    });
    // 释放浮尘
    if (this.dust) {
      // 释放几何体
      this.dust.geo.dispose();
      // 释放材质
      this.dust.points.material.dispose();
    }
  }
}
