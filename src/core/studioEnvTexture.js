// ============================================================================
// core/studioEnvTexture.js —— 程序化「暗色影棚」环境贴图
// ----------------------------------------------------------------------------
// 为什么不用 three 自带的 RoomEnvironment？
//   RoomEnvironment 模拟的是一间明亮的白色摄影棚，对深色奢华风格是灾难：
//   场景里所有高金属度材质（金箔牌边、黑曜石桌面）都会反射出一片惨白，
//   画面整体泛灰、失去对比。
//
// 这里手工搭一个「暗色影棚」：黑色房间外壳 + 三块（暖金 / 幽紫 / 冷白）发光板，
// 再用 PMREM 预卷积成环境贴图。结果是：
//   * 金色牌边只反射金色光斑，边缘有清晰的金属高光走向；
//   * 桌面像打磨过的黑曜石，只映出几点柔光，而不是一面白镜子；
//   * 整体基调保持深色，泛光通道的高光才有存在感。
// ============================================================================

// 引入 three.js 核心命名空间
import * as THREE from 'three';

/**
 * 创建一个自发光矩形面板。
 * @param {number} color 颜色（十六进制）
 * @param {number} intensity 发光强度（大于 1 即为 HDR 光源）
 * @param {[number,number,number]} position 位置
 * @param {[number,number]} size 尺寸
 * @param {boolean} doubleside 是否双面可见
 * @returns {THREE.Mesh} 面板网格
 */
function makeLightPanel(color, intensity, position, size, doubleside = false) {
  // 用基础材质承载纯色，再乘以强度得到 HDR 亮度
  const mat = new THREE.MeshBasicMaterial({
    // 颜色乘以强度，得到超过 1 的线性值，PMREM 会把它当作光源处理
    color: new THREE.Color(color).multiplyScalar(intensity),
    // 需要从两面都能被捕捉到才开双面
    side: doubleside ? THREE.DoubleSide : THREE.FrontSide,
  });
  // 创建平面
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size[0], size[1]), mat);
  // 设置位置
  mesh.position.set(position[0], position[1], position[2]);
  // 返回
  return mesh;
}

/**
 * 生成暗色影棚的环境贴图。
 * @param {THREE.WebGLRenderer} renderer 渲染器（PMREMGenerator 需要它）
 * @returns {THREE.Texture} 可直接赋给 scene.environment 的环境贴图
 */
export function createStudioEnvTexture(renderer) {
  // 创建用于烘焙的临时场景
  const envScene = new THREE.Scene();

  // ------------------------------------------------------------------
  // 1. 房间外壳：一个内表面可见的大盒子，纯深色，作为环境的基础色调
  // ------------------------------------------------------------------
  const shellMat = new THREE.MeshBasicMaterial({
    // 极深的冷紫黑
    color: new THREE.Color(0x0a0812),
    // 只渲染内表面，人站在盒子里
    side: THREE.BackSide,
  });
  // 盒子尺寸
  const shell = new THREE.Mesh(new THREE.BoxGeometry(30, 20, 30), shellMat);
  // 加入场景
  envScene.add(shell);

  // ------------------------------------------------------------------
  // 2. 顶部主光板：暖金色，面积最大，负责给金属面提供主要反射
  // ------------------------------------------------------------------
  const top = makeLightPanel(0xffe2a8, 5.2, [0, 9.4, 0], [9, 9]);
  // 面板默认竖直，需要转成水平朝下
  top.rotation.x = Math.PI / 2;
  // 加入场景
  envScene.add(top);

  // ------------------------------------------------------------------
  // 3. 左后方紫色补光板：给暗部一点幽紫反光，制造冷暖对比
  // ------------------------------------------------------------------
  const violet = makeLightPanel(0x8a63ff, 2.2, [-7.5, 3.2, -8.5], [7, 8], true);
  // 稍微转向房间中心，让反射更自然
  violet.rotation.y = 0.6;
  // 加入场景
  envScene.add(violet);

  // ------------------------------------------------------------------
  // 4. 右前方暖橙补光板：与紫色形成对角，让牌面两侧有不同色的边缘光
  // ------------------------------------------------------------------
  const amber = makeLightPanel(0xffb066, 2.6, [7.5, 1.5, 4], [6, 7], true);
  // 转向中心
  amber.rotation.y = -0.7;
  // 加入场景
  envScene.add(amber);

  // ------------------------------------------------------------------
  // 5. 底部微弱反光板：模拟桌面把一点点光反回物体底部，避免暗部彻底死黑
  // ------------------------------------------------------------------
  const bounce = makeLightPanel(0x3a3050, 0.8, [0, -8, 0], [10, 10]);
  // 水平朝上
  bounce.rotation.x = -Math.PI / 2;
  // 加入场景
  envScene.add(bounce);

  // ------------------------------------------------------------------
  // 6. 用 PMREM 把上面这个场景预卷积成环境贴图
  // ------------------------------------------------------------------
  const pmrem = new THREE.PMREMGenerator(renderer);
  // 0.02 的模糊量让反射柔和不刺眼
  const envTexture = pmrem.fromScene(envScene, 0.02).texture;
  // 释放生成器占用的临时渲染目标
  pmrem.dispose();
  // 释放临时场景里的几何体与材质
  envScene.traverse((obj) => {
    // 只处理网格
    if (obj.isMesh) {
      // 释放几何体
      obj.geometry.dispose();
      // 释放材质
      obj.material.dispose();
    }
  });

  // 返回环境贴图
  return envTexture;
}
