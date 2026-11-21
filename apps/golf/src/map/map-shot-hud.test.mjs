import { describe, expect, it } from 'vitest';
import { measurementTargets, shotHud } from './map-shot-hud.mjs';

const box = (x, y) => [[x - 5, y - 5], [x - 5, y + 5], [x + 5, y + 5], [x + 5, y - 5]];
const hole = { green: { c: [100, 100], ring: box(100, 100) }, fairways: [box(100, 0)] };
const club = { id: 'i7', name: 'Järn 7' };
const auto = { mode: 'auto', status: 'playable', source: 'gps', target: [100, 0], legs: [{}, {}],
  selectedClub: club, recommendedClub: club, reachable: true, reading: { distance: 100, plays: 100.4, rise: -0.4, head: 0, cross: 0 } };

describe('next shot on the play screen', () => {
  it('identifies a mapped landing, gives its distance first and suppresses rounded-zero adjustments', () => {
    expect(shotHud(auto, hole)).toEqual({ title: 'Nästa slag · Fairway', source: 'Från dig · GPS',
      distance: '100 m', club: 'Järn 7', detail: '100 m kvar', conditions: '' });
    expect(shotHud({ ...auto, target: [30, 30] }, hole).title).toBe('Nästa slag');
    expect(shotHud({ ...auto, target: hole.green.c }, hole, { approximateGreen: true }).title).toContain('Ungefärlig green');
  });
  it('shows the pinned target, manual choice, recommended club and last safe origin separately', () => {
    const pinned = { ...auto, mode: 'manual', target: hole.green.c, source: 'last-gps', selectedClub: { name: 'Driver' },
      reading: { distance: 197.2, plays: 203.7, rise: 2.7, head: 5.2, cross: 0.4 }, reachable: false };
    expect(shotHud(pinned, hole, { manualClub: true })).toEqual({ title: 'Mätpunkt · Green', source: 'Senaste säkra GPS',
      distance: '197 m', club: 'Vald · Driver', detail: 'Spelas 204 m · Utanför räckvidd · Förslag: Järn 7', conditions: '3 m uppför · motvind 5 m/s' });
  });
  it('distinguishes unavailable data, a blocked path and putting without a phantom distance', () => {
    const none = { ...auto, source: 'tee', target: null, reading: null, selectedClub: null };
    expect(shotHud({ ...none, status: 'blocked' }, hole)).toMatchObject({ title: 'Ingen säker slagväg', source: 'Från tee', distance: '', detail: 'Tryck för att mäta' });
    expect(shotHud({ ...none, status: 'unavailable' }, hole).title).toBe('Bandata saknas');
    expect(shotHud({ ...none, status: 'on-green', selectedClub: { name: 'Putter' } }, hole)).toMatchObject({ title: 'På green', distance: '', club: 'Putter' });
  });
  it('offers keyboard targets along the dogleg from the walking position and at actual landmarks', () => {
    expect(measurementTargets(hole, [[0, 0], [100, 0], [100, 100]], [60, 0], [{ kind: 'bunker', at: [90, 0] }])).toEqual([
      { label: 'Greenens mitt', point: [100, 100] }, { label: 'Spellinjen, 50 m framåt', point: [100, 10] },
      { label: 'Spellinjen, 100 m framåt', point: [100, 60] }, { label: 'Bunker, 30 m', point: [90, 0] },
    ]);
  });
});
