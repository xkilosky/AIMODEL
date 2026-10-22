import { gunzipSync, strToU8, unzip, zipSync } from 'fflate';
import { Capacitor } from '@capacitor/core';
import type {
  ArchiveEntryInfo,
  EngineKind,
  LoadedModelBundle,
  LoaderProgress,
  ParsedModelSpecs,
  StoredModelRecord,
} from '../types/local';
import {
  extractTarArchive,
  formatParamCount,
  inferQuantFromFilename,
  inspectGgufHeader,
  inspectSafetensorsHeader,
} from './binaryInspectors';

function classifyEntryKind(relPath: string): ArchiveEntryInfo['kind'] {
  const lower = relPath.toLowerCase();
  if (lower.endsWith('.gguf')) return 'gguf';
  if (lower.endsWith('.onnx') || lower.endsWith('.onnx_data')) return 'onnx';
  if (lower.endsWith('.safetensors')) return 'safetensors';
  if (lower.includes('tokenizer')) return 'tokenizer';
  if (lower.endsWith('.json') || lower.endsWith('.jinja') || lower.endsWith('.txt')) return 'config';
  if (lower.endsWith('.bin') || lower.endsWith('.pth') || lower.endsWith('.pt')) return 'weights';
  return 'other';
}

function normalizeArchivePaths(rawMap: Map<string, Blob>): Map<string, Blob> {
  const filtered: Array<[string, Blob]> = [];
  for (const [rawPath, blob] of rawMap.entries()) {
    const clean = rawPath.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
    if (
      !clean ||
      clean.endsWith('/') ||
      clean.includes('__MACOSX/') ||
      clean.endsWith('.DS_Store')
    ) {
      continue;
    }
    filtered.push([clean, blob]);
  }

  if (filtered.length === 0) return new Map();

  // Check if all files share a single top-level directory wrapper (common in .zip/.tar.gz & folder pickers)
  const firstSegs = new Set(
    filtered.map(([p]) => {
      const idx = p.indexOf('/');
      return idx > 0 ? p.slice(0, idx) : '';
    })
  );

  if (firstSegs.size === 1 && !firstSegs.has('')) {
    const prefix = `${Array.from(firstSegs)[0]}/`;
    const unwrapped = new Map<string, Blob>();
    for (const [p, blob] of filtered) {
      unwrapped.set(p.slice(prefix.length), blob);
    }
    return unwrapped;
  }

  return new Map(filtered);
}

function unzipBufferAsync(zipBytes: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(zipBytes, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

function deriveCleanModelName(rawName: string, specs: ParsedModelSpecs): string {
  if (specs.modelName && specs.modelName.trim().length > 1 && specs.modelName !== '[large-value]') {
    return specs.modelName.trim();
  }
  return rawName
    .replace(/\.(tar\.gz|tgz|zip|tar|gguf|onnx|safetensors|bin)$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim();
}

export async function processPickedModelFiles(
  fileList: FileList | File[],
  onProgress?: (p: LoaderProgress) => void
): Promise<LoadedModelBundle> {
  const picked = Array.from(fileList);
  if (picked.length === 0) {
    throw new Error('No files were selected.');
  }

  onProgress?.({
    stage: 'reading',
    percent: 12,
    detail: `Reading ${picked.length === 1 ? picked[0].name : `${picked.length} selected files`}...`,
  });

  const rawFilesMap = new Map<string, Blob>();
  let sourceLabel = 'Picked File';
  let baseTitle = picked[0].name;

  // Case 1: Single compressed archive (.zip, .tar.gz, .tgz, .tar)
  const single = picked.length === 1 ? picked[0] : null;
  const singleLower = single ? single.name.toLowerCase() : '';

  if (
    single &&
    (singleLower.endsWith('.zip') ||
      singleLower.endsWith('.tar.gz') ||
      singleLower.endsWith('.tgz') ||
      singleLower.endsWith('.tar'))
  ) {
    const arrayBuf = await single.arrayBuffer();
    const bytes = new Uint8Array(arrayBuf);

    onProgress?.({
      stage: 'extracting',
      percent: 38,
      detail: `Extracting archive ${single.name}...`,
    });

    if (singleLower.endsWith('.zip')) {
      sourceLabel = 'ZIP Archive';
      const extracted = await unzipBufferAsync(bytes);
      for (const [entryPath, content] of Object.entries(extracted)) {
        rawFilesMap.set(entryPath, new Blob([content as BlobPart]));
      }
    } else if (singleLower.endsWith('.tar.gz') || singleLower.endsWith('.tgz')) {
      sourceLabel = 'TAR.GZ Archive';
      const decompressed = gunzipSync(bytes);
      const extracted = extractTarArchive(decompressed);
      for (const [entryPath, content] of Object.entries(extracted)) {
        rawFilesMap.set(entryPath, new Blob([content as BlobPart]));
      }
    } else {
      sourceLabel = 'TAR Archive';
      const extracted = extractTarArchive(bytes);
      for (const [entryPath, content] of Object.entries(extracted)) {
        rawFilesMap.set(entryPath, new Blob([content as BlobPart]));
      }
    }
  } else {
    // Case 2: Direct file(s) (.gguf, .onnx, .safetensors, .bin) or Model Directory
    const hasRelativePaths = picked.some(
      (f) => 'webkitRelativePath' in f && Boolean((f as File & { webkitRelativePath?: string }).webkitRelativePath)
    );
    if (hasRelativePaths) {
      sourceLabel = 'Model Folder';
      const firstRel = (picked[0] as File & { webkitRelativePath?: string }).webkitRelativePath || '';
      baseTitle = firstRel.split('/')[0] || picked[0].name;
    } else if (picked.length > 1) {
      sourceLabel = `${picked.length} Model Files`;
    } else if (singleLower.endsWith('.gguf')) {
      sourceLabel = 'GGUF Model';
    } else if (singleLower.endsWith('.onnx')) {
      sourceLabel = 'ONNX Model';
    } else if (singleLower.endsWith('.safetensors')) {
      sourceLabel = 'Safetensors File';
    }

    for (const file of picked) {
      const rel =
        (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      rawFilesMap.set(rel, file);
    }
  }

  const normalizedFiles = normalizeArchivePaths(rawFilesMap);
  if (normalizedFiles.size === 0) {
    throw new Error('The selected archive did not contain any readable model files.');
  }

  onProgress?.({
    stage: 'inspecting',
    percent: 68,
    detail: `Inspecting ${normalizedFiles.size} archive file${normalizedFiles.size > 1 ? 's' : ''} & binary headers...`,
  });

  const entries: ArchiveEntryInfo[] = [];
  let totalBytes = 0;

  for (const [relPath, blob] of normalizedFiles.entries()) {
    totalBytes += blob.size;
    entries.push({
      path: relPath,
      size: blob.size,
      kind: classifyEntryKind(relPath),
    });
  }

  entries.sort((a, b) => a.path.localeCompare(b.path));

  // Identify model format & runtime engine
  const ggufEntries = entries.filter((e) => e.kind === 'gguf');
  const onnxEntries = entries.filter((e) => e.path.toLowerCase().endsWith('.onnx'));
  const safetensorEntries = entries.filter((e) => e.kind === 'safetensors');
  const localPackBlob = normalizedFiles.get('local-pack.json');
  const configBlob = normalizedFiles.get('config.json');

  let engine: EngineKind = 'inspector-only';
  let specs: ParsedModelSpecs = { format: 'Bin' };

  if (localPackBlob) {
    const packJson = JSON.parse(await localPackBlob.text()) as {
      name?: string;
      architecture?: string;
      parameters?: string;
      quantization?: string;
      contextLength?: number;
      layers?: number;
      vocabSize?: number;
    };
    engine = 'compact-local';
    specs = {
      format: 'LocalPack',
      modelName: packJson.name || 'Local Starter Assistant',
      architecture: packJson.architecture || 'compact-transformer',
      parameterCount: packJson.parameters || 'Compact Pack',
      quantization: packJson.quantization || 'INT8-Pack',
      contextLength: packJson.contextLength || 8192,
      layers: packJson.layers || 12,
      vocabSize: packJson.vocabSize || 32000,
      hasChatTemplate: true,
    };
  } else if (ggufEntries.length > 0) {
    const primaryGguf = normalizedFiles.get(ggufEntries[0].path)!;
    specs = await inspectGgufHeader(primaryGguf, ggufEntries[0].path);
    engine = Capacitor.isNativePlatform() ? 'llama-cpp-native' : 'llama-cpp-wasm';
  } else if (onnxEntries.length > 0) {
    let arch = 'onnx-causal-lm';
    let ctxLen: number | undefined;
    let layers: number | undefined;
    let embd: number | undefined;
    let vocab: number | undefined;
    let modelNameFromCfg: string | undefined;

    if (configBlob) {
      try {
        const cfg = JSON.parse(await configBlob.text()) as Record<string, unknown>;
        arch =
          typeof cfg.model_type === 'string'
            ? cfg.model_type
            : Array.isArray(cfg.architectures) && typeof cfg.architectures[0] === 'string'
              ? cfg.architectures[0]
              : arch;
        ctxLen =
          typeof cfg.max_position_embeddings === 'number'
            ? cfg.max_position_embeddings
            : undefined;
        layers = typeof cfg.num_hidden_layers === 'number' ? cfg.num_hidden_layers : undefined;
        embd = typeof cfg.hidden_size === 'number' ? cfg.hidden_size : undefined;
        vocab = typeof cfg.vocab_size === 'number' ? cfg.vocab_size : undefined;
        if (typeof cfg._name_or_path === 'string' && !cfg._name_or_path.startsWith('/')) {
          modelNameFromCfg = cfg._name_or_path.split('/').pop();
        }
      } catch {
        // Ignore malformed config.json
      }
    }

    const onnxNames = onnxEntries.map((e) => e.path.toLowerCase());
    let onnxDtype = 'fp32';
    if (onnxNames.some((n) => n.includes('q4f16'))) onnxDtype = 'q4f16';
    else if (onnxNames.some((n) => n.includes('q4'))) onnxDtype = 'q4';
    else if (onnxNames.some((n) => n.includes('quantized') || n.includes('int8') || n.includes('q8')))
      onnxDtype = 'q8';
    else if (onnxNames.some((n) => n.includes('fp16'))) onnxDtype = 'fp16';

    const hasTokenizer = entries.some(
      (e) => e.path === 'tokenizer.json' || e.path === 'tokenizer_config.json'
    );

    engine = configBlob && hasTokenizer ? 'transformers-onnx' : 'inspector-only';
    specs = {
      format: 'ONNX',
      modelName: modelNameFromCfg,
      architecture: arch,
      quantization: onnxDtype.toUpperCase(),
      onnxDtype,
      contextLength: ctxLen,
      layers,
      embeddingSize: embd,
      vocabSize: vocab,
      hasChatTemplate: entries.some(
        (e) => e.path.endsWith('chat_template.jinja') || e.path === 'tokenizer_config.json'
      ),
      notes:
        engine === 'inspector-only'
          ? 'ONNX graph found without config.json / tokenizer.json. Pick the complete folder or .zip archive containing tokenizer.json and config.json to run text generation.'
          : undefined,
    };
  } else if (safetensorEntries.length > 0) {
    const primarySt = normalizedFiles.get(safetensorEntries[0].path)!;
    specs = await inspectSafetensorsHeader(primarySt, safetensorEntries[0].path);
    if (configBlob) {
      try {
        const cfg = JSON.parse(await configBlob.text()) as Record<string, unknown>;
        if (typeof cfg.model_type === 'string') specs.architecture = cfg.model_type;
        if (typeof cfg.max_position_embeddings === 'number')
          specs.contextLength = cfg.max_position_embeddings;
      } catch {
        // Ignore
      }
    }
    specs.notes =
      'Safetensors weights inspected successfully. For on-device Android inference, load a quantized .gguf version or an ONNX (.zip / folder) export of this model.';
    engine = 'inspector-only';
  } else {
    // Check if a .bin file is actually a GGUF file renamed to .bin
    const firstBlobEntry = entries[0];
    const firstBlob = normalizedFiles.get(firstBlobEntry.path)!;
    try {
      specs = await inspectGgufHeader(firstBlob, firstBlobEntry.path);
      engine = Capacitor.isNativePlatform() ? 'llama-cpp-native' : 'llama-cpp-wasm';
    } catch {
      specs = {
        format: 'Bin',
        quantization: inferQuantFromFilename(firstBlobEntry.path),
        parameterCount: formatParamCount(Math.round(totalBytes / 2)),
        notes:
          'Binary archive inspected. To run live chat inference on Android, pick a .gguf model file or a .zip/.tar.gz archive containing a .gguf or ONNX Transformers model.',
      };
      engine = 'inspector-only';
    }
  }

  const cleanName = deriveCleanModelName(baseTitle, specs);
  const now = Date.now();

  const record: StoredModelRecord = {
    id: `model-${now}-${Math.random().toString(36).slice(2, 7)}`,
    name: cleanName,
    sourceLabel,
    engine,
    totalBytes,
    createdAt: now,
    lastUsedAt: now,
    persistedInIdb: false,
    entries,
    specs,
  };

  return {
    record,
    files: normalizedFiles,
  };
}

/**
 * Generates a real, standards-compliant .zip archive (`local-starter-assistant.zip`)
 * so users can test downloading & picking a compressed model archive from their Android
 * Downloads / Files picker immediately, even before downloading a multi-hundred-MB .gguf!
 */
export function buildSampleModelArchiveZip(): Uint8Array {
  const manifest = {
    name: 'Local Starter Compact v1',
    format: 'local-compact-pack',
    version: '1.0.0',
    architecture: 'compact-instruct-pack',
    parameters: 'Compact Test Pack',
    quantization: 'INT8-Pack',
    contextLength: 8192,
    layers: 12,
    vocabSize: 32000,
    capabilities: ['chat', 'markdown', 'code', 'document-qa', 'bilingual-en-es'],
    createdAt: '2026-10-22',
  };

  const configJson = {
    model_type: 'compact-instruct',
    hidden_size: 768,
    num_hidden_layers: 12,
    num_attention_heads: 12,
    max_position_embeddings: 8192,
    vocab_size: 32000,
  };

  const tokenizerJson = {
    version: '1.0',
    model: { type: 'BPE' },
    added_tokens: [
      { id: 1, content: '<|im_start|>', special: true },
      { id: 2, content: '<|im_end|>', special: true },
      { id: 3, content: '<think>', special: true },
      { id: 4, content: '</think>', special: true },
    ],
  };

  // Compact deterministic weight matrix seed block (16 KB)
  const weights = new Uint8Array(16384);
  for (let i = 0; i < weights.length; i++) {
    weights[i] = (i * 73 + 19) & 0xff;
  }

  const readme = [
    '# Local Starter Compact Archive (.zip)',
    '',
    'This portable archive verifies end-to-end .zip archive extraction, IndexedDB persistence,',
    'binary inspection, and streaming chat inside the Local Android app.',
    '',
    'For full LLM weights on Android, pick any `.gguf` file (e.g. Qwen2.5-1.5B-Instruct-Q4_K_M.gguf,',
    'Llama-3.2-1B-Instruct-Q4_K_M.gguf, SmolLM2-360M-Instruct-Q8_0.gguf) or an ONNX Transformers `.zip` archive!',
  ].join('\n');

  return zipSync({
    'local-starter-compact/local-pack.json': strToU8(JSON.stringify(manifest, null, 2)),
    'local-starter-compact/config.json': strToU8(JSON.stringify(configJson, null, 2)),
    'local-starter-compact/tokenizer.json': strToU8(JSON.stringify(tokenizerJson, null, 2)),
    'local-starter-compact/weights.fp8.bin': weights,
    'local-starter-compact/README.md': strToU8(readme),
  });
}
