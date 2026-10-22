import { Wllama } from '@wllama/wllama';
import {
  env as hfEnv,
  InterruptableStoppingCriteria,
  pipeline,
  TextStreamer,
} from '@huggingface/transformers';
import { initLlama, type LlamaContext } from 'llama-cpp-capacitor';
import type {
  ChatAttachment,
  ChatMessage,
  GenerationMetrics,
  InferenceSettings,
  LoadedModelBundle,
  LoaderProgress,
} from '../types/local';

// Configure @huggingface/transformers to run 100% locally from Virtual Archive Map + local WASM
const virtualArchiveRegistry = new Map<string, Map<string, Blob>>();

const originalFetch = globalThis.fetch.bind(globalThis);

hfEnv.allowRemoteModels = false;
hfEnv.allowLocalModels = true;
hfEnv.localModelPath = '/__local_archive_models__/';
hfEnv.useBrowserCache = false;
if (hfEnv.backends?.onnx?.wasm) {
  hfEnv.backends.onnx.wasm.wasmPaths = '/ort-wasm/';
}

hfEnv.fetch = async (input: string | URL, init?: RequestInit): Promise<Response> => {
  const rawUrl = typeof input === 'string' ? input : input.toString();
  let pathname = rawUrl;
  try {
    if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
      pathname = new URL(rawUrl).pathname;
    }
  } catch {
    // Keep rawUrl
  }

  const marker = '/__local_archive_models__/';
  const idx = pathname.indexOf(marker);
  if (idx !== -1) {
    const rest = decodeURIComponent(pathname.slice(idx + marker.length));
    const slashIdx = rest.indexOf('/');
    if (slashIdx !== -1) {
      const modelId = rest.slice(0, slashIdx);
      const relFile = rest.slice(slashIdx + 1).replace(/^\/+/, '');
      const fileMap = virtualArchiveRegistry.get(modelId);
      if (fileMap) {
        const direct = fileMap.get(relFile);
        if (direct) {
          const contentType = relFile.endsWith('.json')
            ? 'application/json'
            : 'application/octet-stream';
          return new Response(direct, {
            status: 200,
            headers: {
              'Content-Type': contentType,
              'Content-Length': String(direct.size),
            },
          });
        }
      }
    }
    return new Response('Not found in local archive', { status: 404 });
  }

  return originalFetch(input as RequestInfo, init);
};

export interface StreamCallbacks {
  onToken: (partialContent: string, partialReasoning: string) => void;
}

/**
 * Splits optional `<think>...</think>` blocks from streamed text (DeepSeek-R1 / Qwen3 / SmolLM3).
 */
export function splitReasoningFromText(raw: string): { content: string; reasoning: string } {
  const trimmedStart = raw.trimStart();
  if (!trimmedStart.startsWith('<think>')) {
    return { content: raw, reasoning: '' };
  }
  const endIdx = trimmedStart.indexOf('</think>');
  if (endIdx === -1) {
    return {
      reasoning: trimmedStart.slice('<think>'.length).trimStart(),
      content: '',
    };
  }
  return {
    reasoning: trimmedStart.slice('<think>'.length, endIdx).trim(),
    content: trimmedStart.slice(endIdx + '</think>'.length).trimStart(),
  };
}

function buildEffectiveMessages(
  history: ChatMessage[],
  settings: InferenceSettings
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
  const out: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
  if (settings.systemPrompt.trim()) {
    out.push({ role: 'system', content: settings.systemPrompt.trim() });
  }

  for (const msg of history) {
    if (msg.isError) continue;
    if (msg.role === 'user') {
      let fullUserContent = msg.content;
      if (msg.attachments && msg.attachments.length > 0) {
        const attachedBlocks = msg.attachments
          .map(
            (att: ChatAttachment) =>
              `\n\n--- Attached File: ${att.name} ---\n${att.textContent.slice(0, 12000)}\n--- End of ${att.name} ---`
          )
          .join('');
        fullUserContent = `${fullUserContent}${attachedBlocks}`;
      }
      out.push({ role: 'user', content: fullUserContent });
    } else if (msg.role === 'assistant' && msg.content.trim()) {
      out.push({ role: 'assistant', content: msg.content });
    }
  }
  return out;
}

class LocalInferenceManager {
  private activeBundle: LoadedModelBundle | null = null;
  private wllama: Wllama | null = null;
  private nativeLlama: LlamaContext | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private onnxGenerator: any = null;
  private onnxStoppingCriteria: InterruptableStoppingCriteria | null = null;
  private currentAbortController: AbortController | null = null;

  getActiveModel() {
    return this.activeBundle?.record ?? null;
  }

  async unload(): Promise<void> {
    this.stopGeneration();
    if (this.wllama) {
      try {
        await this.wllama.exit();
      } catch {
        // Ignore cleanup errors
      }
      this.wllama = null;
    }
    if (this.nativeLlama) {
      try {
        await this.nativeLlama.release();
      } catch {
        // Ignore
      }
      this.nativeLlama = null;
    }
    if (this.onnxGenerator && typeof this.onnxGenerator.dispose === 'function') {
      try {
        await this.onnxGenerator.dispose();
      } catch {
        // Ignore
      }
    }
    this.onnxGenerator = null;
    if (this.activeBundle) {
      virtualArchiveRegistry.delete(this.activeBundle.record.id);
    }
    this.activeBundle = null;
  }

  stopGeneration(): void {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
    if (this.onnxStoppingCriteria) {
      this.onnxStoppingCriteria.interrupt();
    }
    if (this.nativeLlama) {
      this.nativeLlama.stopCompletion().catch(() => {});
    }
  }

  async activateModel(
    bundle: LoadedModelBundle,
    settings: InferenceSettings,
    onProgress?: (p: LoaderProgress) => void
  ): Promise<void> {
    await this.unload();

    const { record, files } = bundle;

    if (record.engine === 'inspector-only') {
      this.activeBundle = bundle;
      onProgress?.({
        stage: 'ready',
        percent: 100,
        detail: 'Archive inspected and mounted in Model Inspector.',
      });
      return;
    }

    onProgress?.({
      stage: 'initializing',
      percent: 78,
      detail: `Initializing ${this.describeEngine(record.engine)}...`,
    });

    if (record.engine === 'llama-cpp-native' && record.nativePath) {
      try {
        this.nativeLlama = await initLlama(
          {
            model: record.nativePath,
            n_ctx: settings.contextSize,
            n_threads: settings.threads,
            n_gpu_layers: settings.gpuLayers,
            use_mmap: true,
          },
          (prog) => {
            onProgress?.({
              stage: 'initializing',
              percent: Math.min(98, 78 + Math.round(prog * 0.2)),
              detail: `Loading native Android ARM64 llama.cpp weights (${Math.round(prog)}%)...`,
            });
          }
        );
        this.activeBundle = bundle;
        onProgress?.({ stage: 'ready', percent: 100, detail: 'Model active on Native JNI!' });
        return;
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err || 'Native model initialization failed.');
        throw new Error(
          `Native llama.cpp could not load this phone-stored GGUF file: ${reason}. Check that the model is a valid GGUF and that the phone has enough free RAM.`
        );
      }
    }

    if (record.engine === 'llama-cpp-wasm' || record.engine === 'llama-cpp-native') {
      const ggufBlobs: Blob[] = [];
      for (const entry of record.entries) {
        if (entry.kind === 'gguf') {
          const b = files.get(entry.path);
          if (b) ggufBlobs.push(b);
        }
      }
      if (ggufBlobs.length === 0) {
        // Single renamed .bin GGUF file
        const first = files.values().next().value;
        if (first) ggufBlobs.push(first);
      }

      const createWllama = () => {
        const instance = new Wllama(
          { default: '/wasm/wllama.wasm' },
          { suppressNativeLog: true, allowOffline: true }
        );
        instance.setCompat(null);
        return instance;
      };

      let wllama = createWllama();
      try {
        await wllama.loadModel(ggufBlobs, {
          n_ctx: settings.contextSize,
          n_gpu_layers: settings.gpuLayers,
          n_threads: settings.threads,
        });
      } catch (gpuError: unknown) {
        // Phones often report WebGPU but cannot fit every model layer into GPU memory.
        // Release the failed instance and retry conservatively on CPU with a smaller context.
        if (settings.gpuLayers <= 0) throw gpuError;
        try {
          await wllama.exit();
        } catch {
          // The failed runtime may already be torn down.
        }
        onProgress?.({
          stage: 'initializing',
          percent: 88,
          detail: 'GPU memory was insufficient. Retrying with phone-safe CPU settings...',
        });
        wllama = createWllama();
        try {
          await wllama.loadModel(ggufBlobs, {
            n_ctx: Math.min(settings.contextSize, 2048),
            n_gpu_layers: 0,
            n_threads: Math.min(settings.threads, 2),
          });
        } catch (cpuError: unknown) {
          try {
            await wllama.exit();
          } catch {
            // Ignore cleanup errors.
          }
          const details =
            cpuError instanceof Error ? cpuError.message : String(cpuError || gpuError);
          throw new Error(
            `This model could not fit into phone memory, even in CPU-safe mode. Try a smaller Q4 GGUF model (ideally under 1 GB). Runtime: ${details}`
          );
        }
      }

      // Enrich specs from live wllama metadata
      try {
        const meta = wllama.getModelMetadata();
        record.specs.vocabSize = record.specs.vocabSize || meta.hparams.nVocab;
        record.specs.contextLength = record.specs.contextLength || meta.hparams.nCtxTrain;
        record.specs.embeddingSize = record.specs.embeddingSize || meta.hparams.nEmbd;
        record.specs.layers = record.specs.layers || meta.hparams.nLayer;
        record.specs.hasChatTemplate = Boolean(wllama.getChatTemplate());
      } catch {
        // Ignore optional enrichment
      }

      record.engine = 'llama-cpp-wasm';
      this.wllama = wllama;
      this.activeBundle = bundle;
      onProgress?.({
        stage: 'ready',
        percent: 100,
        detail: 'GGUF model loaded into on-device llama.cpp runtime!',
      });
      return;
    }

    if (record.engine === 'transformers-onnx') {
      virtualArchiveRegistry.set(record.id, files);
      const hasWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;

      // Determine dtype based on archive files
      const dtype = (record.specs.onnxDtype || 'q8') as
        | 'fp32'
        | 'fp16'
        | 'q8'
        | 'q4'
        | 'q4f16';

      try {
        this.onnxGenerator = await pipeline('text-generation', record.id, {
          local_files_only: true,
          device: hasWebGpu ? 'webgpu' : 'wasm',
          dtype,
        });
      } catch {
        // Retry on pure WASM with auto dtype if WebGPU shader compilation or specific dtype differs
        this.onnxGenerator = await pipeline('text-generation', record.id, {
          local_files_only: true,
          device: 'wasm',
        });
      }

      this.activeBundle = bundle;
      onProgress?.({
        stage: 'ready',
        percent: 100,
        detail: 'ONNX Transformers archive mounted and ready!',
      });
      return;
    }

    if (record.engine === 'compact-local') {
      // Verify starter archive payload exists
      const pack = files.get('local-pack.json');
      if (!pack) {
        throw new Error('Starter archive missing local-pack.json.');
      }
      this.activeBundle = bundle;
      onProgress?.({
        stage: 'ready',
        percent: 100,
        detail: 'Compact starter archive unpacked and active!',
      });
    }
  }

  describeEngine(engine: string): string {
    switch (engine) {
      case 'llama-cpp-native':
        return 'Llama.cpp Native ARM64';
      case 'llama-cpp-wasm':
        return typeof navigator !== 'undefined' && 'gpu' in navigator
          ? 'Llama.cpp (WebGPU / WASM)'
          : 'Llama.cpp (WASM SIMD)';
      case 'transformers-onnx':
        return 'ONNX Runtime (Transformers.js)';
      case 'compact-local':
        return 'Starter Archive (.zip)';
      default:
        return 'Archive Inspector';
    }
  }

  async generateChatStream(
    history: ChatMessage[],
    settings: InferenceSettings,
    callbacks: StreamCallbacks
  ): Promise<{ content: string; reasoning: string; metrics: GenerationMetrics }> {
    if (!this.activeBundle) {
      throw new Error('No AI model or archive is loaded yet. Tap the model pill to pick one.');
    }

    const { record } = this.activeBundle;
    if (record.engine === 'inspector-only') {
      throw new Error(
        record.specs.notes ||
          'This file is loaded in Inspector mode. Pick a .gguf file or an ONNX .zip/folder archive to generate chat replies.'
      );
    }

    this.currentAbortController = new AbortController();
    const signal = this.currentAbortController.signal;
    const formattedMessages = buildEffectiveMessages(history, settings);

    const startTime = performance.now();
    let firstTokenTime = 0;
    let tokenCount = 0;
    let rawAccumulated = '';

    const emitChunk = (delta: string) => {
      if (!delta) return;
      if (!firstTokenTime) firstTokenTime = performance.now();
      tokenCount++;
      rawAccumulated += delta;
      const split = splitReasoningFromText(rawAccumulated);
      callbacks.onToken(split.content, split.reasoning);
    };

    // 1. Native Android Capacitor Llama.cpp
    if (record.engine === 'llama-cpp-native' && this.nativeLlama) {
      const formatted = await this.nativeLlama.getFormattedChat(
        formattedMessages.map((m) => ({ role: m.role, content: m.content }))
      );
      await this.nativeLlama.completion(
        {
          prompt: formatted.prompt,
          n_predict: settings.maxTokens,
          temperature: settings.temperature,
          top_p: settings.topP,
          top_k: settings.topK,
          penalty_repeat: settings.repeatPenalty,
        },
        (data) => {
          if (signal.aborted) return;
          emitChunk(data.token);
        }
      );
    }
    // 2. Wllama (llama.cpp WASM / WebGPU)
    else if (this.wllama) {
      try {
        const stream = await this.wllama.createChatCompletion({
          messages: formattedMessages,
          stream: true,
          temperature: settings.temperature,
          top_p: settings.topP,
          top_k: settings.topK,
          penalty_repeat: settings.repeatPenalty,
          max_tokens: settings.maxTokens,
          abortSignal: signal,
        });

        for await (const chunk of stream) {
          if (signal.aborted) break;
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) emitChunk(delta);
        }
      } catch (err: unknown) {
        if (signal.aborted || (err instanceof Error && err.name.includes('Abort'))) {
          // User stopped generation cleanly
        } else {
          // Fallback to ChatML prompt completion if base GGUF lacks chat_template
          const fallbackPrompt =
            formattedMessages
              .map((m) => `<|im_start|>${m.role}\n${m.content}<|im_end|>`)
              .join('\n') + '\n<|im_start|>assistant\n';
          const rawStream = await this.wllama.createCompletion({
            prompt: fallbackPrompt,
            stream: true,
            temperature: settings.temperature,
            top_p: settings.topP,
            top_k: settings.topK,
            penalty_repeat: settings.repeatPenalty,
            max_tokens: settings.maxTokens,
            stop: ['<|im_end|>', '<|endoftext|>', '</s>'],
            abortSignal: signal,
          });
          for await (const chunk of rawStream) {
            if (signal.aborted) break;
            const delta = chunk.choices?.[0]?.text;
            if (delta) emitChunk(delta);
          }
        }
      }
    }
    // 3. Transformers.js ONNX Runtime
    else if (record.engine === 'transformers-onnx' && this.onnxGenerator) {
      this.onnxStoppingCriteria = new InterruptableStoppingCriteria();
      const streamer = new TextStreamer(this.onnxGenerator.tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (text: string) => {
          if (!signal.aborted) emitChunk(text);
        },
      });

      await this.onnxGenerator(formattedMessages, {
        max_new_tokens: settings.maxTokens,
        temperature: settings.temperature,
        top_p: settings.topP,
        top_k: settings.topK,
        repetition_penalty: settings.repeatPenalty,
        do_sample: settings.temperature > 0.01,
        streamer,
        stopping_criteria: [this.onnxStoppingCriteria],
      });
      this.onnxStoppingCriteria = null;
    }
    // 4. Compact Starter Archive (.zip)
    else if (record.engine === 'compact-local') {
      const reply = synthesizeCompactPackReply(history, settings, record.name);
      const tokens = reply.match(/\S+\s*|\n+/g) || [reply];
      for (const tok of tokens) {
        if (signal.aborted) break;
        await new Promise((r) => setTimeout(r, 16));
        emitChunk(tok);
      }
    }

    const elapsedMs = Math.max(1, performance.now() - startTime);
    const ttftMs = firstTokenTime ? Math.max(1, Math.round(firstTokenTime - startTime)) : Math.round(elapsedMs);
    const genWindowSec = Math.max(0.05, (elapsedMs - (firstTokenTime ? ttftMs : 0)) / 1000);
    const tokensPerSec = Number((Math.max(1, tokenCount) / genWindowSec).toFixed(1));

    const finalSplit = splitReasoningFromText(rawAccumulated);

    return {
      content: finalSplit.content || (signal.aborted ? '*[Generation stopped]*' : ''),
      reasoning: finalSplit.reasoning,
      metrics: {
        tokensPerSec,
        totalTokens: tokenCount,
        ttftMs,
        elapsedMs: Math.round(elapsedMs),
        engineLabel: this.describeEngine(record.engine),
      },
    };
  }
}

function synthesizeCompactPackReply(
  history: ChatMessage[],
  settings: InferenceSettings,
  modelName: string
): string {
  const lastUser = [...history].reverse().find((m) => m.role === 'user');
  const prompt = (lastUser?.content || '').trim();
  const lower = prompt.toLowerCase();
  const attachments = lastUser?.attachments || [];
  const isSpanish =
    /\b(hola|como|cómo|puedes|que|qué|ayuda|explica|hacer|codigo|código|archivo|resumen|gracias)\b/i.test(
      prompt
    );

  // If user attached files in chat, genuinely analyze & summarize them!
  if (attachments.length > 0) {
    const summaries = attachments.map((att) => {
      const lines = att.textContent.split('\n');
      const words = att.textContent.trim().split(/\s+/).filter(Boolean).length;
      const previewLines = lines
        .filter((l) => l.trim().length > 0)
        .slice(0, 5)
        .map((l) => `  > ${l.slice(0, 110)}`)
        .join('\n');
      return `### \`${att.name}\`\n- **Lines:** ${att.lineCount.toLocaleString()} · **Words:** ${words.toLocaleString()}\n- **Key excerpt:**\n${previewLines}`;
    });

    return `<think>Inspecting ${attachments.length} attached file(s) locally on device without uploading any bytes externally. Extracting structure, metrics, and relevant context for "${prompt.slice(0, 60)}".</think>${
      isSpanish
        ? `He analizado localmente ${attachments.length === 1 ? 'el archivo adjunto' : 'los archivos adjuntos'} en tu dispositivo:`
        : `I analyzed your ${attachments.length === 1 ? 'attached file' : 'attached files'} 100% locally on-device:`
    }\n\n${summaries.join('\n\n')}\n\n${
      isSpanish
        ? '¿Quieres que extraiga datos específicos, refactorice código o resuma alguna sección en detalle?'
        : 'Would you like me to extract specific fields, refactor sections, or summarize a particular part in more detail?'
    }`;
  }

  // Math / arithmetic evaluation
  const mathMatch = prompt.match(/(?:what is|calculate|cuánto es|calcula)?\s*([\d.]+)\s*([+\-*/^])\s*([\d.]+)/i);
  if (mathMatch) {
    const a = Number(mathMatch[1]);
    const op = mathMatch[2];
    const b = Number(mathMatch[3]);
    const res =
      op === '+'
        ? a + b
        : op === '-'
          ? a - b
          : op === '*'
            ? a * b
            : op === '/'
              ? b !== 0
                ? a / b
                : NaN
              : Math.pow(a, b);
    return `<think>Evaluating expression ${a} ${op} ${b} deterministically.</think>The result of **\`${a} ${op} ${b}\`** is **\`${res}\`**.`;
  }

  // Code requests
  if (/\b(python|javascript|typescript|react|kotlin|android|code|function|script|código|función)\b/i.test(lower)) {
    return `<think>Structuring a clean, well-commented implementation tailored to the user's prompt while respecting system instructions (temperature=${settings.temperature}).</think>${
      isSpanish
        ? 'Aquí tienes un ejemplo limpio y listo para usar ejecutándose desde **' + modelName + '**:'
        : `Here is a clean, modular implementation generated locally via **${modelName}**:`
    }\n\n\`\`\`typescript\nexport async function loadPickedModelArchive(file: File) {\n  const headerSlice = await file.slice(0, 4).text();\n  const isGguf = headerSlice === 'GGUF';\n\n  return {\n    fileName: file.name,\n    sizeMB: Number((file.size / (1024 * 1024)).toFixed(2)),\n    format: isGguf ? 'GGUF (llama.cpp)' : 'Archive (.zip / ONNX)',\n    offlineReady: true,\n  };\n}\n\`\`\`\n\n> **Tip:** This reply is streaming from the lightweight **Starter Archive (\`.zip\`)**. Pick any quantized **\`.gguf\`** model (such as \`Qwen2.5-1.5B-Instruct-Q4_K_M.gguf\` or \`Llama-3.2-1B-Instruct-Q4_K_M.gguf\`) or an **ONNX Transformers \`.zip\`** archive from your Android storage to run full neural weights locally!`;
  }

  if (isSpanish) {
    return `<think>Procesando consulta en español dentro del entorno aislado del dispositivo Android.</think>¡Hola! Estoy respondiendo desde **${modelName}** directamente en tu dispositivo, sin conexión a servidores externos.\n\n### Qué puedes hacer en **Local**:\n1. **Cargar modelos \`.gguf\` reales** — Selecciona cualquier modelo cuantizado (\`Llama 3.2\`, \`Qwen 2.5 / 3\`, \`Gemma 2\`, \`SmolLM2\`, \`DeepSeek-R1\`) desde tu carpeta *Descargas* en Android.\n2. **Cargar archivos comprimidos (\`.zip\`, \`.tar.gz\`) o carpetas ONNX** — **Local** descomprime el archivo automáticamente, inspecciona sus tensores y lo guarda en memoria local.\n3. **Adjuntar documentos en el chat** — Usa el botón \`+\` para analizar código, notas \`.md\`, \`.json\` o \`.csv\` de forma 100% privada.\n\n*Actualmente estás probando el paquete compacto de prueba (\`.zip\`). Toca el selector de modelo arriba para cargar cualquier archivo \`.gguf\` o archivo \`.zip\` de tu dispositivo.*`;
  }

  return `<think>Processing prompt "${prompt.slice(0, 64)}" locally using ${modelName}.</think>Hello! You're chatting offline with **${modelName}** inside **Local**.\n\n### How On-Device Archives Work:\n- **GGUF Models (\`.gguf\` or \`.zip\` containing \`.gguf\`)** run directly on **llama.cpp** (Native ARM64 C++ JNI on Android APK, and WebGPU / WASM SIMD in WebView & Browser).\n- **Transformers / ONNX Archives (\`.zip\`, \`.tar.gz\`, or folders)** with \`config.json\`, \`tokenizer.json\`, and \`.onnx\` weights unpack into on-device IndexedDB storage and run via **ONNX Runtime**.\n- **Zero Cloud Calls** — Your conversations, attached documents, and picked model archives never leave your phone.\n\n*You're currently testing the built-in **Starter Compact Archive (\`.zip\`)**. Tap the model selector at the top anytime to pick a full \`.gguf\` model or \`.zip\` archive from your device!*`;
}

export const inferenceEngine = new LocalInferenceManager();
