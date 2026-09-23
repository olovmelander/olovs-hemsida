/* The chooser's "Hitta min bana": one position fix, the course it stands on,
   and straight into that course with GPS mode already running. Loaded only
   when the button is pressed, so the front door fetches none of this.

   The decision is chooseCourse's, the same rule GPS mode applies on every fix
   inside a course, so the chooser and the player cannot disagree about where
   somebody is. */
import { rankCourses, chooseCourse, formatDistance } from '../engine/gps-round.mjs';
import { writeGpsHandoff } from './gps-handoff.js';
import { goToCourse } from './router.js';

function position() {
  return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, {
    /* a fix from the last half minute is as good as a new one for choosing a
       course, and on a phone that has just been in a pocket it is instant */
    enableHighAccuracy: true, maximumAge: 30000, timeout: 20000,
  }));
}

/* Resolves with what to tell the player when they are NOT being taken to a
   course (the navigation itself is the answer when they are). */
export async function locateAndOpen(courses) {
  if (!navigator.geolocation) return 'Den här webbläsaren saknar platsåtkomst';
  let fix;
  try { fix = await position(); }
  catch (error) {
    return error?.code === 1 ? 'Platsåtkomst nekades · tillåt plats i webbläsaren'
      : error?.code === 3 ? 'GPS svarade inte · försök igen utomhus'
        : 'Ingen position hittades · försök igen';
  }
  const accuracy = Number.isFinite(fix.coords.accuracy) ? fix.coords.accuracy : 0;
  const ranked = rankCourses(fix.coords, courses);
  const choice = chooseCourse(ranked, { current: null, accuracy });
  if (choice) {
    writeGpsHandoff({ from: null, to: choice.slug, hole: choice.hole });
    goToCourse(choice.slug, { hole: choice.hole });
    return `Du är på ${choice.name} · öppnar hål ${choice.hole}`;
  }
  const nearest = ranked[0];
  if (nearest && nearest.distance <= 450) {
    return `Positionen är för osäker (±${Math.round(accuracy)} m) · försök igen utomhus`;
  }
  return nearest ? `Ingen bana här · närmast är ${nearest.name}, ${formatDistance(nearest.distance)} bort`
    : 'Ingen bana i närheten';
}
