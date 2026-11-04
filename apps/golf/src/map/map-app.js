/* The map mode's route. One step further than it looks necessary: everything that
   reads the v2 course data must stay behind a dynamic import of a route, so that
   a visit which never opens a course fetches none of it
   (packages/course-v2/check-app-build.mjs holds the rule). */
await import('./map-session.js');
