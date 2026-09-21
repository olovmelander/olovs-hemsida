import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { CLUB_ASSETS } from '../engine/club-assets.mjs';
import { clubAssetKey } from '../engine/club-design.mjs';

/** One lazy renderer for the bag. Stops completely while closed or hidden. */
export async function createClubViewer(host, onStatus) {
  const renderer = new THREE.WebGPURenderer({ antialias: true, alpha: true, forceWebGL: true });
  try { await renderer.init(); } catch (error) { renderer.dispose(); throw error; }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .86;
  const canvas = renderer.domElement;
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Golfklubba i 3D. Dra eller använd piltangenterna för att rotera. Plus och minus zoomar.');
  host.prepend(canvas);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, .001, 20);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = .09;
  controls.enablePan = false; controls.autoRotateSpeed = .65;
  controls.minPolarAngle = .08; controls.maxPolarAngle = Math.PI - .08;
  const environment = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const lighting = pmrem.fromScene(environment, .035);
  scene.environment = lighting.texture;
  environment.dispose(); pmrem.dispose();
  scene.environmentIntensity = 1.05;
  scene.add(new THREE.HemisphereLight(0xf3f6ff, 0x7c8274, .6));
  const key = new THREE.DirectionalLight(0xfff4de, 1.6); key.position.set(-2, 3, 3); scene.add(key);
  const rim = new THREE.DirectionalLight(0xd7e7ff, 1.2); rim.position.set(2, 1, -3); scene.add(rim);
  const loader = new GLTFLoader(), cache = new Map();
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let model, request = 0, active = false, spinning = !reducedMotion.matches, mode = 'head', frame = 0, lastTime = 0, disposed = false;
  let transition;
  function resize() {
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize); observer.observe(host);
  function draw(time = 0) {
    frame = 0;
    if (!active || document.hidden || disposed) return;
    const dt = Math.min(.05, (time - lastTime) / 1000 || 1/60); lastTime = time;
    if (transition) {
      const t = Math.min(1, (time - transition.start) / 550), ease = 1 - (1-t)**3;
      camera.position.lerpVectors(transition.from, transition.to, ease);
      controls.target.lerpVectors(transition.targetFrom, transition.targetTo, ease);
      if (t === 1) transition = null;
    }
    controls.autoRotate = spinning && !reducedMotion.matches && !transition;
    controls.update(dt); renderer.render(scene, camera);
    frame = requestAnimationFrame(draw);
  }
  function start() { if (!frame && active && !document.hidden && !disposed) { lastTime = 0; frame = requestAnimationFrame(draw); } }
  function setActive(value) { active = value; if (!value) { cancelAnimationFrame(frame); frame = 0; } else { resize(); start(); } }
  function visibility() { if (document.hidden) { cancelAnimationFrame(frame); frame = 0; } else start(); }
  document.addEventListener('visibilitychange', visibility);
  function pose(view = 'hero', animate = true) {
    if (!model) return;
    const wide = ['driver', 'fairway', 'hybrid'].includes(model.userData.kind);
    const iron = model.userData.kind === 'iron';
    const wedge = model.userData.kind === 'wedge';
    const putter = model.userData.kind === 'putter';
    const wood = ['driver', 'fairway', 'hybrid'].includes(model.userData.kind);
    const hybrid = model.userData.kind === 'hybrid';
    const target = mode === 'full' ? new THREE.Vector3(iron || wedge ? .23 : wood ? .28 : putter ? .13 : .15, putter ? .44 : .50, 0) : new THREE.Vector3(wedge ? -.005 : 0, wedge ? .030 : iron ? .032 : hybrid ? .028 : wood ? .031 : putter ? .021 : .036, wedge ? -.017 : hybrid ? -.002 : wood ? -.009 : putter ? -.017 : 0);
    // Fit tall clubs to height and wide heads to width on small screens.
    let distance = mode === 'full' ? (putter ? 1.5 : 1.65) : (wood ? (model.userData.kind === 'driver' ? .235 : hybrid ? .18 : .20) : wide ? .23 : iron ? .155 : putter ? .20 : .17) / Math.min(1, camera.aspect / 1.2);
    const direction = view === 'face' ? new THREE.Vector3(.12,.14,1) : view === 'sole' || (view === 'hero' && wide) ? new THREE.Vector3(-.25,-.90,-.75) : new THREE.Vector3(-.34,model.userData.kind === 'iron' ? -.35 : .30,-1);
    if (iron) {
      const loft = THREE.MathUtils.degToRad(model.userData.loft);
      if (view === 'face') direction.set(.12, Math.sin(loft), Math.cos(loft));
      else if (view === 'sole') direction.set(-.05, -.97, .24);
      else direction.set(-.24, -.16, -1);
    }
    if (wood) {
      const loft = THREE.MathUtils.degToRad(model.userData.loft);
      if (view === 'face') direction.set(.08, Math.sin(loft), Math.cos(loft));
      else if (view === 'sole') direction.set(-.06, -1, .04);
      else direction.set(.80, -.53, -.60);
    }
    if (wedge) {
      const loft = THREE.MathUtils.degToRad(model.userData.loft);
      if (view === 'face') direction.set(.08, Math.sin(loft), Math.cos(loft));
      else if (view === 'sole') direction.set(-.06, -1, -.05);
      else direction.set(-.22, -.64, -.85);
    }
    if (putter) {
      const loft = THREE.MathUtils.degToRad(model.userData.loft);
      if (view === 'face') direction.set(.04, Math.sin(loft), Math.cos(loft));
      else if (view === 'sole') direction.set(-.10, -1, -.08);
      else direction.set(.60, .85, -1);
    }
    if (mode === 'full') direction.set(-.12,.06,-1);
    if (wood || wedge || putter) {
      // Fit the actual head from this angle. Deep crowns and wide soles need
      // different framing; a fixed distance clipped them in the sole preset.
      const back = direction.clone().normalize();
      const right = new THREE.Vector3(0,1,0).cross(back).normalize();
      const up = back.clone().cross(right);
      const tanY = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * .88;
      const tanX = tanY * camera.aspect;
      const point = new THREE.Vector3();
      model.updateMatrixWorld(true);
      model.traverse(object => {
        const positions = object.geometry?.attributes.position;
        if (!positions) return;
        for (let i = 0; i < positions.count; i++) {
          point.fromBufferAttribute(positions,i).applyMatrix4(object.matrixWorld);
          if (mode === 'head' && point.y > (wedge ? .072 : putter ? .055 : model.userData.kind === 'driver' ? .068 : .045)) continue;
          point.sub(target);
          distance = Math.max(distance, point.dot(back) + Math.abs(point.dot(up)) / tanY, point.dot(back) + Math.abs(point.dot(right)) / tanX);
        }
      });
    }
    const to = target.clone().add(direction.normalize().multiplyScalar(distance));
    controls.minDistance = mode === 'full' ? .65 : .10; controls.maxDistance = mode === 'full' ? 3 : .65;
    if (animate && !reducedMotion.matches) transition = { start: performance.now(), from: camera.position.clone(), to, targetFrom: controls.target.clone(), targetTo: target };
    else { transition = null; camera.position.copy(to); controls.target.copy(target); controls.update(); }
  }
  const stopTransition = () => { transition = null; };
  controls.addEventListener('start', stopTransition);
  canvas.addEventListener('keydown', event => {
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation(); transition = null;
    const offset = camera.position.clone().sub(controls.target), s = new THREE.Spherical().setFromVector3(offset);
    if (event.key === 'ArrowLeft') s.theta -= .15;
    if (event.key === 'ArrowRight') s.theta += .15;
    if (event.key === 'ArrowUp') s.phi = Math.max(.08, s.phi - .12);
    if (event.key === 'ArrowDown') s.phi = Math.min(Math.PI-.08, s.phi + .12);
    if (event.key === '+' || event.key === '=') s.radius = Math.max(controls.minDistance, s.radius * .9);
    if (event.key === '-') s.radius = Math.min(controls.maxDistance, s.radius * 1.1);
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(s)); controls.update();
  });
  return {
    async select(club) {
      const token = ++request, assetKey = clubAssetKey(club), asset = CLUB_ASSETS[assetKey];
      onStatus('loading');
      // Remove the previous club immediately so an error cannot mislabel it.
      if (model) { scene.remove(model); model = null; }
      try {
        if (!cache.has(assetKey)) cache.set(assetKey, loader.loadAsync(`${import.meta.env.BASE_URL}${asset.file}`).catch(error => { cache.delete(assetKey); throw error; }));
        const gltf = await cache.get(assetKey);
        if (disposed || token !== request) return;
        model = gltf.scene; model.userData.kind = asset.kind; model.userData.loft = asset.loft; scene.add(model);
        // Keep the steel faces legible under the studio's bright panels.
        const iron = asset.kind === 'iron' || asset.kind === 'wedge';
        const wood = ['driver', 'fairway', 'hybrid'].includes(asset.kind);
        const wedge = asset.kind === 'wedge';
        const putter = asset.kind === 'putter';
        scene.environmentRotation.y = putter ? .35 : wedge ? .6 : iron || wood ? Math.PI / 2 : 0;
        renderer.toneMappingExposure = putter ? .80 : wedge ? .84 : iron || wood ? .78 : .86;
        key.intensity = putter ? .45 : iron || wood ? .6 : 1.6; rim.intensity = putter ? .50 : iron || wood ? .6 : 1.2;
        canvas.setAttribute('aria-label', `${club.name} i 3D. Dra eller använd piltangenterna för att rotera. Plus och minus zoomar.`);
        pose('hero', false); onStatus('ready');
      } catch { if (!disposed && token === request) onStatus('error'); }
    },
    setActive,
    setMode(value) { mode = value; pose(); },
    setSpinning(value) { spinning = value; },
    pose,
    dispose() {
      disposed = true; request++; setActive(false); observer.disconnect(); controls.dispose(); lighting.dispose();
      document.removeEventListener('visibilitychange', visibility);
      for (const pending of cache.values()) pending.then(gltf => gltf.scene.traverse(o => { o.geometry?.dispose(); for (const m of [o.material].flat().filter(Boolean)) m.dispose(); })).catch(() => {});
      renderer.dispose(); canvas.remove();
    },
  };
}
