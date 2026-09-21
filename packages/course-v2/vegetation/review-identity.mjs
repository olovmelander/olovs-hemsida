/** Stable, collision-free vegetation review image identities for a ground. */
export function reviewHoleEntries(courses) {
  if (!Array.isArray(courses) || !courses.length) throw new TypeError('at least one course geometry is required');
  const includeSlug = courses.length > 1;
  const entries = courses.flatMap(course => {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(course.slug)) throw new Error(`unsafe course slug: ${course.slug}`);
    return (course.geometry.holes || []).map(hole => {
      if (!Number.isInteger(hole.n) || hole.n < 1) throw new Error(`invalid hole number for ${course.slug}`);
      const stem = `hole-${String(hole.n).padStart(2, '0')}`;
      return Object.freeze({ slug: course.slug, hole, file: `${includeSlug ? `${course.slug}-` : ''}${stem}.png` });
    });
  });
  const files = entries.map(entry => entry.file);
  if (new Set(files).size !== files.length) throw new Error('vegetation review image filename collision');
  return Object.freeze(entries);
}
