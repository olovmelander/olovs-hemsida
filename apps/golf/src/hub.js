import { buildRail } from './shell/rail.js';
import { goToCourse } from './shell/router.js';

const boot = document.getElementById('boot');
const message = document.getElementById('bmsg');
const bar = document.querySelector('#bar i');

try {
  if (message) message.textContent = 'laddar banor';
  if (bar) bar.style.width = '45%';
  const response = await fetch('/courses/index.json');
  if (!response.ok) throw new Error(`course manifest ${response.status}`);
  const manifest = await response.json();
  const courses = manifest.courses || [];
  const prefetched = new Set();

  const chooser = buildRail({
    courses,
    current: null,
    isInitialBoot: true,
    onPick: goToCourse,
    onIntent: slug => {
      if (prefetched.has(slug)) return;
      prefetched.add(slug);
      const course = courses.find(c => c.slug === slug);
      if (course?.packUrl) fetch(course.packUrl).catch(() => {});
    },
  });
  document.body.append(chooser);
  document.title = 'Banvy 3D — Svenska golfbanor i realtid';
  if (bar) bar.style.width = '100%';
  if (message) message.textContent = 'klar';
  requestAnimationFrame(() => boot?.classList.add('done'));
} catch (error) {
  if (message) message.textContent = `kunde inte ladda banorna: ${error.message}`;
}
