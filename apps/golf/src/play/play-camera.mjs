/* The play camera: behind the ball at address, with the ball as it flies, at
   the landing spot as it comes down, and settled on it where it rests.

   The whole flight is simulated before the ball leaves the club, so the camera
   knows where it lands: as the ball turns down it hands over, smoothly, to a
   view from beside the landing spot, the way a broadcast cuts to the green.
   Every pose is eased (critically damped) and kept above the drawn ground. */
import * as THREE from 'three/webgpu';

const UP = new THREE.Vector3(0, 1, 0);

export function createPlayCamera({ camera, heightAt }) {
  const eye = camera.position.clone(), look = new THREE.Vector3();
  camera.getWorldDirection(look); look.multiplyScalar(20).add(eye);
  const goalEye = eye.clone(), goalLook = look.clone(), launchEye = eye.clone();
  let stiffness = 3.2;
  const keepAbove = (p, clearance) => {
    const g = heightAt(p.x, p.z);
    if (Number.isFinite(g) && p.y < g + clearance) p.y = g + clearance;
    return p;
  };
  const dirOf = yaw => new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
  return {
    /** Snap to the goal (after a cut or a teleport). */
    snap() { eye.copy(goalEye); look.copy(goalLook); },
    /** Behind the ball, looking down the aim line. */
    address(ball, yaw, { putt = false, distance = 150 } = {}) {
      const d = dirOf(yaw), left = new THREE.Vector3(d.z, 0, -d.x);
      // A portrait screen sees a narrow slice: stand further back and a little
      // toward the golfer (who stands left of the line), so she stays in frame.
      const narrow = Math.max(0, Math.min(1, (1.2 - camera.aspect) / .75));
      const back = (putt ? 3.1 : 4.6) * (1 + narrow * .75), high = (putt ? 1.25 : 1.9) * (1 + narrow * .25);
      goalEye.copy(ball).addScaledVector(d, -back).addScaledVector(UP, high).addScaledVector(left, narrow * (putt ? .35 : .55));
      keepAbove(goalEye, 1.2);
      const ahead = putt ? Math.min(10, Math.max(3, distance)) : Math.min(60, Math.max(20, distance * .4));
      goalLook.copy(ball).addScaledVector(d, ahead).addScaledVector(UP, putt ? 0 : .8);
      stiffness = 3.2;
    },
    /** High over the landing zone, looking down the hole (the overview). */
    overview(ball, target, yaw) {
      const d = dirOf(yaw);
      const mid = ball.clone().lerp(target, .62);
      goalEye.copy(ball).addScaledVector(d, -12).addScaledVector(UP, 38 + ball.distanceTo(target) * .18);
      goalLook.copy(mid);
      stiffness = 2.4;
    },
    /** At the strike: the eye holds where it is while the ball climbs away. */
    launch() { launchEye.copy(eye); },
    /** Through a flight: watch it climb from behind the golfer, then come down from beside the landing. */
    flight(ball, velocity, { landing, start, progress, putt = false }) {
      const horizontal = new THREE.Vector3(velocity.x, 0, velocity.z);
      const along = horizontal.lengthSq() > 1e-4 ? horizontal.normalize() : new THREE.Vector3().subVectors(landing, start).setY(0).normalize();
      if (putt) {
        goalEye.copy(ball).addScaledVector(along, -2.6).addScaledVector(UP, 1.1);
        keepAbove(goalEye, .9); goalLook.copy(ball); stiffness = 4; return;
      }
      if (progress < .42) {
        // The broadcast shot: from behind the golfer, the eye rises a little and tracks the ball.
        goalEye.copy(launchEye).addScaledVector(UP, 1.2 * Math.min(1, progress / .3));
        goalLook.copy(ball);
        stiffness = 5;
      } else {
        // Beside the landing, a little short of it and off to the side, raised.
        const line = new THREE.Vector3().subVectors(landing, start).setY(0);
        const length = line.length(); line.normalize();
        const side = new THREE.Vector3().crossVectors(UP, line);
        const away = Math.min(28, 8 + length * .09);
        goalEye.copy(landing).addScaledVector(line, -away * .9).addScaledVector(side, away * .55).addScaledVector(UP, 4 + away * .3);
        goalLook.copy(ball);
        stiffness = 2.6;
      }
      keepAbove(goalEye, 1.5);
    },
    /** Settled on the ball where it rests, the hole beyond it. */
    rest(ball, toward) {
      const d = new THREE.Vector3().subVectors(toward, ball).setY(0);
      if (d.lengthSq() < 1e-6) d.set(0, 0, 1);
      d.normalize();
      goalEye.copy(ball).addScaledVector(d, -6).addScaledVector(UP, 2.4);
      keepAbove(goalEye, 1.4);
      goalLook.copy(ball).addScaledVector(d, 6);
      stiffness = 2.2;
    },
    /** The replay's swing: face on, from the far side of the ball, the golfer filling the frame. */
    replaySwing(ball, yaw, { putt = false } = {}) {
      const d = dirOf(yaw), right = new THREE.Vector3(-d.z, 0, d.x);
      goalEye.copy(ball).addScaledVector(right, putt ? 2.4 : 3.4).addScaledVector(d, putt ? .2 : .5).addScaledVector(UP, putt ? .8 : 1.15);
      keepAbove(goalEye, .7);
      goalLook.copy(ball).addScaledVector(right, -.55).addScaledVector(UP, putt ? .55 : .85);
      stiffness = 6;
    },
    /** The replay's flight: from the side as it climbs, then from beyond the landing, looking back at it coming in. */
    replay(ball, { start, landing, progress, putt = false, cup = null }) {
      const line = new THREE.Vector3().subVectors(landing, start).setY(0);
      if (line.lengthSq() < 1e-6) line.set(0, 0, 1);
      const length = line.length(); line.normalize();
      const side = new THREE.Vector3(-line.z, 0, line.x);
      if (putt) {
        // Low behind the cup, the ball rolling toward the eye.
        const at = cup || landing;
        goalEye.copy(at).addScaledVector(line, 2.2).addScaledVector(side, .7).addScaledVector(UP, .5);
        keepAbove(goalEye, .35); goalLook.copy(ball); stiffness = 3.5; return;
      }
      if (progress < .55) {
        goalEye.copy(start).addScaledVector(side, 9 + length * .05).addScaledVector(line, Math.min(40, length * .18)).addScaledVector(UP, 2.2 + length * .02);
        stiffness = 3;
      } else {
        goalEye.copy(landing).addScaledVector(line, 10 + length * .04).addScaledVector(side, -5).addScaledVector(UP, 2.4);
        stiffness = 2.4;
      }
      keepAbove(goalEye, 1.2);
      goalLook.copy(ball);
    },
    /** Looking at a point from a given spot (a cut). */
    frame(eyeAt, lookAt, k = 3) { goalEye.copy(eyeAt); goalLook.copy(lookAt); stiffness = k; },
    update(dt) {
      const a = 1 - Math.exp(-stiffness * dt);
      eye.lerp(goalEye, a); look.lerp(goalLook, a);
      keepAbove(eye, .8);
      camera.position.copy(eye);
      camera.lookAt(look);
    },
  };
}
