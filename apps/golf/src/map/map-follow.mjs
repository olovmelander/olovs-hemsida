/* Which hole a player is on, by where they stand. Pure.

   A hole changes when the player stands on the next tee, in order of play, or the
   one after it: a tee can go by unseen, in a locked phone or in a hurry, and one
   missed tee must not leave the map behind for the rest of the round. Nothing else
   moves it: a ball in the next fairway, or a walk past another hole's tee, is not a
   new hole, and it was exactly those that fooled a test of the nearest line.
   Standing means staying: a tee that lies along the way is walked through in
   seconds, and a player waits on a tee for longer than that. Any colour's tee will
   do, since that is only where a player stands. Which colour is played stays the
   player's own choice. */
import { ringSD } from '../engine/geom.js';

export const TEE_REACH_METRES = 14, TEE_DWELL_MS = 20000;
/* A fix this loose cannot tell one tee from the next. */
const WORST_ACCURACY_METRES = 20;
/* A next tee can lie beside the green still being putted on. */
const GREEN_MARGIN_METRES = 6;

export const nextHole = (number, count) => (number % count) + 1;

/* From a point to the nearest place to tee off on a hole, of any colour. */
export function distanceToTee(point, hole) {
  let nearest = Infinity;
  for (const tee of hole.tees) nearest = Math.min(nearest, Math.hypot(tee.point[0] - point[0], tee.point[1] - point[1]));
  for (const pad of hole.teePads) nearest = Math.min(nearest, Math.max(0, ringSD(point[0], point[1], pad)));
  return nearest;
}

export function createTeeWatch() {
  let waitingFor = null, since = 0, standing = [], lastPlaying = null, leftTee = false;
  const refused = new Set();
  return {
    get waiting() { return waitingFor !== null; },
    standingOn: number => standing.includes(number),

    /* The player chose a hole by hand: the tees they stand on say nothing more until
       they have left them, or the map would take the choice straight back. */
    manual() {
      for (const number of standing) refused.add(number);
      waitingFor = null;
    },

    /* The hole to change to, once the player has stood on its tee long enough.
       `shown` is the hole on screen, `playing` the one last played, which differ
       while a player looks ahead, and `fresh` a round with nothing on its card yet,
       which can start on the first tee from any hole. */
    update({ point, accuracy, now, holes, shown, playing, fresh = false }) {
      standing = holes.filter(hole => distanceToTee(point, hole) <= TEE_REACH_METRES).map(hole => hole.n);
      for (const number of refused) if (!standing.includes(number)) refused.delete(number);
      /* Holes can share a tee: at Lidingö the 2nd's is the 4th's. Waiting on it to play
         the 2nd says nothing of the 4th, so a tee only starts a new hole once the
         player has been off the tee of the one they are playing. */
      if (playing !== lastPlaying) {
        lastPlaying = playing;
        leftTee = false;
      }
      if (!standing.includes(playing)) leftTee = true;
      const count = holes.length;
      const ahead = [nextHole(shown, count), nextHole(playing, count), nextHole(nextHole(playing, count), count), ...(fresh ? [1] : [])];
      /* Some tees touch the last green, so being near it says nothing by itself: a
         player is still putting only if the green is the nearer of the two. */
      const toGreen = Math.max(0, ringSD(point[0], point[1], holes[playing - 1].green.ring));
      const putting = number => toGreen < GREEN_MARGIN_METRES && distanceToTee(point, holes[number - 1]) > toGreen;
      const found = accuracy > WORST_ACCURACY_METRES || !leftTee ? null
        : standing.filter(number => number !== shown && ahead.includes(number) && !refused.has(number) && !putting(number))
          .sort((a, b) => ahead.indexOf(a) - ahead.indexOf(b))[0] ?? null;
      if (found !== waitingFor) {
        waitingFor = found;
        since = now;
      }
      return found !== null && now - since >= TEE_DWELL_MS ? found : null;
    },
  };
}
