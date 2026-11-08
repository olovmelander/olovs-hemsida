/* The golfer at the ball: stood so the club meets it, turned down the aim
   line, feet fitted to the slope. (The lab's course mount does the same in
   engine/golfer-course.mjs, which ships only with the lab.) */
import * as THREE from 'three/webgpu';
import { GOLF_SWINGS, shotYawForDirection } from '../engine/golfer.mjs';

const UP = new THREE.Vector3(0, 1, 0);
const clamp = THREE.MathUtils.clamp;
const restPoses = new WeakMap();

/** Stand the golfer so that this club's contact point sits on the ball, aimed along yaw. */
export function standAtBall(golfer, ball, yaw, swing, heightAt) {
  const clip = golfer.clips.get(GOLF_SWINGS[swing]);
  const dir = [Math.sin(yaw), Math.cos(yaw)];
  golfer.root.rotation.y = shotYawForDirection(dir[0], dir[1], clip.shotDirection || [1, 0, 0]);
  const contact = new THREE.Vector3(...(clip.contact || [0, .02135, .75]));
  contact.applyAxisAngle(UP, golfer.root.rotation.y);
  const x = ball.x - contact.x, z = ball.z - contact.z;
  // The stance plane is the ball's ground; leg IK takes up each foot's own.
  golfer.root.position.set(x, heightAt(ball.x, ball.z), z);
  golfer.root.updateMatrixWorld(true);
}

/** Restore the clip's own leg pose before the mixer evaluates (see fitFeet). */
export function restoreLegs(golfer) {
  for (const [bone, quaternion] of restPoses.get(golfer.root) || []) bone.quaternion.copy(quaternion);
}

/** Fit each leg to the ground under its foot, within 16 cm, and tilt the foot to the slope. */
export function fitFeet(root, heightAt) {
  root.updateMatrixWorld(true);
  const original = [];
  const ground = root.position.y;
  for (const side of ['L', 'R']) {
    const thigh = root.getObjectByName(`Thigh_${side}`), shin = root.getObjectByName(`Shin_${side}`), foot = root.getObjectByName(`Foot_${side}`);
    if (!thigh || !shin || !foot) continue;
    for (const bone of [thigh, shin, foot]) original.push([bone, bone.quaternion.clone()]);
    const a = thigh.getWorldPosition(new THREE.Vector3()), b = shin.getWorldPosition(new THREE.Vector3()), c = foot.getWorldPosition(new THREE.Vector3());
    const footWorld = foot.getWorldQuaternion(new THREE.Quaternion());
    const target = c.clone(); target.y += clamp(heightAt(c.x, c.z) - ground, -.16, .16);
    const l1 = a.distanceTo(b), l2 = b.distanceTo(c), axis = target.clone().sub(a);
    const distance = Math.min(axis.length(), l1 + l2 - 1e-4); axis.normalize();
    target.copy(a).addScaledVector(axis, distance);
    const along = (l1 * l1 - l2 * l2 + distance * distance) / (2 * distance);
    const pole = b.clone().sub(a); pole.addScaledVector(axis, -pole.dot(axis)).normalize();
    const knee = a.clone().addScaledVector(axis, along).addScaledVector(pole, Math.sqrt(Math.max(0, l1 * l1 - along * along)));
    rotateTo(thigh, shin, knee); rotateTo(shin, foot, target);
    const nx = heightAt(c.x - .12, c.z) - heightAt(c.x + .12, c.z), nz = heightAt(c.x, c.z - .12) - heightAt(c.x, c.z + .12);
    const normal = new THREE.Vector3(nx, .24, nz).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(UP, normal).multiply(footWorld);
    foot.quaternion.copy(foot.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q)); foot.updateWorldMatrix(false, true);
  }
  restPoses.set(root, original);
}

function rotateTo(bone, child, target) {
  const origin = bone.getWorldPosition(new THREE.Vector3()), current = child.getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
  const desired = target.clone().sub(origin).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(current, desired).multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
  bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q)); bone.updateWorldMatrix(false, true);
}
