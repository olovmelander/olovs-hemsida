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
