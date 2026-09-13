import { CourseChunkSource } from '../../../../packages/course-v2/runtime/course-chunk-source.mjs';
import { ChunkWorkerClient } from '../../../../packages/course-v2/runtime/worker-client.mjs';

export async function createCourseChunkSource({ graph, startup, baseUrl }) {
  const worker = new Worker(new URL('../../../../packages/course-v2/runtime/chunk-worker-entry.mjs', import.meta.url),
    { type: 'module', name: 'banvy-course-startup' });
  const source = new CourseChunkSource({ graph, baseUrl, workerClient: new ChunkWorkerClient(worker) });
  try { return await source.initialize(startup); }
  catch (error) { source.dispose(); throw error; }
}
