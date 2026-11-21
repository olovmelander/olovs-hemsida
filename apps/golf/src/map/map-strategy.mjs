/* Live guidance uses the same graph of playable strokes as Spellinje. GPS can
   start beside the fairway, near the cup, or in a different spot every second. */
import { nearestPointOnLine, pointAlongLine, recommendClub } from '../engine/caddie.js';
import { inRing, ptSegD, ringSD } from '../engine/geom.js';
import { planGolfShots } from '../engine/shot-planner.mjs';
import { groundDistance, shotReading } from './map-measure.mjs';

const validPoint = p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const unknownHeight = () => NaN;
const greenInset = 2;
const unchangedAimMetres = 6;
const graphOriginsPerCache = 24;

function shotReader(bag, carryBag, heightAt, weather, environment) {
  const carries = new Map(carryBag.map(club => [club.id, club.carry]));
  const clubs = bag.filter(club => club.carry > 0);
  const supportedCarry = club => Math.min(club.carry, carries.get(club.id) ?? 0);
  function conditions(from, to) {
    const reading = shotReading(from, to, heightAt, weather);
    const distance = Math.max(0.01, reading.plays ?? reading.distance);
    const required = environment?.carryRequired?.(from, to) ?? 0;
    let carry = required;
    if (required > 0 && reading.distance > 0) {
      // The far bank and the target can be at different elevations.
      const share = required / reading.distance;
      const bank = [from[0] + (to[0] - from[0]) * share, from[1] + (to[1] - from[1]) * share];
      carry = shotReading(from, bank, heightAt, weather).plays ?? required;
    }
    // A GPS-learned total includes roll. Only the player's entered carry can
    // clear a hazard. Keep the club IDs in their own bag throughout.
    const eligible = required > 0 ? clubs.filter(club => supportedCarry(club) >= carry) : clubs;
    return { reading, distance, eligible, reachable: eligible.some(club => club.carry >= distance) };
  }
  function read(from, to) {
    const { reading, distance, eligible, reachable } = conditions(from, to);
    if (reading.distance === 0) return { reading, club: null, reachable: false };
    // A small short miss is a reasonable club choice; a gap in a sparse bag
    // must not pair a 130 m landing with a 70 m club.
    const tolerance = Math.min(10, Math.max(3, distance * 0.05));
    const choices = eligible.filter(club => club.carry >= distance - tolerance);
    if (!choices.length) {
      const longest = clubs.reduce((best, club) => !best || supportedCarry(club) > supportedCarry(best) ? club : best, null);
      return { reading, club: eligible.length ? eligible.reduce((a, b) => a.carry > b.carry ? a : b) : longest, reachable: false };
    }
    // normalizeBag recovers a one-club bag to the defaults; here one eligible
    // club is a legitimate result of a forced carry.
    const id = choices.length > 1 ? recommendClub(distance, choices)?.club.id : choices[0].id;
    // An unusually long learned total can exceed the storage editor's range.
    // Even when the storage normaliser recovers to its defaults, choose a
    // real member of the eligible bag.
    const club = choices.find(item => item.id === id) ??
      choices.reduce((a, b) => Math.abs(a.carry - distance) <= Math.abs(b.carry - distance) ? a : b);
    return { reading, club, reachable };
  }
  return { read, reachable: (from, to) => conditions(from, to).reachable };
}

/** Manual measurements remain useful even when a full stroke cannot reach. */
export function readMapShot({ from, to, bag, carryBag = bag, heightAt = unknownHeight, weather = null, environment }) {
  return shotReader(bag, carryBag, heightAt, weather, environment).read(from, to);
}

/* A long shortcut across an unmapped dogleg is a poor default. Use the
   routed bend only where the chord really leaves the hole's playable turf.
   A straight fairway or a mapped landing across a pond can still be played. */
function cutsCorner(from, to, hole) {
  const route = hole.line;
  if (!route || route.length < 3) return false;
  const a = nearestPointOnLine(from, route), b = nearestPointOnLine(to, route);
  if (b.segment <= a.segment || b.along - a.along < groundDistance(from, to) + 15) return false;
  const dx = to[0] - from[0], dz = to[1] - from[1], length2 = dx * dx + dz * dz;
  for (let i = a.segment + 1; i <= b.segment; i++) {
    const bend = route[i];
    if (ptSegD(...bend, ...from, ...to) < 28) continue;
    const t = Math.min(1, Math.max(0, ((bend[0] - from[0]) * dx + (bend[1] - from[1]) * dz) / length2));
    const spot = [from[0] + t * dx, from[1] + t * dz];
    if (nearestPointOnLine(spot, route).distance > 20 &&
        !hole.fairway?.rings?.some(ring => ringSD(...spot, ring) < 8) && ringSD(...spot, hole.green.ring) > 8) return true;
  }
  return false;
}

export function createMapStrategy({ hole, environment, bag, carryBag = bag, heightAt = unknownHeight, weather = null,
  greensApproximate = Boolean(hole.greensApproximate) }) {
  const reader = shotReader(bag, carryBag, heightAt, weather, environment);
  const clubs = bag.filter(club => club.carry > 0);
  const centre = hole.green?.c, greenRing = hole.green?.ring;
  const isGreen = point => greenRing?.length >= 3 && inRing(...point, greenRing);
  const safeLanding = point => environment.landingAllowed(...point) &&
    (environment.landingInset?.(...point) ?? Infinity) >= greenInset &&
    (!greensApproximate || !isGreen(point) || groundDistance(point, centre) < 0.01);
  const clear = (from, to) => environment.clearSegment(from, to) &&
    (groundDistance(from, to) === 0 || (!cutsCorner(from, to, hole) && reader.reachable(from, to)));
  const canStartAt = point => environment.canStartAt?.(point) ?? environment.clearSegment(point, point);
  let graphEnvironment, graphOrigin, graphOrigins = 0;
  function solve(origin, maxCarry) {
    graphOrigin = origin;
    // The tee planner caches visibility by origin coordinates. Periodically
    // release that weak-map key so a stream of unique GPS fixes stays bounded.
    if (!graphEnvironment || graphOrigins >= graphOriginsPerCache) {
      // The shared graph checks the initiating lie before a denser retry.
      // A lie can leave the margin beside a crown; candidate landings still
      // need its full clearance. A sampled vertex has its own point object.
      graphEnvironment = { clearSegment: (a, b) => a === graphOrigin && b === graphOrigin ? canStartAt(a) : clear(a, b),
        landingAllowed: (x, z) => safeLanding([x, z]) };
      graphOrigins = 0;
    }
    graphOrigins++;
    return planGolfShots({ hole, origin, clubs, maxCarry, environment: graphEnvironment });
  }
  function measured(from, point, kind) {
    const { reading, club } = reader.read(from, point);
    return { from, point, kind, reading, club, distance: reading.distance, candidateId: `${kind}:${point[0]},${point[1]}` };
  }
  function result(origin, shots, status = 'playable', anchor = origin) {
    return { status, hole: hole.n, origin, anchor, shots };
  }
  function shortGreenEntry(origin, withinCap) {
    if (greensApproximate || ringSD(...origin, greenRing) >= 15) return null;
    // Only look within chip range. Prefer the deepest safe part of the green
    // the player can see when their path to its centre is obstructed.
    let best = null, bestInset = greenInset;
    for (let x = Math.ceil(origin[0] - 15); x <= origin[0] + 15; x++) {
      for (let z = Math.ceil(origin[1] - 15); z <= origin[1] + 15; z++) {
        const p = [x, z];
        if (groundDistance(origin, p) >= 15 || !withinCap(p)) continue;
        const inset = -ringSD(x, z, greenRing);
        if (inset > bestInset && safeLanding(p) && clear(origin, p)) {
          best = p;
          bestInset = inset;
        }
      }
    }
    return best;
  }
  function recovery(origin, maxCarry) {
    // A player beside a blocked dogleg may need to play sideways or slightly
    // back. Try a few safe entries to this hole, each with a verified onward
    // route from the regular planner. Never escape through an obstructed lie.
    const position = nearestPointOnLine(origin, hole.line);
    if (!position.point || !canStartAt(origin)) return null;
    const fairways = hole.fairway?.rings ?? [];
    const onFairway = fairways.some(ring => inRing(...origin, ring));
    const maxDistance = Math.min(maxCarry ?? Infinity, Math.max(...clubs.map(club => club.carry)));
    const options = [];
    const viable = point => fairways.some(ring => ringSD(...point, ring) <= -greenInset) &&
      !isGreen(point) && safeLanding(point) && clear(origin, point);
    for (const along of [position.along, position.along + 12, position.along - 12, position.along - 24]) {
      const entry = pointAlongLine(hole.line, along);
      if (options.some(point => groundDistance(point, entry) < 1)) continue;
      const distance = groundDistance(origin, entry);
      if (distance < 3 || distance > Math.min(90, maxDistance) || !viable(entry)) continue;
      options.push(entry);
    }
    options.sort((a, b) => groundDistance(origin, a) - groundDistance(origin, b));
    for (const entry of options) {
      const tail = solve(entry);
      if (tail.status === 'playable') return result(origin, [measured(origin, entry, 'landing'),
        ...tail.shots.map(s => measured(s.from, s.point, s.kind))]);
    }
    // If the approach remains blocked, show one checked stroke. It must
    // advance down the hole, or take a golfer in trouble back to fairway turf.
    for (let advance = Math.min(maxDistance, position.total - position.along); advance >= 18; advance -= 10) {
      const entry = pointAlongLine(hole.line, position.along + advance);
      if (groundDistance(origin, entry) <= maxDistance && viable(entry)) {
        return result(origin, [measured(origin, entry, 'landing')], 'recovery');
      }
    }
    if (!onFairway && position.distance >= 12 && options.length) {
      return result(origin, [measured(origin, options[0], 'landing')], 'recovery');
    }
    return null;
  }

  return {
    plan(origin, { tee = false, previous = null } = {}) {
      const empty = status => ({ status, hole: hole.n, origin, shots: [] });
      if (!validPoint(origin) || !validPoint(centre) || !greenRing?.length || !clubs.length) return empty('unavailable');
      if (environment.originAllowed?.(...origin) === false) {
        if (heightAt !== unknownHeight && !Number.isFinite(heightAt(...origin))) {
          return { ...empty('unavailable'), reason: 'unmapped-origin' };
        }
        return empty('blocked');
      }
      if (!greensApproximate && isGreen(origin)) return empty('on-green');
      const cap = tee && String(hole.note ?? '').match(/max(?:imalt)?\s+(\d{2,3})\s*(?:m|meter)/i);
      const maxCarry = cap ? Number(cap[1]) : undefined;
      const withinCap = point => !maxCarry || groundDistance(origin, point) <= maxCarry;
      if (previous && ['playable', 'recovery'].includes(previous.status) && previous.hole === hole.n && validPoint(previous.anchor) &&
          groundDistance(origin, previous.anchor) <= unchangedAimMetres && previous.shots.length &&
          withinCap(previous.shots[0].point) && groundDistance(origin, previous.shots[0].point) > 3) {
        const held = previous.shots.map((shot, index) => ({ from: index ? previous.shots[index - 1].point : origin, point: shot.point, kind: shot.kind }));
        if (held.every(shot => safeLanding(shot.point) && clear(shot.from, shot.point))) {
          return result(origin, held.map(shot => measured(shot.from, shot.point, shot.kind)), previous.status, previous.anchor);
        }
      }
      // Below the tee planner's minimum stroke length a short chip still
      // reaches a verified green centre. A missing ring never grants a landing.
      const toCentre = groundDistance(origin, centre);
      if (greensApproximate && toCentre < 1) return { ...empty('unavailable'), reason: 'approximate-green' };
      if (toCentre > 0 && toCentre < 15 && withinCap(centre) && (greensApproximate || ringSD(...centre, greenRing) <= -greenInset) &&
          safeLanding(centre) && clear(origin, centre)) return result(origin, [measured(origin, centre, 'green')]);
      const graph = solve(origin, maxCarry);
      if (graph.status === 'playable') return result(origin, graph.shots.map(shot => measured(shot.from, shot.point, shot.kind)));
      const chip = shortGreenEntry(origin, withinCap);
      if (chip) return result(origin, [measured(origin, chip, 'green')]);
      return recovery(origin, maxCarry) ?? empty(graph.status);
    },
  };
}
