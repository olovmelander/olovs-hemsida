/* Zero bloom strength still runs the bloom passes in Three r185. The runtime
   fallback already turns bloom off, so use the app's direct render path then.
   Keep the existing resources: the caller owns their lifetime. */
export function renderActivePipeline(renderer, scene, camera, lowfx) {
  if (renderer.__post && !lowfx) renderer.__post.render();
  else renderer.render(scene, camera);
}
