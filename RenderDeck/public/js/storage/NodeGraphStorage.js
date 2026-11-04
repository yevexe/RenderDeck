import { loadDesignImage } from '../utils/imageAssets.js';
import * as IDBStorage from './indexedDBStorage.js';
import { nodeGraphKey, nodeImageKey } from './storageKeys.js';

export function graphIdentity(key) {
  const split = key.lastIndexOf('|');
  return [key.slice(0, split), key.slice(split + 1)];
}

export async function graphWriteOps(pid, key, graph) {
  const [model, part] = graphIdentity(key);
  const ops = [];
  const imageKeys = new Set();
  const nodes = graph.nodes.map(node => {
    const { _imageEl, _imageBlob, imageDataUrl, ...values } = node.values || {};
    if (_imageBlob || imageDataUrl) {
      values.imageKey = nodeImageKey(pid, model, part, node.id);
      imageKeys.add(values.imageKey);
      ops.push({ type: 'put', store: 'blobs', key: values.imageKey,
        value: _imageBlob || IDBStorage.dataURLToBlobSync(imageDataUrl) });
    } else if (values.imageKey) imageKeys.add(values.imageKey);
    return { ...node, values };
  });
  const prefix = nodeImageKey(pid, model, part, '');
  for (const stored of await IDBStorage.getAllKeys('blobs', prefix)) {
    if (!imageKeys.has(stored)) ops.push({ type: 'del', store: 'blobs', key: stored });
  }
  ops.push({ type: 'put', store: 'node-graphs', key: nodeGraphKey(pid, model, part), value: { ...graph, nodes } });
  return ops;
}

export async function saveNodeGraph(pid, key, graph) {
  await IDBStorage.batch(await graphWriteOps(pid, key, graph));
}

export async function loadNodeGraphs(pid) {
  const graphs = {};
  for (const key of await IDBStorage.getAllKeys('node-graphs', `${pid}:`)) {
    const record = await IDBStorage.get('node-graphs', key);
    const segments = key.slice(pid.length + 1).split(':');
    const model = decodeURIComponent(segments[0]);
    const part = decodeURIComponent(segments.slice(1).join(':'));
    for (const node of record.nodes || []) {
      if (!node.values?.imageKey) continue;
      const blob = await IDBStorage.get('blobs', node.values.imageKey);
      if (blob) {
        node.values._imageBlob = blob;
        node.values.imageDataUrl = await IDBStorage.blobToDataURL(blob);
        node.values._imageEl = await loadDesignImage(node.values.imageDataUrl);
      }
    }
    graphs[`${model}|${part}`] = record;
  }
  return { graphs };
}
