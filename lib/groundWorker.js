// Builds the ground mesh off the main thread. Latest request wins; stale ids are ignored by the caller.
import { buildGroundArrays } from './ground.js';

self.onmessage = ({ data: { id, scene, occluders } }) => {
  const a = buildGroundArrays(scene, { occluders });
  self.postMessage({ id, ...a }, [a.position.buffer, a.color.buffer, a.index.buffer, a.mask.buffer]);
};
