import { HOST_CLUB } from './course-places.mjs';

// Club keys are catalogue identities. A layout slug still owns its round,
// tee, saved data, pack and deep links.
export function clubIdFor(slug) {
  const host = HOST_CLUB[slug] ?? slug;
  return host === 'bro-hof-stadium' ? 'bro-hof' : host;
}

const LAYOUT_LABELS = {
  'bro-hof-stadium': 'The Stadium Course',
  'bro-hof-castle': 'The Castle Course',
  upsala: 'Stora banan',
  johannesberg: '18-hålsbanan',
  'johannesberg-9': 'Niohålsbanan',
  veckefjarden: 'Mästerskapsbanan',
};

export function layoutLabel(course) {
  return LAYOUT_LABELS[course.slug] ?? course.name;
}

export function groupCourses(courses) {
  const groups = new Map();
  for (const course of courses) {
    const id = clubIdFor(course.slug);
    if (!groups.has(id)) groups.set(id, { id, name: course.club || course.name, courses: [], cover: course });
    const group = groups.get(id);
    group.courses.push(course);
    if (!HOST_CLUB[course.slug]) group.cover = course;
  }
  return [...groups.values()];
}

/* The layouts of one club in the club page's order: the host's own course first,
   then by name. A segmented control keeps its order; sorting by use would move a
   layout from under a thumb. */
export function clubLayouts(courses, slug) {
  const id = clubIdFor(slug);
  return courses.filter(course => clubIdFor(course.slug) === id)
    .sort((a, b) => Number(Boolean(HOST_CLUB[a.slug])) - Number(Boolean(HOST_CLUB[b.slug]))
      || layoutLabel(a).localeCompare(layoutLabel(b), 'sv'));
}

/* The layout last chosen at a club, kept by the club page and its launches. */
export const CLUB_LAYOUT_KEY = 'banvy-club-layout-v1';

/* Which layout a club opens on: the one with a game under way (sessions newest
   first, already narrowed to the mode), else the one last chosen there, else the
   host's own course. */
export function preferredLayout(layouts, { sessions = [], remembered = null } = {}) {
  const live = sessions.find(session => layouts.some(course => course.slug === session.course.slug));
  if (live) return live.course.slug;
  if (layouts.some(course => course.slug === remembered)) return remembered;
  return (layouts.find(course => !HOST_CLUB[course.slug]) ?? layouts[0])?.slug ?? null;
}
