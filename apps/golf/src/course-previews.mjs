import lidingo from './data/lidingo-preview.json';
import visby from './data/visby-preview.json';

// Intake courses have no pack or v2 graph. They must never reach loadCourse's
// fallback-to-first-course path or advertise themselves as playable 3D.
export const COURSE_PREVIEWS = Object.freeze([]);
// Retain the original Lidingö source intake for comparison, separately from
// its provisional 3D course. The ordinary course URL now enters the player.
export const coursePreview = slug => ['lidingo', 'visby'].includes(slug) &&
  new URLSearchParams(globalThis.location?.search || '').get('view') === 'sources'
  ? { lidingo, visby }[slug] : COURSE_PREVIEWS.find(course => course.slug === slug);
