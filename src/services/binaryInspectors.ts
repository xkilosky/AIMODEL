import type { ParsedModelSpecs } from '../types/local';

const GGUF_FILE_TYPES: Record<number, string> = {
  0: 'F32',
  1: 'F16',
  2: 'Q4_0',
  3: 'Q4_1',
  7: 'Q8_0',
  8: 'Q5_0',
  9: 'Q5_1',
  10: 'Q2_K',
  11: 'Q3_K_S',
  12: 'Q3_K_M',
  13: 'Q3_K_L',
  14: 'Q4_K_S',
  15: 'Q4_K_M',
  16: 'Q5_K_S',
  17: 'Q5_K_M',
  18: 'Q6_K',
  19: 'IQ2_XXS',
  20: 'IQ2_XS',
  21: 'Q2_K_S',
  22: 'IQ3_XS',
  23: 'IQ3_XXS',
  24: 'IQ1_S',
  25: 'IQ4_NL',
  26: 'IQ3_S',
  27: 'IQ3_M',
  28: 'IQ2_S',
  29: 'IQ2_M',
  30: 'IQ4_XS',
  31: 'IQ1_M',
  32: 'BF16',
};

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const idx = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, idx);
  return `${val >= 100 || idx === 0 ? val.toFixed(0) : val.toFixed(1)} ${units[idx]}`;
}

export function formatParamCount(params: number): string {
  if (!Number.isFinite(params) || params <= 0) return 'Unknown';
  if (params >= 1e9) return `${(params / 1e9).toFixed(2)}B`;
  if (params >= 1e6) return `${(params / 1e6).toFixed(1)}M`;
  if (params >= 1e3) return `${(params / 1e3).toFixed(1)}K`;
  return String(params);
}

export function inferQuantFromFilename(filename: string): string | undefined {
  const match = filename.match(
    /\b(IQ[1-4]_[A-Z]+|Q[2-8]_[01KM](?:_[SML])?|BF16|FP16|F16|F32|INT8|INT4|Q4F16)\b/i
  );
  return match ? match[1].toUpperCase() : undefined;
}

/**
 * Parses the binary header of a .gguf file by slicing only the first 512 KB.
 * Zero full-file memory allocation — works instantaneously even on 4 GB+ GGUF files.
 */
export async function inspectGgufHeader(blob: Blob, fileName: string): Promise<ParsedModelSpecs> {
  const sliceSize = Math.min(blob.size, 512 * 1024);
  const buf = await blob.slice(0, sliceSize).arrayBuffer();
  const view = new DataView(buf);
  const decoder = new TextDecoder('utf-8', { fatal: false });

  if (buf.byteLength < 24) {
    return {
      format: 'GGUF',
      quantization: inferQuantFromFilename(fileName),
    };
  }

  const magic =
    String.fromCharCode(view.getUint8(0)) +
    String.fromCharCode(view.getUint8(1)) +
    String.fromCharCode(view.getUint8(2)) +
    String.fromCharCode(view.getUint8(3));

  if (magic !== 'GGUF') {
    throw new Error('Selected file does not have a valid GGUF magic header.');
  }

  const version = view.getUint32(4, true);
  let offset = 8;

  const readUint64 = (): number => {
    if (offset + 8 > view.byteLength) throw new RangeError('EOF');
    const low = view.getUint32(offset, true);
    const high = view.getUint32(offset + 4, true);
    offset += 8;
    return high * 4294967296 + low;
  };

  const readString = (): string => {
    const len = readUint64();
    if (len > 65536 || offset + len > view.byteLength) {
      offset += len;
      if (offset > view.byteLength) throw new RangeError('String exceeds header slice');
      return '[large-value]';
    }
    const str = decoder.decode(new Uint8Array(buf, offset, len));
    offset += len;
    return str;
  };

  const skipOrReadValue = (valType: number, depth = 0): unknown => {
    if (depth > 3 || offset >= view.byteLength) throw new RangeError('Bounds');
    switch (valType) {
      case 0: {
        const v = view.getUint8(offset);
        offset += 1;
        return v;
      }
      case 1: {
        const v = view.getInt8(offset);
        offset += 1;
        return v;
      }
      case 2: {
        const v = view.getUint16(offset, true);
        offset += 2;
        return v;
      }
      case 3: {
        const v = view.getInt16(offset, true);
        offset += 2;
        return v;
      }
      case 4: {
        const v = view.getUint32(offset, true);
        offset += 4;
        return v;
      }
      case 5: {
        const v = view.getInt32(offset, true);
        offset += 4;
        return v;
      }
      case 6: {
        const v = view.getFloat32(offset, true);
        offset += 4;
        return v;
      }
      case 7: {
        const v = view.getUint8(offset) !== 0;
        offset += 1;
        return v;
      }
      case 8:
        return readString();
      case 9: {
        const elemType = view.getUint32(offset, true);
        offset += 4;
        const arrLen = readUint64();
        if (arrLen > 512) {
          // Large array (e.g., tokenizer.ggml.tokens) — record its length as vocab size and stop walking
          throw Object.assign(new RangeError('LargeArray'), { arrayLength: arrLen });
        }
        const out: unknown[] = [];
        for (let i = 0; i < arrLen; i++) {
          out.push(skipOrReadValue(elemType, depth + 1));
        }
        return out;
      }
      case 10:
      case 11:
        return readUint64();
      case 12: {
        const v = view.getFloat64(offset, true);
        offset += 8;
        return v;
      }
      default:
        throw new RangeError('Unknown GGUF type');
    }
  };

  let tensorCount = 0;
  let kvCount = 0;
  const meta: Record<string, unknown> = {};
  let detectedVocabSize: number | undefined;

  try {
    tensorCount = version >= 2 ? readUint64() : view.getUint32((offset += 4) - 4, true);
    kvCount = version >= 2 ? readUint64() : view.getUint32((offset += 4) - 4, true);

    const maxToScan = Math.min(kvCount, 128);
    for (let i = 0; i < maxToScan; i++) {
      const key = readString();
      const valType = view.getUint32(offset, true);
      offset += 4;
      try {
        meta[key] = skipOrReadValue(valType);
      } catch (innerErr: unknown) {
        if (
          innerErr &&
          typeof innerErr === 'object' &&
          'arrayLength' in innerErr &&
          key.includes('tokens')
        ) {
          detectedVocabSize = Number((innerErr as { arrayLength: number }).arrayLength);
        }
        break;
      }
    }
  } catch {
    // Reached end of 512 KB header slice cleanly after reading top KV items
  }

  const arch = typeof meta['general.architecture'] === 'string' ? meta['general.architecture'] : undefined;
  const modelName = typeof meta['general.name'] === 'string' ? meta['general.name'] : undefined;
  const sizeLabel = typeof meta['general.size_label'] === 'string' ? meta['general.size_label'] : undefined;
  const fileTypeNum = typeof meta['general.file_type'] === 'number' ? meta['general.file_type'] : undefined;
  const quantFromMeta = fileTypeNum !== undefined ? GGUF_FILE_TYPES[fileTypeNum] : undefined;

  const ctxKey = arch ? `${arch}.context_length` : '';
  const blockKey = arch ? `${arch}.block_count` : '';
  const embdKey = arch ? `${arch}.embedding_length` : '';
  const vocabKey = arch ? `${arch}.vocab_size` : '';

  return {
    format: 'GGUF',
    ggufVersion: version,
    tensorCount: tensorCount || undefined,
    architecture: arch,
    modelName,
    parameterCount: sizeLabel,
    quantization: quantFromMeta || inferQuantFromFilename(fileName),
    contextLength: typeof meta[ctxKey] === 'number' ? (meta[ctxKey] as number) : undefined,
    layers: typeof meta[blockKey] === 'number' ? (meta[blockKey] as number) : undefined,
    embeddingSize: typeof meta[embdKey] === 'number' ? (meta[embdKey] as number) : undefined,
    vocabSize:
      typeof meta[vocabKey] === 'number'
        ? (meta[vocabKey] as number)
        : detectedVocabSize,
    hasChatTemplate: typeof meta['tokenizer.chat_template'] === 'string',
  };
}

/**
 * Parses the binary JSON header of a HuggingFace .safetensors file.
 */
export async function inspectSafetensorsHeader(
  blob: Blob,
  fileName: string
): Promise<ParsedModelSpecs> {
  if (blob.size < 16) {
    return { format: 'Safetensors', quantization: inferQuantFromFilename(fileName) };
  }
  const lenBuf = await blob.slice(0, 8).arrayBuffer();
  const lenView = new DataView(lenBuf);
  const low = lenView.getUint32(0, true);
  const high = lenView.getUint32(4, true);
  const headerLen = high * 4294967296 + low;

  if (headerLen <= 0 || headerLen > 16 * 1024 * 1024 || 8 + headerLen > blob.size) {
    return { format: 'Safetensors', quantization: inferQuantFromFilename(fileName) };
  }

  const jsonText = await blob.slice(8, 8 + headerLen).text();
  const parsed = JSON.parse(jsonText) as Record<
    string,
    { dtype?: string; shape?: number[]; format?: string }
  >;

  let tensorCount = 0;
  let totalParams = 0;
  let maxLayer = -1;
  const dtypes = new Set<string>();

  for (const [key, info] of Object.entries(parsed)) {
    if (key === '__metadata__') continue;
    tensorCount++;
    if (info?.dtype) dtypes.add(info.dtype);
    if (Array.isArray(info?.shape)) {
      const prod = info.shape.reduce((acc, dim) => acc * (dim || 1), 1);
      totalParams += prod;
    }
    const layerMatch = key.match(/(?:layers|blocks|h)\.(\d+)\./);
    if (layerMatch) {
      maxLayer = Math.max(maxLayer, Number(layerMatch[1]));
    }
  }

  return {
    format: 'Safetensors',
    tensorCount,
    parameterCount: totalParams > 0 ? formatParamCount(totalParams) : undefined,
    layers: maxLayer >= 0 ? maxLayer + 1 : undefined,
    quantization: Array.from(dtypes).join('/') || inferQuantFromFilename(fileName),
  };
}

/**
 * Unpacks a POSIX USTAR .tar byte array into a map of relative path -> Uint8Array.
 */
export function extractTarArchive(tarBytes: Uint8Array): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let offset = 0;

  const readCleanedString = (start: number, length: number): string => {
    let end = start;
    const max = Math.min(start + length, tarBytes.length);
    while (end < max && tarBytes[end] !== 0) end++;
    return decoder.decode(tarBytes.subarray(start, end)).trim();
  };

  while (offset + 512 <= tarBytes.length) {
    const name = readCleanedString(offset, 100);
    if (!name) {
      offset += 512;
      continue;
    }
    const sizeOctal = readCleanedString(offset + 124, 12);
    const size = parseInt(sizeOctal, 8) || 0;
    const typeFlag = tarBytes[offset + 156];
    const prefix = readCleanedString(offset + 345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;

    const dataStart = offset + 512;
    const dataEnd = Math.min(dataStart + size, tarBytes.length);

    // Regular file ('0' = 48 or '\0' = 0)
    if ((typeFlag === 48 || typeFlag === 0) && !fullName.endsWith('/')) {
      out[fullName] = tarBytes.slice(dataStart, dataEnd);
    }

    const blocks = Math.ceil(size / 512);
    offset = dataStart + blocks * 512;
  }

  return out;
}
