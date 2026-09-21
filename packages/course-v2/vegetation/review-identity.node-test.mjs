import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewHoleEntries } from './review-identity.mjs';

const geometry = numbers => ({ holes: numbers.map(n => ({ n })) });

test('single-layout review images retain their established names', () => {
  assert.deepEqual(reviewHoleEntries([{ slug: 'puttom', geometry: geometry([1, 18]) }]).map(x => x.file),
    ['hole-01.png', 'hole-18.png']);
});

test('shared-ground layouts receive stable course-qualified image names', () => {
  const entries = reviewHoleEntries([
    { slug: 'johannesberg', geometry: geometry([1, 2]) },
    { slug: 'johannesberg-9', geometry: geometry([1, 2]) },
  ]);
  assert.deepEqual(entries.map(x => x.file), [
    'johannesberg-hole-01.png', 'johannesberg-hole-02.png',
    'johannesberg-9-hole-01.png', 'johannesberg-9-hole-02.png',
  ]);
  assert.equal(new Set(entries.map(x => x.file)).size, 4);
});

test('invalid identities and duplicate hole numbers fail closed', () => {
  assert.throws(() => reviewHoleEntries([{ slug: '../unsafe', geometry: geometry([1]) }]));
  assert.throws(() => reviewHoleEntries([{ slug: 'course', geometry: geometry([1, 1]) }]), /collision/);
});
