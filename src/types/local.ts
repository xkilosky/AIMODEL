export type ThemeId = 'claude-dark' | 'claude-light' | 'chatgpt-dark' | 'chatgpt-light';

export type EngineKind =
  | 'llama-cpp-native'
  | 'llama-cpp-wasm'
  | 'transformers-onnx'
  | 'compact-local'
  | 'inspector-only';

export type ModelFormatKind = 'GGUF' | 'ONNX' | 'Safetensors' | 'LocalPack' | 'Bin';

export interface ArchiveEntryInfo {
  path: string;
  size: number;
  kind: 'gguf' | 'onnx' | 'safetensors' | 'config' | 'tokenizer' | 'weights' | 'other';
}

export interface ParsedModelSpecs {
  format: ModelFormatKind;
  architecture?: string;
  modelName?: string;
  quantization?: string;
  parameterCount?: string;
  contextLength?: number;
  layers?: number;
  embeddingSize?: number;
  vocabSize?: number;
  tensorCount?: number;
  ggufVersion?: number;
  hasChatTemplate?: boolean;
  onnxDtype?: string;
  notes?: string;
}

export interface StoredModelRecord {
  id: string;
  name: string;
  sourceLabel: string; // e.g. "Archive (.zip)" | "GGUF File" | "Model Folder" | "TAR.GZ Archive"
  engine: EngineKind;
  totalBytes: number;
  createdAt: number;
  lastUsedAt: number;
  persistedInIdb: boolean;
  nativePath?: string;
  entries: ArchiveEntryInfo[];
  specs: ParsedModelSpecs;
}

export interface LoadedModelBundle {
  record: StoredModelRecord;
  files: Map<string, Blob>;
}

export interface InferenceSettings {
  systemPrompt: string;
  temperature: number;
  topP: number;
  topK: number;
  repeatPenalty: number;
  maxTokens: number;
  contextSize: number;
  gpuLayers: number;
  threads: number;
  /** Auto follows detected CPU cores; manual means the user selected a thread count. */
  threadMode?: 'auto' | 'manual';
}

export interface ChatAttachment {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  textContent: string;
  lineCount: number;
}

export interface GenerationMetrics {
  tokensPerSec: number;
  totalTokens: number;
  ttftMs: number;
  elapsedMs: number;
  engineLabel: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  reasoning?: string;
  attachments?: ChatAttachment[];
  createdAt: number;
  modelName?: string;
  metrics?: GenerationMetrics;
  isError?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  pinned?: boolean;
  createdAt: number;
  updatedAt: number;
  modelId?: string;
  messages: ChatMessage[];
}

export interface LoaderProgress {
  stage: 'reading' | 'extracting' | 'inspecting' | 'caching' | 'initializing' | 'ready' | 'error';
  percent: number;
  detail: string;
}
