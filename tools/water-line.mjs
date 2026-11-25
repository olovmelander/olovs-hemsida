/* WHAT A POND THAT STANDS RIGHT LOOKS LIKE, IN NUMBERS.

   tools/audit-water-levels.mjs measures every water body on the CPU: the level it is drawn at, the ground along its
   own outline, the bank outside it. Read over the 99 lakes and ponds within 100 m of a hole on the ten grounds
   whose water has been looked at and accepted (25 November 2026), two of those numbers hardly vary:

   - the level stands between 0.05 m below and 0.30 m above the ground along the outline (98 of 99). The one that
     does not is a pond on Upsala 4 whose outline misses its basin: 0.33 m below, a quarter of it over water;
   - the level stands at least 0.10 m below the bank outside it (98 of 99). The one that does not is a pond on
     Johannesberg 11 that stands at the very height of its bank.

   So a pond outside those lines is unlike every pond that was accepted, and wants a look: on a new ground before
   anyone has seen a picture, on an old one as a place to start. The lines are advisory. They are drawn from what
   is published, not derived, and they say nothing of the engine: this audit reckons the level itself from the
   ground as flown, so it cannot see the engine reading a level from ground it has already carved, which is what
   stood Bro Hof's ponds 0.75 m low. That still takes a picture. */

export const WATER_LINE = Object.freeze({ reachMetres: 100, belowOutline: -0.10, aboveOutline: 0.35, freeboard: 0.05 });
const signed = metres => `${metres >= 0 ? '+' : ''}${metres.toFixed(2)} m`;

/** The water bodies near play that stand unlike every accepted pond, from audit-water-levels' report (one entry a
 * layout). A ground's water is shared by its routings, so each body is named once, by the routing nearest to it. */
export function waterOffTheLine(report, line = WATER_LINE) {
  const nearest = new Map();
  for (const course of report) for (const body of course.bodies ?? []) {
    if (body.sea || !Number.isFinite(body.boot) || !Number.isFinite(body.ringP50)) continue;
    const key = `${course.ground}:${body.index}`;
    if (!nearest.has(key) || body.holeM < nearest.get(key).body.holeM) nearest.set(key, { course, body });
  }
  const off = [];
  for (const { course, body } of nearest.values()) {
    if (!(body.holeM <= line.reachMetres)) continue;
    const overOutline = body.boot - body.ringP50, why = [];
    if (overOutline < line.belowOutline) why.push(`stands ${signed(overOutline)} from the ground along its own outline: the outline may miss its basin`);
    if (overOutline > line.aboveOutline) why.push(`stands ${signed(overOutline)} from the ground along its own outline: it would flood past it`);
    if (Number.isFinite(body.freeboard) && body.freeboard < line.freeboard) why.push(`stands at the height of its bank (${body.freeboard.toFixed(2)} m below it)`);
    if (why.length) off.push({ ground: course.ground, slug: course.slug, index: body.index, areaM2: body.areaM2, hole: body.nearHole, metresFromHole: body.holeM, why: why.join('; ') });
  }
  return off.sort((a, b) => a.ground.localeCompare(b.ground) || a.index - b.index);
}

export const waterLine = body => `${body.slug} water ${body.index} (${body.areaM2} m2, ${body.metresFromHole} m from hole ${body.hole}): ${body.why}`;
