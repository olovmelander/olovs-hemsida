import { nearestPointOnLine, pointAlongLine } from '../engine/caddie.js';
import { groundDistance, windWords } from './map-measure.mjs';
import { surfaceAt } from './map-shots.mjs';

const metres = value => `${Math.round(value)} m`;
const surfaces = { fairway: 'Fairway', green: 'Green', bunker: 'Bunker', tee: 'Tee', water: 'Vatten' };
const sources = { gps: 'Från dig · GPS', 'last-gps': 'Senaste säkra GPS', tee: 'Från tee' };

export function shotHud(shot, hole, { approximateGreen = false, waters = [], manualClub = false } = {}) {
  const pinned = shot.mode === 'manual';
  const source = sources[shot.source];
  let terrain = '';
  if (shot.target) {
    const surface = surfaceAt(shot.target, hole, waters);
    terrain = surface === 'green' && approximateGreen ? 'Ungefärlig green' : surfaces[surface] ?? '';
  }
  const stateTitle = { loading: 'Beräknar slagförslag…', blocked: 'Ingen säker slagväg', unavailable: 'Bandata saknas', 'on-green': 'På green' };
  const title = shot.target
    ? [pinned ? 'Mätpunkt' : 'Nästa slag', terrain].filter(Boolean).join(' · ')
    : stateTitle[shot.status] ?? 'Ingen säker slagväg';
  const reading = shot.reading;
  const distance = reading ? metres(reading.distance) : '';
  const club = shot.selectedClub ? (manualClub ? 'Vald · ' : '') + shot.selectedClub.name : '';
  const details = [], conditions = [];
  if (reading) {
    if (Number.isFinite(reading.plays) && Math.round(reading.plays) !== Math.round(reading.distance)) details.push(`Spelas ${metres(reading.plays)}`);
    const left = Math.round(groundDistance(shot.target, hole.green.c));
    if ((pinned || shot.legs.length > 1) && left > 0) details.push(`${left} m kvar`);
    const rise = Math.round(Math.abs(reading.rise));
    if (rise > 0) conditions.push(`${rise} m ${reading.rise > 0 ? 'uppför' : 'nedför'}`);
    conditions.push(...windWords(reading));
    if (pinned && !shot.reachable) details.push('Utanför räckvidd');
  } else if (shot.status === 'blocked') details.push('Tryck för att mäta');
  const choice = manualClub && shot.recommendedClub ? `Förslag: ${shot.recommendedClub.name}` : '';
  if (choice) details.push(choice);
  return { title, source, distance, club, detail: details.join(' · '), conditions: conditions.join(' · ') };
}

/* Landmark choices use the same world coordinates as a tap on the terrain. */
export function measurementTargets(hole, path, origin, hazards) {
  const choices = [{ label: 'Greenens mitt', point: hole.green.c }];
  const { along, total } = nearestPointOnLine(origin, path);
  for (const ahead of [50, 100, 150, 200]) {
    if (along + ahead < total - 10) choices.push({ label: `Spellinjen, ${ahead} m framåt`, point: pointAlongLine(path, along + ahead) });
  }
  for (const hazard of hazards) {
    const distance = metres(groundDistance(origin, hazard.at));
    choices.push({ label: `${hazard.kind === 'water' ? 'Vatten' : 'Bunker'}, ${distance}`, point: hazard.at });
  }
  return choices;
}
