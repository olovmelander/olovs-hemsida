/* The golden view matrix and the course list, with no side effects: goldens.mjs
   is a script that captures them the moment it is imported, so anything that
   only wants the LIST imports this file instead. */
export const GOLDEN_VIEWS = [
  { id: '01_h1_tee_kvall', hole: 1, cam: 'tee', preset: 'golden' },
  { id: '02_h1_green_kvall', hole: 1, cam: 'green', preset: 'golden' },
  { id: '03_h1_fritt_kvall', hole: 1, cam: 'orbit', preset: 'golden' },
  { id: '04_h1_ovan_dag', hole: 1, cam: 'top', preset: 'noon' },
  { id: '05_h2_tee_dag', hole: 2, cam: 'tee', preset: 'noon' },
  { id: '06_h5_tee_kvall', hole: 5, cam: 'tee', preset: 'golden' },
  { id: '07_h9_green_kvall', hole: 9, cam: 'green', preset: 'golden' },
  { id: '08_h10_tee_dag', hole: 10, cam: 'tee', preset: 'noon' },
  { id: '09_h13_tee_kvall', hole: 13, cam: 'tee', preset: 'golden' },
  { id: '10_h14_green_kvall', hole: 14, cam: 'green', preset: 'golden' },
  { id: '11_h18_tee_dag', hole: 18, cam: 'tee', preset: 'noon' },
  { id: '12_h18_green_kvall', hole: 18, cam: 'green', preset: 'golden' },
];

export const COURSES = ['angso', 'johannesberg', 'norrfallsviken', 'puttom', 'upsala', 'veckefjarden'];
