import { layoutLabel } from './course-clubs.mjs';
import { COURSE_LOCATIONS } from './course-places.mjs';
import { metresBetween } from './nearest-course.mjs';

const swedish = new Intl.Collator('sv');

function hasCoordinates(lat, lng) {
  return Number.isFinite(lat) && Math.abs(lat) <= 90 && Number.isFinite(lng) && Math.abs(lng) <= 180;
}

export function sortClubs(clubs, order, { recentSlug, coords } = {}) {
  const origin = { lat: coords?.latitude, lng: coords?.longitude };
  const located = hasCoordinates(origin.lat, origin.lng);
  const recent = order === 'recent' && recentSlug
    ? clubs.find(club => club.courses.some(course => course.slug === recentSlug))
    : null;
  const rows = clubs.map(club => {
    const place = COURSE_LOCATIONS[club.cover.slug];
    const metres = located && hasCoordinates(place?.lat, place?.lng) ? metresBetween(origin, place) : null;
    return { club, metres };
  });

  return rows.sort((a, b) => {
    if (order === 'distance' && a.metres !== b.metres) return (a.metres ?? Infinity) - (b.metres ?? Infinity);
    if (recent && a.club !== b.club) {
      if (a.club === recent) return -1;
      if (b.club === recent) return 1;
    }
    return swedish.compare(a.club.name, b.club.name);
  });
}

export function sortLayouts(courses, order, recentSlug) {
  return [...courses].sort((a, b) => {
    if (order === 'recent' && recentSlug) {
      const priority = Number(b.slug === recentSlug) - Number(a.slug === recentSlug);
      if (priority) return priority;
    }
    return swedish.compare(layoutLabel(a), layoutLabel(b));
  });
}
