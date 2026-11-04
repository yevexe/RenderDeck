const LONG_TEXT = 256 * 1024;
const IMAGE_VALUE_FIELDS = new Set(['channelMaps', 'imageData', 'imageDataUrl']);
const BINARY_KINDS = {
  ArrayBuffer, Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array,
  Int32Array, Uint32Array, Float32Array, Float64Array, DataView,
};

function swap(text, from, to) {
  return from && to && text.includes(from) ? text.split(from).join(to) : text;
}

function extensionOf(blob) {
  const fromName = /\.([a-z0-9]{1,8})$/i.exec(blob.name || '')?.[1];
  const fromType = /^[a-z]+\/([a-z0-9]{1,8})$/i.exec(blob.type || '')?.[1];
  return (fromName || fromType || 'bin').toLowerCase();
}

export function createZipAttachmentAdapter() {
  const attachments = [];
  const attach = (path, data, compress = false) => {
    attachments.push({ path, data, compress });
    return path;
  };
  return {
    attachments,
    encodeText: bytes => ({ $rdText: attach(`blobs/${attachments.length}.txt`, bytes, true) }),
    encodeFile: (blob, metadata) => ({
      $rdFile: {
        path: attach(`blobs/${attachments.length}.${extensionOf(blob)}`, blob),
        type: metadata.type,
        name: metadata.name,
        lastModified: metadata.lastModified,
      },
    }),
    encodeBinary: (bytes, kind) => ({
      $rdBinary: { path: attach(`blobs/${attachments.length}.bin`, bytes), kind },
    }),
    decodeText: async (marker, entries) => entryBytes(entries, marker),
    decodeFile: async (marker, entries) => entryBytes(entries, marker.path),
    decodeBinary: async (marker, entries) => entryBytes(entries, marker.path),
  };
}

export function createSha256AttachmentAdapter(readAttachment) {
  if (typeof readAttachment !== 'function') {
    throw new TypeError('readAttachment must be a function');
  }
  const attachments = [];
  const attach = async (data, marker) => {
    const bytes = await bytesOf(data);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const sha256 = [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
    attachments.push({ sha256, data });
    return marker(sha256);
  };
  const read = async marker => bytesOf(await readAttachment(marker.sha256, marker));
  return {
    attachments,
    encodeText: bytes => attach(bytes, sha256 => ({ $rdText: { sha256 } })),
    encodeFile: (blob, metadata) => attach(blob, sha256 => ({
      $rdFile: { sha256, ...metadata },
    })),
    encodeBinary: (bytes, kind) => attach(bytes, sha256 => ({
      $rdBinary: { sha256, kind },
    })),
    decodeText: read,
    decodeFile: read,
    decodeBinary: read,
  };
}

export function createRecordEncoder({
  pid,
  includeImages = true,
  swapFrom = pid,
  swapTo = '{pid}',
  attachmentAdapter = createZipAttachmentAdapter(),
} = {}) {
  async function encode(value) {
    if (typeof value === 'string') {
      if (!value.startsWith('data:')) return swap(value, swapFrom, swapTo);
      if (value.length <= LONG_TEXT) return value;
      return attachmentAdapter.encodeText(new TextEncoder().encode(value));
    }
    if (typeof value === 'number' && !Number.isFinite(value)) return { $rdNumber: String(value) };
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      const output = [];
      for (const item of value) output.push(await encode(item));
      return output;
    }
    if (value instanceof Date) return { $rdDate: value.getTime() };
    if (value instanceof Blob) {
      return attachmentAdapter.encodeFile(value, {
        type: value.type,
        name: value.name ?? null,
        lastModified: value.lastModified ?? null,
      });
    }
    if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
      const bytes = value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      return attachmentAdapter.encodeBinary(bytes, value.constructor.name);
    }
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new Error(`A ${value.constructor?.name ?? 'stored'} value can't be encoded`);
    }
    const output = {};
    for (const [key, item] of Object.entries(value)) {
      if (!includeImages && IMAGE_VALUE_FIELDS.has(key)) continue;
      output[swap(key, swapFrom, swapTo)] = await encode(item);
    }
    return output;
  }

  return {
    encode,
    attachments: attachmentAdapter.attachments,
    attachmentAdapter,
  };
}

export async function encodeRecords(records, options = {}) {
  const encoder = createRecordEncoder(options);
  const swapFrom = Object.hasOwn(options, 'swapFrom') ? options.swapFrom : options.pid;
  const swapTo = Object.hasOwn(options, 'swapTo') ? options.swapTo : '{pid}';
  const encoded = [];
  for (const { store, key, value } of records) {
    encoded.push({
      store,
      key: swap(key, swapFrom, swapTo),
      value: await encoder.encode(value),
    });
  }
  return { encoder, records: encoded };
}

export async function decodeRecordValue(value, {
  pid,
  swapFrom = '{pid}',
  swapTo = pid,
  attachmentAdapter = createZipAttachmentAdapter(),
  entries = {},
} = {}) {
  if (typeof value === 'string') return value.startsWith('data:') ? value : swap(value, swapFrom, swapTo);
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const output = [];
    for (const item of value) output.push(await decodeRecordValue(item, { pid, swapFrom, swapTo, attachmentAdapter, entries }));
    return output;
  }
  if (value.$rdText !== undefined) {
    const bytes = await attachmentAdapter.decodeText(value.$rdText, entries);
    return new TextDecoder().decode(bytes);
  }
  if (value.$rdNumber !== undefined) return Number(value.$rdNumber);
  if (value.$rdDate !== undefined) return new Date(value.$rdDate);
  if (value.$rdFile) {
    const { type, name, lastModified } = value.$rdFile;
    const bytes = await attachmentAdapter.decodeFile(value.$rdFile, entries);
    return name === null
      ? new Blob([bytes], { type })
      : new File([bytes], name, { type, lastModified });
  }
  if (value.$rdBinary) {
    const { kind } = value.$rdBinary;
    const Kind = Object.hasOwn(BINARY_KINDS, kind) ? BINARY_KINDS[kind] : null;
    if (!Kind) throw new Error(`The encoded record has an unknown binary type ${kind}`);
    const bytes = await attachmentAdapter.decodeBinary(value.$rdBinary, entries);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return Kind === ArrayBuffer ? buffer : new Kind(buffer);
  }

  const output = {};
  for (const [key, item] of Object.entries(value)) {
    output[swap(key, swapFrom, swapTo)] = await decodeRecordValue(item, {
      pid, swapFrom, swapTo, attachmentAdapter, entries,
    });
  }
  return output;
}

function entryBytes(entries, path) {
  const bytes = entries[path];
  if (!bytes) throw new Error(`The encoded record is missing attachment ${path}`);
  return bytes;
}

async function bytesOf(data) {
  if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  throw new TypeError('Attachment data must be a Blob, ArrayBuffer, or typed array');
}
