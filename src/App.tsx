import React, { useEffect, useRef, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import {
  Archive,
  ArrowUp,
  Check,
  ChevronDown,
  Copy,
  FileText,
  Maximize2,
  Menu,
  Paperclip,
  Plus,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Square,
  WifiOff,
  X,
  Zap,
} from 'lucide-react';
import type {
  ChatAttachment,
  ChatMessage,
  Conversation,
  InferenceSettings,
  LoadedModelBundle,
  LoaderProgress,
  StoredModelRecord,
  ThemeId,
} from './types/local';
import {
  deleteStoredModel,
  getDeviceStorageEstimate,
  listStoredModels,
  loadInferenceSettings,
  loadModelBundleById,
  loadSavedConversations,
  loadSavedTheme,
  MAX_MODEL_LIBRARY_BYTES,
  saveConversations,
  saveInferenceSettings,
  saveModelBundle,
  saveTheme,
  touchModelLastUsed,
} from './services/modelStorage';
import { buildSampleModelArchiveZip, processPickedModelFiles } from './services/archiveLoader';
import { inferenceEngine } from './services/inferenceEngine';
import { formatBytes, inspectGgufHeader } from './services/binaryInspectors';
import {
  addNativeModelCopyProgressListener,
  deleteNativeStoredModel,
  getDeviceProfile,
  getModelFitAssessment,
  MAX_LOCAL_MODEL_BYTES,
  pickAndStoreNativeGguf,
  type DeviceProfile,
} from './services/nativeDevice';
import { LocalLogo } from './components/LocalLogo';
import { MarkdownMessage } from './components/MarkdownMessage';
import { SidebarDrawer } from './components/SidebarDrawer';
import { ModelArchiveModal } from './components/ModelArchiveModal';
import { ModelInspectorSheet } from './components/ModelInspectorSheet';
import { InferenceControlsSheet } from './components/InferenceControlsSheet';
import {
  AndroidInstallModal,
  type BeforeInstallPromptEvent,
} from './components/AndroidInstallModal';

function createFreshConversation(): Conversation {
  const now = Date.now();
  return {
    id: `chat-${now}-${Math.random().toString(36).slice(2, 6)}`,
    title: 'New Conversation',
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

function describeInferenceError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const value = error as Record<string, unknown>;
    if (typeof value.message === 'string') {
      const code = typeof value.code === 'string' ? ` (${value.code})` : '';
      return `${value.message}${code}`;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return Object.prototype.toString.call(error);
    }
  }
  return String(error || 'Unknown runtime error');
}

const STARTER_PROMPTS = [
  {
    title: 'Summarize a file offline',
    subtitle: 'Attach notes, JSON, or code privately',
    prompt: 'Explain how I can analyze local documents and code files completely offline in Local.',
  },
  {
    title: 'Write clean TypeScript',
    subtitle: 'Generate modular mobile utility code',
    prompt: 'Write a clean TypeScript function to validate a local AI model file header.',
  },
  {
    title: 'Explicar en Español',
    subtitle: 'Asistente privado 100% en tu Android',
    prompt: 'Hola, ¿cómo funciona la carga de modelos .gguf y archivos .zip en mi teléfono Android?',
  },
  {
    title: 'Quick calculation & logic',
    subtitle: 'Test instant deterministic reasoning',
    prompt: 'Calculate 148 * 27 and explain why quantized Q4_K_M models fit well in mobile RAM.',
  },
];

export const App: React.FC = () => {
  const [theme, setTheme] = useState<ThemeId>(() => loadSavedTheme());
  const [conversations, setConversations] = useState<Conversation[]>(() => {
    const existing = loadSavedConversations();
    return existing.length > 0 ? existing : [createFreshConversation()];
  });
  const [activeConvId, setActiveConvId] = useState<string>(
    () => loadSavedConversations()[0]?.id || ''
  );

  const [settings, setSettings] = useState<InferenceSettings>(() => loadInferenceSettings());
  const [storedModels, setStoredModels] = useState<StoredModelRecord[]>([]);
  const [activeModel, setActiveModel] = useState<StoredModelRecord | null>(null);
  const [storageInfo, setStorageInfo] = useState<{ usage: number; quota: number }>({
    usage: 0,
    quota: 0,
  });

  // Modals & Drawers
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [modelModalOpen, setModelModalOpen] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);
  const [androidModalOpen, setAndroidModalOpen] = useState(false);
  const [inspectedModel, setInspectedModel] = useState<StoredModelRecord | null>(null);
  const [phoneFramePreview, setPhoneFramePreview] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [deviceProfile, setDeviceProfile] = useState<DeviceProfile | null>(null);

  // Model loading state
  const [persistToDevice, setPersistToDevice] = useState(true);
  const [loaderProgress, setLoaderProgress] = useState<LoaderProgress | null>(null);
  const [loaderError, setLoaderError] = useState<string | null>(null);

  // Composer & Streaming state
  const [inputText, setInputText] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachment[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatAttachmentInputRef = useRef<HTMLInputElement>(null);
  const quickArchiveInputRef = useRef<HTMLInputElement>(null);

  // Ensure activeConvId always points to a valid conversation
  const activeConversation =
    conversations.find((c) => c.id === activeConvId) || conversations[0];

  useEffect(() => {
    if (activeConversation && activeConversation.id !== activeConvId) {
      setActiveConvId(activeConversation.id);
    }
  }, [activeConversation, activeConvId]);

  // Apply theme attribute to document root
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    saveTheme(theme);
  }, [theme]);

  // Persist conversations & inference settings
  useEffect(() => {
    saveConversations(conversations);
  }, [conversations]);

  useEffect(() => {
    saveInferenceSettings(settings);
  }, [settings]);

  // Initial load of saved model records & storage estimate + Android hardware back button
  const refreshLibraryAndQuota = async () => {
    const [list, quota, profile] = await Promise.all([
      listStoredModels(),
      getDeviceStorageEstimate(),
      getDeviceProfile(),
    ]);
    setStoredModels(list);
    setStorageInfo(quota);
    setDeviceProfile(profile);
  };

  useEffect(() => {
    refreshLibraryAndQuota();

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    const subPromise = CapacitorApp.addListener('backButton', () => {
      if (inspectedModel) setInspectedModel(null);
      else if (androidModalOpen) setAndroidModalOpen(false);
      else if (controlsOpen) setControlsOpen(false);
      else if (modelModalOpen) setModelModalOpen(false);
      else if (drawerOpen) setDrawerOpen(false);
    });

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      subPromise.then((h) => h.remove()).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTriggerInstallPrompt = async () => {
    if (!installPrompt) {
      setAndroidModalOpen(true);
      return;
    }
    await installPrompt.prompt();
    await installPrompt.userChoice.catch(() => {});
    setInstallPrompt(null);
  };

  // Auto-scroll during chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeConversation?.messages.length, isGenerating]);

  // Auto-resize composer textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [inputText]);

  const confirmModelFit = (record: StoredModelRecord): boolean => {
    const assessment = getModelFitAssessment(
      record.totalBytes,
      deviceProfile,
      settings.contextSize
    );
    if (assessment.level === 'ok') return true;
    return window.confirm(
      `${assessment.message}\n\n${record.name} (${formatBytes(record.totalBytes)}) may make this phone slow or run out of memory. Continue anyway?`
    );
  };

  const handlePickedModelFiles = async (files: FileList | File[]) => {
    setLoaderError(null);
    try {
      const bundle = await processPickedModelFiles(files, setLoaderProgress);
      if (bundle.record.totalBytes > MAX_LOCAL_MODEL_BYTES) {
        throw new Error('This model is larger than Local’s 8 GB per-device model-library limit.');
      }
      const libraryBytes = storedModels.reduce((sum, model) => sum + model.totalBytes, 0);
      if (libraryBytes + bundle.record.totalBytes > MAX_MODEL_LIBRARY_BYTES) {
        throw new Error('The Local model library is limited to 8 GB total. Delete a model before adding another.');
      }
      if (!confirmModelFit(bundle.record)) {
        setLoaderProgress(null);
        return;
      }

      const quota = await getDeviceStorageEstimate();
      const storageAvailable = quota.quota > 0 ? Math.max(0, quota.quota - quota.usage) : 0;
      let shouldPersist =
        persistToDevice &&
        bundle.record.totalBytes <= MAX_LOCAL_MODEL_BYTES &&
        (storageAvailable > 0
          ? bundle.record.totalBytes + 256 * 1024 * 1024 <= storageAvailable
          : bundle.record.totalBytes <= 600 * 1024 * 1024);

      setLoaderProgress({
        stage: 'caching',
        percent: 74,
        detail: shouldPersist
          ? `Saving model data to on-device storage (up to 8 GB library)...`
          : 'Mounting this file for the current app session...',
      });

      let savedRec: StoredModelRecord;
      try {
        savedRec = await saveModelBundle(bundle, shouldPersist);
      } catch (storageError) {
        if (!shouldPersist) throw storageError;
        shouldPersist = false;
        savedRec = await saveModelBundle(bundle, false);
        setLoaderError('Phone storage did not allow a permanent copy. The model is loaded for this session only.');
      }
      bundle.record = savedRec;

      await inferenceEngine.activateModel(bundle, settings, setLoaderProgress);
      setActiveModel({ ...bundle.record });
      await refreshLibraryAndQuota();

      setTimeout(() => {
        setLoaderProgress(null);
        setModelModalOpen(false);
      }, 450);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to load picked archive.';
      setLoaderError(msg);
      setLoaderProgress({ stage: 'error', percent: 100, detail: msg });
    }
  };

  const handlePickNativeGguf = async () => {
    setLoaderError(null);
    setLoaderProgress({ stage: 'reading', percent: 4, detail: 'Choose a GGUF model from Android Files…' });
    let picked: Awaited<ReturnType<typeof pickAndStoreNativeGguf>> | null = null;
    let savedNativeModelId: string | null = null;
    let copyProgressHandle: Awaited<ReturnType<typeof addNativeModelCopyProgressListener>> = null;
    try {
      copyProgressHandle = await addNativeModelCopyProgressListener(({ bytesCopied, totalBytes }) => {
        const percent = totalBytes > 0 ? Math.round((bytesCopied / totalBytes) * 35) : 0;
        setLoaderProgress({
          stage: 'caching',
          percent: 5 + percent,
          detail: `Copying model into Local storage: ${formatBytes(bytesCopied)} / ${formatBytes(totalBytes)}…`,
        });
      });
      picked = await pickAndStoreNativeGguf();
      setLoaderProgress({
        stage: 'caching',
        percent: 40,
        detail: `Copied ${picked.name} (${formatBytes(picked.sizeBytes)}) into Local’s file-backed model storage.`,
      });

      const raw = atob(picked.headerBase64);
      const prefix = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) prefix[i] = raw.charCodeAt(i);
      const specs = await inspectGgufHeader(new Blob([prefix]), picked.name);
      const now = Date.now();
      const record: StoredModelRecord = {
        id: `native-model-${now}-${Math.random().toString(36).slice(2, 7)}`,
        name: specs.modelName || picked.name.replace(/\.gguf$/i, '').replace(/[-_]+/g, ' '),
        sourceLabel: 'Android native GGUF file',
        engine: 'llama-cpp-native',
        totalBytes: picked.sizeBytes,
        createdAt: now,
        lastUsedAt: now,
        persistedInIdb: true,
        nativePath: picked.path,
        entries: [{ path: picked.name, size: picked.sizeBytes, kind: 'gguf' }],
        specs,
      };

      const libraryBytes = storedModels.reduce((sum, model) => sum + model.totalBytes, 0);
      if (libraryBytes + record.totalBytes > MAX_MODEL_LIBRARY_BYTES) {
        await deleteNativeStoredModel(picked.path);
        throw new Error('The Local model library is limited to 8 GB total. Delete a model before adding another.');
      }
      if (!confirmModelFit(record)) {
        await deleteNativeStoredModel(picked.path);
        setLoaderProgress(null);
        return;
      }

      const bundle: LoadedModelBundle = { record, files: new Map() };
      const savedRec = await saveModelBundle(bundle, true);
      savedNativeModelId = savedRec.id;
      bundle.record = savedRec;
      await inferenceEngine.activateModel(bundle, settings, setLoaderProgress);
      setActiveModel({ ...bundle.record });
      await refreshLibraryAndQuota();
      setTimeout(() => {
        setLoaderProgress(null);
        setModelModalOpen(false);
      }, 450);
    } catch (err: unknown) {
      if (savedNativeModelId) await deleteStoredModel(savedNativeModelId).catch(() => {});
      if (picked?.path && !storedModels.some((model) => model.nativePath === picked?.path)) {
        await deleteNativeStoredModel(picked.path).catch(() => {});
      }
      const msg = err instanceof Error ? err.message : 'Could not import the GGUF model.';
      setLoaderError(msg);
      setLoaderProgress({ stage: 'error', percent: 100, detail: msg });
    } finally {
      if (copyProgressHandle) await copyProgressHandle.remove().catch(() => {});
    }
  };

  const handleActivateStoredModel = async (id: string) => {
    setLoaderError(null);
    try {
      setLoaderProgress({
        stage: 'reading',
        percent: 30,
        detail: 'Restoring model archive from on-device storage...',
      });
      const bundle = await loadModelBundleById(id);
      if (!bundle) {
        throw new Error(
          'This large model was loaded as a direct session handle. Please re-pick its file from storage to mount it.'
        );
      }
      if (!confirmModelFit(bundle.record)) {
        setLoaderProgress(null);
        return;
      }
      await inferenceEngine.activateModel(bundle, settings, setLoaderProgress);
      await touchModelLastUsed(id);
      setActiveModel({ ...bundle.record });
      await refreshLibraryAndQuota();
      setTimeout(() => {
        setLoaderProgress(null);
        setModelModalOpen(false);
      }, 350);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not activate saved model.';
      setLoaderError(msg);
      setLoaderProgress(null);
    }
  };

  const handleUnloadActiveModel = async () => {
    await inferenceEngine.unload();
    setActiveModel(null);
    setLoaderProgress(null);
  };

  const handleDeleteModel = async (id: string) => {
    const model = storedModels.find((item) => item.id === id);
    if (activeModel?.id === id) {
      await inferenceEngine.unload();
      setActiveModel(null);
    }
    if (model?.nativePath) {
      try {
        await deleteNativeStoredModel(model.nativePath);
      } catch (err) {
        setLoaderError(err instanceof Error ? err.message : 'Could not remove native model file.');
        return;
      }
    }
    await deleteStoredModel(id);
    await refreshLibraryAndQuota();
  };

  const handleDownloadSampleZip = () => {
    const zipBytes = buildSampleModelArchiveZip();
    const blob = new Blob([zipBytes as BlobPart], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'local-starter-assistant.zip';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const handleQuickLoadStarter = async () => {
    const zipBytes = buildSampleModelArchiveZip();
    const file = new File([zipBytes as BlobPart], 'local-starter-assistant.zip', {
      type: 'application/zip',
    });
    await handlePickedModelFiles([file]);
  };

  const handleAttachChatFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const newAttachments: ChatAttachment[] = [];
    for (const file of Array.from(fileList)) {
      // Check if user accidentally attached a .gguf or model .zip in chat composer — offer to load as model!
      const lower = file.name.toLowerCase();
      if (lower.endsWith('.gguf') || lower.endsWith('.onnx') || lower.endsWith('.safetensors')) {
        setModelModalOpen(true);
        await handlePickedModelFiles([file]);
        return;
      }
      const text = await file.slice(0, 128 * 1024).text();
      newAttachments.push({
        id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: file.name,
        size: file.size,
        mimeType: file.type || 'text/plain',
        textContent: text,
        lineCount: text.split('\n').length,
      });
    }
    setPendingAttachments((prev) => [...prev, ...newAttachments]);
  };

  const updateConversationMessages = (
    convId: string,
    updater: (msgs: ChatMessage[], currentTitle: string) => { messages: ChatMessage[]; title?: string }
  ) => {
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== convId) return c;
        const res = updater(c.messages, c.title);
        return {
          ...c,
          title: res.title ?? c.title,
          messages: res.messages,
          updatedAt: Date.now(),
        };
      })
    );
  };

  const runAssistantTurn = async (convId: string, historyForTurn: ChatMessage[]) => {
    if (!activeModel) {
      setModelModalOpen(true);
      return;
    }

    const assistantMsgId = `msg-${Date.now()}-ai`;
    const placeholder: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      reasoning: '',
      createdAt: Date.now(),
      modelName: activeModel.name,
    };

    updateConversationMessages(convId, (msgs) => ({
      messages: [...msgs, placeholder],
    }));

    setIsGenerating(true);

    try {
      const result = await inferenceEngine.generateChatStream(historyForTurn, settings, {
        onToken: (partialContent, partialReasoning) => {
          updateConversationMessages(convId, (msgs) => ({
            messages: msgs.map((m) =>
              m.id === assistantMsgId
                ? { ...m, content: partialContent, reasoning: partialReasoning }
                : m
            ),
          }));
        },
      });

      updateConversationMessages(convId, (msgs) => ({
        messages: msgs.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                content: result.content,
                reasoning: result.reasoning,
                metrics: result.metrics,
              }
            : m
        ),
      }));
    } catch (err: unknown) {
      const detail = describeInferenceError(err);
      const errText = `${detail}\n\nTry Settings → Phone-safe, unload the model, then load it again. If this model is over 1 GB, try a smaller Q4 GGUF model.`;
      updateConversationMessages(convId, (msgs) => ({
        messages: msgs.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                content: errText,
                isError: true,
              }
            : m
        ),
      }));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSendMessage = async (overridePrompt?: string) => {
    const text = (overridePrompt ?? inputText).trim();
    if ((!text && pendingAttachments.length === 0) || isGenerating) return;

    if (!activeModel) {
      setModelModalOpen(true);
      return;
    }

    const userMsg: ChatMessage = {
      id: `msg-${Date.now()}-usr`,
      role: 'user',
      content: text || 'Analyze the attached file(s).',
      attachments: pendingAttachments.length > 0 ? pendingAttachments : undefined,
      createdAt: Date.now(),
    };

    const convId = activeConversation.id;
    const nextHistory = [...activeConversation.messages, userMsg];

    const derivedTitle =
      activeConversation.messages.length === 0
        ? (text || pendingAttachments[0]?.name || 'New Chat').slice(0, 42)
        : activeConversation.title;

    updateConversationMessages(convId, () => ({
      messages: nextHistory,
      title: derivedTitle,
    }));

    if (!overridePrompt) {
      setInputText('');
      setPendingAttachments([]);
    }

    await runAssistantTurn(convId, nextHistory);
  };

  const handleRegenerateLast = async () => {
    if (isGenerating || !activeConversation) return;
    const msgs = [...activeConversation.messages];
    if (msgs.length === 0) return;
    if (msgs[msgs.length - 1].role === 'assistant') {
      msgs.pop();
    }
    if (msgs.length === 0) return;

    updateConversationMessages(activeConversation.id, () => ({ messages: msgs }));
    await runAssistantTurn(activeConversation.id, msgs);
  };

  const handleNewChat = () => {
    if (isGenerating) inferenceEngine.stopGeneration();
    const fresh = createFreshConversation();
    setConversations((prev) => [fresh, ...prev]);
    setActiveConvId(fresh.id);
    setInputText('');
    setPendingAttachments([]);
  };

  const handleDeleteConversation = (id: string) => {
    setConversations((prev) => {
      const remaining = prev.filter((c) => c.id !== id);
      if (remaining.length === 0) {
        const fresh = createFreshConversation();
        setActiveConvId(fresh.id);
        return [fresh];
      }
      if (id === activeConvId) {
        setActiveConvId(remaining[0].id);
      }
      return remaining;
    });
  };

  const handleTogglePin = (id: string) => {
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, pinned: !c.pinned } : c))
    );
  };

  const handleExportConversation = (conv: Conversation) => {
    const md = [
      `# ${conv.title}`,
      `_Exported from Local (On-Device AI) — ${new Date(conv.updatedAt).toLocaleString()}_`,
      '',
      ...conv.messages.map(
        (m) => `### ${m.role === 'user' ? 'You' : m.modelName || 'Local'}\n\n${m.content}\n`
      ),
    ].join('\n');
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${conv.title.replace(/[^a-z0-9-_]+/gi, '_').toLowerCase() || 'chat'}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  const copyMessageText = (msg: ChatMessage) => {
    navigator.clipboard?.writeText(msg.content);
    setCopiedMsgId(msg.id);
    setTimeout(() => setCopiedMsgId(null), 1600);
  };

  const appShell = (
    <div
      className="relative flex flex-col w-full h-full overflow-hidden safe-top safe-bottom"
      style={{ backgroundColor: 'var(--bg-main)', color: 'var(--text-primary)' }}
    >
      {/* Hidden quick archive input for empty-state hero button */}
      <input
        ref={quickArchiveInputRef}
        type="file"
        multiple
        accept=".gguf,.zip,.tar,.gz,.tgz,.onnx,.safetensors,.bin,application/octet-stream,application/zip,*/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) {
            setModelModalOpen(true);
            handlePickedModelFiles(e.target.files);
          }
          e.target.value = '';
        }}
      />
      <input
        ref={chatAttachmentInputRef}
        type="file"
        multiple
        accept=".txt,.md,.json,.csv,.js,.ts,.tsx,.py,.java,.kt,.xml,.html,.css,.yaml,.yml,.log"
        className="hidden"
        onChange={(e) => {
          handleAttachChatFiles(e.target.files);
          e.target.value = '';
        }}
      />

      {/* Top Navigation Bar (Android Claude / ChatGPT Style) */}
      <header
        className="h-14 px-3 sm:px-4 flex items-center justify-between gap-2 border-b shrink-0 z-10"
        style={{
          backgroundColor: 'var(--bg-main)',
          borderColor: 'var(--border-subtle)',
        }}
      >
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            className="p-2 rounded-xl transition-colors hover:opacity-80"
            style={{ color: 'var(--text-secondary)' }}
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>

        {/* Center Active Model / Archive Pill */}
        <button
          type="button"
          onClick={() => setModelModalOpen(true)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full border max-w-[60vw] sm:max-w-xs transition-all active:scale-[0.98]"
          style={{
            backgroundColor: activeModel ? 'var(--bg-surface)' : 'var(--accent-soft)',
            borderColor: activeModel ? 'var(--border-strong)' : 'var(--accent)',
          }}
        >
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              activeModel ? 'bg-emerald-500' : 'animate-pulse'
            }`}
            style={!activeModel ? { backgroundColor: 'var(--accent)' } : undefined}
          />
          <span className="text-xs sm:text-sm font-medium truncate">
            {activeModel ? activeModel.name : 'Pick Model / Archive'}
          </span>
          <ChevronDown className="w-3.5 h-3.5 shrink-0 opacity-65" />
        </button>

        {/* Right Controls */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setAndroidModalOpen(true)}
            title="Install Local on your phone (APK or 1-Tap App)"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-medium transition-opacity hover:opacity-85"
            style={{
              backgroundColor: 'var(--accent-soft)',
              borderColor: 'var(--accent)',
              color: 'var(--text-primary)',
            }}
          >
            <Smartphone className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
            <span className="hidden sm:inline">Phone App</span>
          </button>

          <button
            type="button"
            onClick={() => setPhoneFramePreview((p) => !p)}
            title={phoneFramePreview ? 'Switch to Fullscreen View' : 'Preview Android Phone Frame'}
            className="hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs transition-opacity hover:opacity-85"
            style={{
              backgroundColor: phoneFramePreview ? 'var(--accent-soft)' : 'var(--bg-surface)',
              borderColor: phoneFramePreview ? 'var(--accent)' : 'var(--border-subtle)',
              color: 'var(--text-secondary)',
            }}
          >
            {phoneFramePreview ? (
              <>
                <Maximize2 className="w-3.5 h-3.5" />
                <span>Expand</span>
              </>
            ) : (
              <>
                <Smartphone className="w-3.5 h-3.5" />
                <span>Frame</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => setControlsOpen(true)}
            title="Model Parameters & System Prompt"
            className="p-2 rounded-xl transition-opacity hover:opacity-80"
            style={{ color: 'var(--text-secondary)' }}
          >
            <SlidersHorizontal className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={handleNewChat}
            title="New Conversation"
            className="p-2 rounded-xl transition-opacity hover:opacity-80"
            style={{ color: 'var(--text-secondary)' }}
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Chat Viewport */}
      <main className="flex-1 overflow-y-auto px-4 sm:px-6">
        <div className="max-w-3xl mx-auto py-6">
          {activeConversation.messages.length === 0 ? (
            /* Empty Welcome State (Claude / ChatGPT Android Style) */
            <div className="min-h-[62vh] flex flex-col items-center justify-center text-center space-y-6 py-4">
              <div className="space-y-3 flex flex-col items-center">
                <LocalLogo size={54} />
                <div className="space-y-1">
                  <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
                    {activeModel ? 'How can I help locally?' : 'Welcome to Local'}
                  </h1>
                  <p
                    className="text-xs sm:text-sm max-w-md mx-auto leading-relaxed"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    Private on-device AI for Android. Load your own{' '}
                    <code className="font-mono">.gguf</code> models or{' '}
                    <code className="font-mono">.zip</code> /{' '}
                    <code className="font-mono">.tar.gz</code> archives — 100% offline.
                  </p>
                </div>

                {/* Offline & Engine Status Pill */}
                <div
                  className="inline-flex items-center gap-2 px-3 py-1 rounded-full border text-[11px]"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    borderColor: 'var(--border-subtle)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <WifiOff className="w-3 h-3" style={{ color: 'var(--accent)' }} />
                  <span>Zero cloud traffic</span>
                  <span>•</span>
                  <ShieldCheck className="w-3 h-3 text-emerald-500" />
                  <span>Runs on your device</span>
                </div>
              </div>

              {/* Hero Archive Picker Card when no model is mounted yet */}
              {!activeModel ? (
                <div
                  className="w-full max-w-md rounded-2xl border p-4 text-left space-y-3 shadow-sm"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    borderColor: 'var(--border-strong)',
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                      style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                    >
                      <Archive className="w-5 h-5" />
                    </div>
                    <div className="space-y-0.5">
                      <div className="font-semibold text-sm">Load an AI Model or Archive</div>
                      <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                        Pick a <code className="font-mono">.gguf</code> weight file or{' '}
                        <code className="font-mono">.zip</code> / <code className="font-mono">.tar.gz</code>{' '}
                        archive from your device storage, or mount the built-in starter{' '}
                        <code className="font-mono">.zip</code> archive to test immediately.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => quickArchiveInputRef.current?.click()}
                      className="flex items-center justify-center gap-2 py-2.5 px-3.5 rounded-xl text-xs font-semibold transition-transform active:scale-[0.98]"
                      style={{
                        backgroundColor: 'var(--accent)',
                        color: 'var(--accent-text)',
                      }}
                    >
                      <Archive className="w-4 h-4" />
                      <span>Pick File / Archive</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleQuickLoadStarter}
                      className="flex items-center justify-center gap-2 py-2.5 px-3.5 rounded-xl border text-xs font-medium transition-transform active:scale-[0.98]"
                      style={{
                        backgroundColor: 'var(--bg-main)',
                        borderColor: 'var(--border-strong)',
                      }}
                    >
                      <Sparkles className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                      <span>Try Starter .zip</span>
                    </button>
                  </div>
                </div>
              ) : (
                /* Starter Prompt Grid once a model IS active */
                <div className="w-full max-w-xl grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-left">
                  {STARTER_PROMPTS.map((item) => (
                    <button
                      key={item.title}
                      type="button"
                      onClick={() => handleSendMessage(item.prompt)}
                      className="p-3.5 rounded-2xl border transition-all text-left hover:opacity-95 active:scale-[0.99]"
                      style={{
                        backgroundColor: 'var(--bg-surface)',
                        borderColor: 'var(--border-subtle)',
                      }}
                    >
                      <div className="text-xs font-semibold">{item.title}</div>
                      <div
                        className="text-[11px] mt-0.5 truncate"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {item.subtitle}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* Conversation Thread */
            <div className="space-y-6 pb-4">
              {activeConversation.messages.map((msg, idx) => {
                const isLast = idx === activeConversation.messages.length - 1;
                if (msg.role === 'user') {
                  return (
                    <div key={msg.id} className="flex flex-col items-end space-y-1.5">
                      {msg.attachments && msg.attachments.length > 0 && (
                        <div className="flex flex-wrap justify-end gap-1.5 max-w-[88%]">
                          {msg.attachments.map((att) => (
                            <div
                              key={att.id}
                              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs"
                              style={{
                                backgroundColor: 'var(--bg-surface)',
                                borderColor: 'var(--border-subtle)',
                              }}
                            >
                              <FileText
                                className="w-3.5 h-3.5 shrink-0"
                                style={{ color: 'var(--accent)' }}
                              />
                              <span className="font-mono truncate max-w-[160px]">{att.name}</span>
                              <span
                                className="text-[10px]"
                                style={{ color: 'var(--text-muted)' }}
                              >
                                {formatBytes(att.size)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div
                        className="max-w-[86%] sm:max-w-[78%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap break-words"
                        style={{
                          backgroundColor: 'var(--bg-user-bubble)',
                          color: 'var(--text-primary)',
                        }}
                      >
                        {msg.content}
                      </div>
                    </div>
                  );
                }

                // Assistant Turn
                return (
                  <div key={msg.id} className="flex items-start gap-3">
                    <div className="mt-0.5 shrink-0">
                      <LocalLogo size={26} />
                    </div>
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex items-center gap-2 text-xs">
                        <span className="font-semibold">{msg.modelName || 'Local'}</span>
                        {msg.metrics && (
                          <span
                            className="inline-flex items-center gap-1 text-[11px] font-mono"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            <Zap className="w-3 h-3" style={{ color: 'var(--accent)' }} />
                            <span>{msg.metrics.tokensPerSec} tok/s</span>
                            <span>·</span>
                            <span>{msg.metrics.totalTokens} tok</span>
                          </span>
                        )}
                      </div>

                      {msg.isError ? (
                        <div className="p-3.5 rounded-xl border border-red-500/40 bg-red-500/10 text-red-300 text-xs leading-relaxed">
                          {msg.content}
                        </div>
                      ) : (
                        <MarkdownMessage
                          content={msg.content}
                          reasoning={msg.reasoning}
                          isStreaming={isGenerating && isLast}
                        />
                      )}

                      {(!isGenerating || !isLast) && msg.content && (
                        <div
                          className="flex items-center gap-1 pt-0.5"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          <button
                            type="button"
                            onClick={() => copyMessageText(msg)}
                            className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] hover:opacity-80"
                          >
                            {copiedMsgId === msg.id ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-500" />
                                <span className="text-emerald-500">Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                <span>Copy</span>
                              </>
                            )}
                          </button>

                          {isLast && (
                            <button
                              type="button"
                              onClick={handleRegenerateLast}
                              className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] hover:opacity-80"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                              <span>Retry</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </main>

      {/* Bottom Floating Composer (ChatGPT / Claude Mobile Pill) */}
      <footer className="px-3 sm:px-6 pb-3 pt-1.5 shrink-0">
        <div className="max-w-3xl mx-auto">
          <div
            className="rounded-3xl border shadow-lg px-3 py-2 transition-colors"
            style={{
              backgroundColor: 'var(--bg-composer)',
              borderColor: 'var(--border-strong)',
            }}
          >
            {/* Pending File Attachments Strip */}
            {pendingAttachments.length > 0 && (
              <div className="flex flex-wrap gap-1.5 px-1 pb-2 mb-1.5 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                {pendingAttachments.map((att) => (
                  <div
                    key={att.id}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-xs"
                    style={{
                      backgroundColor: 'var(--bg-surface)',
                      borderColor: 'var(--border-subtle)',
                    }}
                  >
                    <FileText className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                    <span className="font-mono truncate max-w-[140px]">{att.name}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setPendingAttachments((prev) => prev.filter((x) => x.id !== att.id))
                      }
                      className="p-0.5 rounded-full hover:opacity-80"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-end gap-2">
              <button
                type="button"
                onClick={() => chatAttachmentInputRef.current?.click()}
                title="Attach local document or code file"
                className="p-2 rounded-full shrink-0 transition-opacity hover:opacity-80"
                style={{
                  backgroundColor: 'var(--bg-elevated)',
                  color: 'var(--text-secondary)',
                }}
              >
                <Paperclip className="w-4 h-4" />
              </button>

              <textarea
                ref={textareaRef}
                rows={1}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && window.innerWidth >= 640) {
                    e.preventDefault();
                    handleSendMessage();
                  }
                }}
                placeholder={
                  activeModel
                    ? `Message ${activeModel.name}...`
                    : 'Pick a model archive (.gguf / .zip) or type to start...'
                }
                className="flex-1 bg-transparent resize-none py-1.5 px-1 text-[15px] leading-relaxed focus:outline-none max-h-40"
                style={{ color: 'var(--text-primary)' }}
              />

              {isGenerating ? (
                <button
                  type="button"
                  onClick={() => inferenceEngine.stopGeneration()}
                  aria-label="Stop generating"
                  className="p-2.5 rounded-full shrink-0 transition-transform active:scale-95"
                  style={{
                    backgroundColor: 'var(--text-primary)',
                    color: 'var(--bg-main)',
                  }}
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!inputText.trim() && pendingAttachments.length === 0}
                  onClick={() => handleSendMessage()}
                  aria-label="Send message"
                  className="p-2.5 rounded-full shrink-0 transition-all active:scale-95 disabled:opacity-35"
                  style={{
                    backgroundColor: 'var(--accent)',
                    color: 'var(--accent-text)',
                  }}
                >
                  <ArrowUp className="w-4 h-4 stroke-[2.5]" />
                </button>
              )}
            </div>
          </div>

          <div
            className="text-center text-[10px] mt-1.5 flex items-center justify-center gap-2"
            style={{ color: 'var(--text-muted)' }}
          >
            <span>
              {activeModel
                ? `${inferenceEngine.describeEngine(activeModel.engine)} · Offline`
                : 'No model mounted — tap top bar to pick .gguf or .zip archive'}
            </span>
          </div>
        </div>
      </footer>

      {/* Slide-Over Navigation & Library Drawer */}
      <SidebarDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        conversations={conversations}
        activeConversationId={activeConversation.id}
        onSelectConversation={setActiveConvId}
        onNewChat={handleNewChat}
        onDeleteConversation={handleDeleteConversation}
        onTogglePin={handleTogglePin}
        onExportConversation={handleExportConversation}
        activeModel={activeModel}
        storedCount={storedModels.length}
        onOpenModelModal={() => setModelModalOpen(true)}
        theme={theme}
        onChangeTheme={setTheme}
        onOpenAndroidModal={() => setAndroidModalOpen(true)}
      />

      {/* Model & Archive Picker Modal */}
      <ModelArchiveModal
        isOpen={modelModalOpen}
        onClose={() => setModelModalOpen(false)}
        models={storedModels}
        activeModelId={activeModel?.id ?? null}
        progress={loaderProgress}
        errorMsg={loaderError}
        storageInfo={storageInfo}
        deviceProfile={deviceProfile}
        persistToDevice={persistToDevice}
        onTogglePersist={setPersistToDevice}
        onFilesPicked={handlePickedModelFiles}
        onPickNativeGguf={handlePickNativeGguf}
        onActivateStoredModel={handleActivateStoredModel}
        onUnloadActiveModel={handleUnloadActiveModel}
        onDeleteModel={handleDeleteModel}
        onInspectModel={(m) => setInspectedModel(m)}
        onDownloadSampleZip={handleDownloadSampleZip}
        onQuickLoadStarter={handleQuickLoadStarter}
      />

      {/* Binary Header & Archive Tree Inspector */}
      <ModelInspectorSheet
        model={inspectedModel}
        onClose={() => setInspectedModel(null)}
      />

      {/* Inference Parameters & System Prompt Studio */}
      <InferenceControlsSheet
        isOpen={controlsOpen}
        onClose={() => setControlsOpen(false)}
        settings={settings}
        onChange={setSettings}
      />

      {/* Android APK & Hardware Status Modal */}
      <AndroidInstallModal
        isOpen={androidModalOpen}
        onClose={() => setAndroidModalOpen(false)}
        storageInfo={storageInfo}
        deviceProfile={deviceProfile}
        installPrompt={installPrompt}
        onTriggerInstallPrompt={handleTriggerInstallPrompt}
      />
    </div>
  );

  // Optional Android Pixel Device Frame when toggled on desktop screens
  if (phoneFramePreview) {
    return (
      <div className="w-full h-full bg-[#0b0b0b] flex items-center justify-center p-4 overflow-hidden">
        <div className="relative w-[404px] h-[min(860px,95vh)] rounded-[44px] border-[10px] border-[#262626] shadow-[0_25px_80px_rgba(0,0,0,0.85)] overflow-hidden flex flex-col bg-black">
          {/* Android Punch-Hole Status Bar */}
          <div
            className="h-7 px-6 flex items-center justify-between text-[11px] font-medium shrink-0 select-none"
            style={{ backgroundColor: 'var(--bg-main)', color: 'var(--text-secondary)' }}
          >
            <span>9:41</span>
            <span className="w-3 h-3 rounded-full bg-black border border-white/10" />
            <span>5G · 100%</span>
          </div>
          <div className="flex-1 min-h-0 relative overflow-hidden">{appShell}</div>
          {/* Android Gesture Navigation Pill */}
          <div
            className="h-4 flex items-center justify-center shrink-0"
            style={{ backgroundColor: 'var(--bg-main)' }}
          >
            <div className="w-28 h-1 rounded-full bg-white/30" />
          </div>
        </div>
      </div>
    );
  }

  return appShell;
};

export default App;
