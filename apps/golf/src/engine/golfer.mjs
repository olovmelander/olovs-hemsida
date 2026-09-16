import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const GOLF_SWINGS = Object.freeze({ Driver: 'SwingDriver', Wood: 'SwingWood', Iron: 'SwingIron', Wedge: 'ChipWedge', Putter: 'Putt' });
export function shotYawForDirection(x, z, local = [1, 0, 0]) {
  return Math.atan2(x, z) - Math.atan2(local[0], local[2]);
}
export const GOLFER_CHARACTERS = Object.freeze({
  female: { label: 'Female', palette: 'Raspberry & cream', manifest: 'golfer.json' },
  male: { label: 'Male', palette: 'Sage & cream', manifest: 'golfer-male.json' },
});
export function characterFromUrl() {
  const id = new URLSearchParams(location.search).get('character');
  return Object.hasOwn(GOLFER_CHARACTERS, id) ? id : 'female';
}

/** A baked humanoid with a shared club socket. Movement remains in world metres. */
export class Golfer {
  constructor(gltf, manifest) {
    this.root = gltf.scene;
    this.root.name = 'Banvy golfer';
    // Keep yaw continuous through +/-90 degrees when copying a quaternion
    // between characters. XYZ Euler extraction folds those headings into X/Z.
    this.root.rotation.reorder('YXZ');
    this.rootMotionBone = this.root.getObjectByName('Root');
    this.rootMotionRest = this.rootMotionBone.quaternion.clone();
    this.manifest = manifest;
    this.mixer = new THREE.AnimationMixer(this.root);
    this.actions = new Map(gltf.animations.map(clip => [clip.name, this.mixer.clipAction(clip)]));
    this.clips = new Map(manifest.clips.map(clip => [clip.name, clip]));
    this.club = 'Iron'; this.current = null; this.impactFired = false;
    this.onImpact = null; this.onFinished = null; this.onChange = null;
    this.pendingClub = null; this.paused = false; this.rate = 1;
    for (const name of this.clips.keys()) if (!this.actions.has(name)) throw new Error(`Golfer animation missing: ${name}`);
    this.clubMeshes = new Map(manifest.clubs.map(({ id }) => {
      const object = this.root.getObjectByName(`Club_${id}`);
      if (!object) throw new Error(`Golfer club missing: ${id}`);
      return [id, object];
    }));
    this.root.traverse(object => {
      if (object.isMesh) {
        object.castShadow = true; object.receiveShadow = true;
        // Dynamic skinning bounds are small; retaining an old bind-pose bound can
        // cull a raised club or hand. The character is a single near-view actor.
        object.frustumCulled = false;
      }
    });
    this.selectClub('Iron', false);
    this.play('Idle', { fade: 0 });
    this._finished = ({ action }) => {
      if (action !== this.actions.get(this.current)) return;
      const completed = this.current;
      if (completed === 'ClubChange' && this.pendingClub) this._showClub(this.pendingClub);
      this.pendingClub = null;
      this.onFinished?.(completed);
      // Hold the follow-through for review; locomotion and Address can interrupt it.
    };
    this.mixer.addEventListener('finished', this._finished);
  }
  _showClub(id) {
    this.club = id;
    for (const [name, object] of this.clubMeshes) object.visible = name === id;
  }
  selectClub(id, animate = true) {
    if (!this.clubMeshes.has(id)) throw new Error(`Unknown golf club: ${id}`);
    if (animate && id !== this.club) {
      this.pendingClub = id;
      this.play('ClubChange');
    } else { this.pendingClub = null; this._showClub(id); }
  }
  play(name, { fade = .18, restart = true } = {}) {
    const next = this.actions.get(name), data = this.clips.get(name);
    if (!next || !data) throw new Error(`Unknown golfer animation: ${name}`);
    if (name === this.current && !restart) return;
    if (name !== 'ClubChange' && this.pendingClub) {
      this._showClub(this.pendingClub); this.pendingClub = null;
    }
    if (name.startsWith('Address') || data.impact != null) this._showClub(data.club);
    const previous = this.actions.get(this.current);
    // Interrupted transitions must not leave a third clip contributing to the pose.
    for (const action of this.actions.values()) if (action !== previous && action !== next) action.stop();
    next.stopFading().stopWarping();
    next.reset().setEffectiveWeight(1).setEffectiveTimeScale(1);
    next.setLoop(data.loop ? THREE.LoopRepeat : THREE.LoopOnce, data.loop ? Infinity : 1);
    next.clampWhenFinished = !data.loop;
    next.play();
    if (previous && previous !== next && fade > 0) previous.crossFadeTo(next, fade, false);
    else if (previous && previous !== next) previous.stop();
    this.current = name; this.impactFired = false; this.turnBaseYaw = this.root.rotation.y;
    this.onChange?.(name);
  }
  address() { this.play(`Address${this.pendingClub || this.club}`); }
  swing() { this.play(GOLF_SWINGS[this.pendingClub || this.club]); }
  seek(seconds) {
    const action = this.actions.get(this.current);
    for (const other of this.actions.values()) if (other !== action) other.stop();
    action.stopFading().stopWarping().setEffectiveWeight(1); action.enabled = true;
    action.paused = false;
    action.time = THREE.MathUtils.clamp(seconds, 0, this.clips.get(this.current).duration - 1e-6);
    this.mixer.update(0);
    this._applyTurn();
    this.impactFired = true; // Scrubbing is inspection, never a gameplay event.
  }
  update(dt) {
    if (!Number.isFinite(dt) || dt < 0) throw new Error('Golfer delta must be a finite non-negative number');
    if (this.paused) return;
    const action = this.actions.get(this.current), data = this.clips.get(this.current);
    const before = action.time;
    this.mixer.update(dt * this.rate);
    this._applyTurn();
    if (data.impact != null && !this.impactFired && before < data.impact && action.time >= data.impact) {
      this.impactFired = true;
      this.root.updateMatrixWorld(true);
      this.onImpact?.({ club: this.club, clip: data.name, time: data.impact });
    }
    if (this.current === 'ClubChange' && this.pendingClub && action.time >= data.duration * .5) {
      this._showClub(this.pendingClub); this.pendingClub = null;
    }
  }
  get time() { return this.actions.get(this.current).time; }
  get duration() { return this.clips.get(this.current).duration; }
  _applyTurn() {
    // Turn clips retain native root motion in Blender. Apply that heading to the
    // actor root here so controls, aiming and subsequent clips keep the new yaw.
    this.rootMotionBone.quaternion.copy(this.rootMotionRest);
    const angle = this.clips.get(this.current).turnAngle;
    if (angle == null) return;
    const t = THREE.MathUtils.clamp(this.time / this.duration, 0, 1);
    this.root.rotation.y = this.turnBaseYaw + angle * t * t * (3 - 2 * t);
  }
  shotDirection() {
    const local = this.clips.get(GOLF_SWINGS[this.club]).shotDirection || [1, 0, 0];
    return new THREE.Vector3(...local).applyQuaternion(this.root.quaternion).normalize();
  }
  dispose() {
    this.mixer.removeEventListener('finished', this._finished);
    this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.root);
    const geometries = new Set(), materials = new Set(), textures = new Set(), skeletons = new Set();
    this.root.traverse(o => { if (o.isMesh) { geometries.add(o.geometry); for (const m of Array.isArray(o.material) ? o.material : [o.material]) materials.add(m); } });
    this.root.traverse(o => { if (o.isSkinnedMesh) skeletons.add(o.skeleton); });
    materials.forEach(m => { for (const value of Object.values(m)) if (value?.isTexture) textures.add(value); });
    textures.forEach(t => t.dispose()); skeletons.forEach(s => s.dispose());
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
    this.root.removeFromParent();
  }
}

/** Transfer the selected pose and world transform after a character finishes loading. */
export function transferGolferState(previous, next) {
  next.root.position.copy(previous.root.position); next.root.quaternion.copy(previous.root.quaternion);
  next.selectClub(previous.club, false);
  next.play(previous.current, { fade: 0 });
  next.turnBaseYaw = previous.turnBaseYaw;
  next.pendingClub = previous.pendingClub;
  next.seek(previous.time); next.impactFired = previous.impactFired;
  next.paused = previous.paused; next.rate = previous.rate;
}

export async function loadGolfer(baseUrl = import.meta.env.BASE_URL, character = 'female') {
  const design = GOLFER_CHARACTERS[character];
  if (!Object.hasOwn(GOLFER_CHARACTERS, character)) throw new Error(`Unknown golfer character: ${character}`);
  const base = `${baseUrl}models/golfer/`;
  const response = await fetch(`${base}${design.manifest}`);
  if (!response.ok) throw new Error(`Could not load the golfer (${response.status})`);
  const manifest = await response.json();
  const gltf = await new GLTFLoader().loadAsync(`${base}${manifest.file}${manifest.sha256 ? `?v=${manifest.sha256}` : ''}`);
  const golfer = new Golfer(gltf, manifest); golfer.character = character;
  return golfer;
}
