import { describe, expect, it } from 'vitest';
import { clubLayouts, groupCourses, preferredLayout } from './course-clubs.mjs';

const course = (slug, name = slug) => ({ slug, name });
const COURSES = [course('angso'), course('bro-hof-castle'), course('upsala-mellanbanan'), course('bro-hof-stadium'), course('upsala'),
  course('veckefjarden-korthalsbanan'), course('veckefjarden'), course('johannesberg-9'), course('johannesberg')];

describe('a club and its layouts', () => {
  it('lists the host course first, then the others by name, whichever layout asks', () => {
    for (const slug of ['bro-hof-castle', 'bro-hof-stadium']) {
      expect(clubLayouts(COURSES, slug).map(c => c.slug)).toEqual(['bro-hof-stadium', 'bro-hof-castle']);
    }
    expect(clubLayouts(COURSES, 'upsala-mellanbanan').map(c => c.slug)).toEqual(['upsala', 'upsala-mellanbanan']);
    expect(clubLayouts(COURSES, 'veckefjarden').map(c => c.slug)).toEqual(['veckefjarden', 'veckefjarden-korthalsbanan']);
    expect(clubLayouts(COURSES, 'johannesberg-9').map(c => c.slug)).toEqual(['johannesberg', 'johannesberg-9']);
    expect(clubLayouts(COURSES, 'angso').map(c => c.slug)).toEqual(['angso']);
    expect(groupCourses(COURSES).find(g => g.id === 'bro-hof').courses).toHaveLength(2);
  });

  it('opens a club on its game under way, else the layout last chosen there, else the host course', () => {
    const layouts = clubLayouts(COURSES, 'bro-hof-stadium');
    const castle = layouts.find(c => c.slug === 'bro-hof-castle');
    expect(preferredLayout(layouts)).toBe('bro-hof-stadium');
    expect(preferredLayout(layouts, { remembered: 'bro-hof-castle' })).toBe('bro-hof-castle');
    expect(preferredLayout(layouts, { remembered: 'visby' }), 'a layout of another club is ignored').toBe('bro-hof-stadium');
    expect(preferredLayout(layouts, { sessions: [{ course: castle }], remembered: 'bro-hof-stadium' })).toBe('bro-hof-castle');
    expect(preferredLayout(layouts, { sessions: [{ course: course('visby') }] })).toBe('bro-hof-stadium');
    expect(preferredLayout([])).toBe(null);
  });
});
