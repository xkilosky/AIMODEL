import React, { useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  Archive,
  CheckCircle2,
  Cpu,
  Download,
  FileBox,
  FolderOpen,
  HardDrive,
  Info,
  Loader2,
  Play,
  PowerOff,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { LoaderProgress, StoredModelRecord } from '../types/local';
import type { DeviceProfile } from '../services/nativeDevice';
import { formatBytes } from '../services/binaryInspectors';

interface ModelArchiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  models: StoredModelRecord[];
  activeModelId: string | null;
  progress: LoaderProgress | null;
  errorMsg: string | null;
  storageInfo: { usage: number; quota: number };
  deviceProfile: DeviceProfile | null;
  persistToDevice: boolean;
  onTogglePersist: (val: boolean) => void;
  onFilesPicked: (files: FileList | File[]) => void;
  onPickNativeGguf: () => void;
  onActivateStoredModel: (id: string) => void;
  onUnloadActiveModel: () => void;
  onDeleteModel: (id: string) => void;
  onInspectModel: (model: StoredModelRecord) => void;
  onDownloadSampleZip: () => void;
  onQuickLoadStarter: () => void;
}

export const ModelArchiveModal: React.FC<ModelArchiveModalProps> = ({
  isOpen,
  onClose,
  models,
  activeModelId,
  progress,
  errorMsg,
  storageInfo,
  deviceProfile,
  persistToDevice,
  onTogglePersist,
  onFilesPicked,
  onPickNativeGguf,
  onActivateStoredModel,
  onUnloadActiveModel,
  onDeleteModel,
  onInspectModel,
  onDownloadSampleZip,
  onQuickLoadStarter,
}) => {
  const ggufInputRef = useRef<HTMLInputElement>(null);
  const archiveInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  if (!isOpen) return null;

  const isBusy = Boolean(
    progress &&
      progress.stage !== 'ready' &&
      progress.stage !== 'error'
  );

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFilesPicked(e.dataTransfer.files);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4">
      <div
        className="w-full sm:max-w-2xl max-h-[92vh] flex flex-col rounded-t-3xl sm:rounded-2xl border shadow-2xl overflow-hidden"
        style={{
          backgroundColor: 'var(--bg-main)',
          borderColor: 'var(--border-strong)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b shrink-0"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <div>
            <h2 className="text-base sm:text-lg font-semibold tracking-tight">
              Load Model & Archives
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
              Pick <code className="font-mono">.gguf</code> files,{' '}
              <code className="font-mono">.zip</code> / <code className="font-mono">.tar.gz</code>{' '}
              archives, or ONNX folders from your device
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full transition-opacity hover:opacity-80"
            style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-secondary)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Hidden Native-Compatible File Inputs */}
        {/* Note: includes application/octet-stream so Android SAF DocumentsUI never greys out .gguf/.safetensors */}
        <input
          ref={ggufInputRef}
          type="file"
          multiple
          accept=".gguf,.bin,.onnx,.safetensors,application/octet-stream,*/*"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) onFilesPicked(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={archiveInputRef}
          type="file"
          accept=".zip,.tar,.gz,.tgz,application/zip,application/gzip,application/x-tar,application/octet-stream"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) onFilesPicked(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          // @ts-expect-error webkitdirectory is supported by Chromium / Android WebView
          webkitdirectory="true"
          directory=""
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) onFilesPicked(e.target.files);
            e.target.value = '';
          }}
        />

        <div className="p-5 overflow-y-auto space-y-5">
          {/* 3 Primary Picker Cards */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            className={`rounded-2xl border-2 border-dashed p-3.5 transition-all ${
              isDragging ? 'scale-[1.01]' : ''
            }`}
            style={{
              borderColor: isDragging ? 'var(--accent)' : 'var(--border-strong)',
              backgroundColor: isDragging ? 'var(--accent-soft)' : 'var(--bg-surface)',
            }}
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <button
                type="button"
                disabled={isBusy}
                onClick={() => ggufInputRef.current?.click()}
                className="flex sm:flex-col items-center sm:items-start gap-3 sm:gap-2 p-3.5 rounded-xl border text-left transition-transform active:scale-[0.98] hover:opacity-95 disabled:opacity-50"
                style={{
                  backgroundColor: 'var(--bg-main)',
                  borderColor: 'var(--border-subtle)',
                }}
              >
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                >
                  <FileBox className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-sm font-semibold">Pick Model File</div>
                  <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    .gguf, .onnx, .safetensors, .bin
                  </div>
                </div>
              </button>

              <button
                type="button"
                disabled={isBusy}
                onClick={() => archiveInputRef.current?.click()}
                className="flex sm:flex-col items-center sm:items-start gap-3 sm:gap-2 p-3.5 rounded-xl border text-left transition-transform active:scale-[0.98] hover:opacity-95 disabled:opacity-50"
                style={{
                  backgroundColor: 'var(--bg-main)',
                  borderColor: 'var(--border-subtle)',
                }}
              >
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                >
                  <Archive className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-sm font-semibold">Pick Archive</div>
                  <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    .zip, .tar.gz, .tgz, .tar
                  </div>
                </div>
              </button>

              <button
                type="button"
                disabled={isBusy}
                onClick={() => folderInputRef.current?.click()}
                className="flex sm:flex-col items-center sm:items-start gap-3 sm:gap-2 p-3.5 rounded-xl border text-left transition-transform active:scale-[0.98] hover:opacity-95 disabled:opacity-50"
                style={{
                  backgroundColor: 'var(--bg-main)',
                  borderColor: 'var(--border-subtle)',
                }}
              >
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
                >
                  <FolderOpen className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-sm font-semibold">Pick Folder</div>
                  <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    ONNX / Transformers dir
                  </div>
                </div>
              </button>

              {Capacitor.isNativePlatform() && (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={onPickNativeGguf}
                  className="flex sm:flex-col items-center sm:items-start gap-3 sm:gap-2 p-3.5 rounded-xl border text-left transition-transform active:scale-[0.98] hover:opacity-95 disabled:opacity-50"
                  style={{
                    backgroundColor: 'var(--accent-soft)',
                    borderColor: 'var(--accent)',
                  }}
                >
                  <div
                    className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                    style={{ backgroundColor: 'var(--bg-main)', color: 'var(--accent)' }}
                  >
                    <HardDrive className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold">Large GGUF (Native)</div>
                    <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                      Stream-copied to phone storage · up to 8 GB
                    </div>
                  </div>
                </button>
              )}
            </div>

            <div className="mt-3 pt-2.5 border-t flex flex-wrap items-center justify-between gap-2 text-xs" style={{ borderColor: 'var(--border-subtle)' }}>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={persistToDevice}
                  onChange={(e) => onTogglePersist(e.target.checked)}
                  className="rounded accent-amber-600"
                />
                <span style={{ color: 'var(--text-secondary)' }}>
                  Save archive in on-device storage (IndexedDB)
                </span>
              </label>
              <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                <Upload className="w-3 h-3" />
                <span>Or drag & drop archive here</span>
              </span>
            </div>
          </div>

          {deviceProfile && (
            <div
              className="px-3.5 py-2.5 rounded-xl border text-[11px] leading-relaxed"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-subtle)',
                color: 'var(--text-secondary)',
              }}
            >
              <strong style={{ color: 'var(--text-primary)' }}>
                {deviceProfile.manufacturer && deviceProfile.model
                  ? `${deviceProfile.manufacturer} ${deviceProfile.model}`
                  : deviceProfile.model || deviceProfile.manufacturer || 'This phone'}
              </strong>
              {' · '}
              {deviceProfile.totalRamBytes
                ? `${formatBytes(deviceProfile.totalRamBytes)} RAM`
                : deviceProfile.deviceMemoryGb
                  ? `about ${deviceProfile.deviceMemoryGb} GB RAM`
                  : 'RAM estimate unavailable'}
              {deviceProfile.isNative && (
                <>
                  {' · Model library '}
                  {formatBytes(deviceProfile.modelStorageUsedBytes || 0)} / 8 GB
                </>
              )}
            </div>
          )}

          {/* Live Progress Bar */}
          {progress && (
            <div
              className="p-3.5 rounded-xl border space-y-2"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-strong)',
              }}
            >
              <div className="flex items-center justify-between text-xs font-medium">
                <span className="flex items-center gap-2">
                  {progress.stage === 'ready' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  ) : (
                    <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--accent)' }} />
                  )}
                  <span>{progress.detail}</span>
                </span>
                <span className="font-mono">{progress.percent}%</span>
              </div>
              <div
                className="w-full h-1.5 rounded-full overflow-hidden"
                style={{ backgroundColor: 'var(--bg-elevated)' }}
              >
                <div
                  className="h-full transition-all duration-300 rounded-full"
                  style={{
                    width: `${progress.percent}%`,
                    backgroundColor: 'var(--accent)',
                  }}
                />
              </div>
            </div>
          )}

          {/* Error Banner */}
          {errorMsg && (
            <div className="p-3.5 rounded-xl border border-red-500/40 bg-red-500/10 text-red-300 text-xs leading-relaxed">
              {errorMsg}
            </div>
          )}

          {/* Quick Test Starter Archive Card */}
          <div
            className="rounded-xl border p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-subtle)',
            }}
          >
            <div className="space-y-0.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold">
                <Sparkles className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                <span>Need a sample .zip archive to test right now?</span>
              </div>
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                Export a lightweight <code className="font-mono">local-starter-assistant.zip</code>{' '}
                to your Downloads folder to test archive picking, or mount it in one tap.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={isBusy}
                onClick={onDownloadSampleZip}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-medium transition-opacity hover:opacity-85"
                style={{
                  backgroundColor: 'var(--bg-main)',
                  borderColor: 'var(--border-strong)',
                }}
              >
                <Download className="w-3.5 h-3.5" />
                <span>Save .zip</span>
              </button>
              <button
                type="button"
                disabled={isBusy}
                onClick={onQuickLoadStarter}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-opacity hover:opacity-90"
                style={{
                  backgroundColor: 'var(--accent)',
                  color: 'var(--accent-text)',
                }}
              >
                <Play className="w-3.5 h-3.5" />
                <span>Mount Starter</span>
              </button>
            </div>
          </div>

          {/* Saved On-Device Models List */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <span
                className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5"
                style={{ color: 'var(--text-muted)' }}
              >
                <HardDrive className="w-3.5 h-3.5" />
                <span>Your Models & Archives ({models.length})</span>
              </span>
              {storageInfo.quota > 0 && (
                <span className="text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
                  {formatBytes(storageInfo.usage)} / {formatBytes(storageInfo.quota)}
                </span>
              )}
            </div>

            {models.length === 0 ? (
              <div
                className="rounded-xl border p-6 text-center space-y-1.5"
                style={{
                  backgroundColor: 'var(--bg-surface)',
                  borderColor: 'var(--border-subtle)',
                }}
              >
                <Cpu className="w-6 h-6 mx-auto opacity-50" />
                <div className="text-sm font-medium">No local models loaded yet</div>
                <p className="text-xs max-w-md mx-auto" style={{ color: 'var(--text-muted)' }}>
                  Pick any <code className="font-mono">.gguf</code> model (like Qwen 2.5, Llama
                  3.2, Gemma 2, SmolLM2) or a <code className="font-mono">.zip</code> model archive
                  from your Android storage above.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {models.map((m) => {
                  const isActive = m.id === activeModelId;
                  return (
                    <div
                      key={m.id}
                      className="rounded-xl border p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors"
                      style={{
                        backgroundColor: isActive ? 'var(--accent-soft)' : 'var(--bg-surface)',
                        borderColor: isActive ? 'var(--accent)' : 'var(--border-subtle)',
                      }}
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm truncate">{m.name}</span>
                          {isActive && (
                            <span
                              className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full"
                              style={{
                                backgroundColor: 'var(--accent)',
                                color: 'var(--accent-text)',
                              }}
                            >
                              Active
                            </span>
                          )}
                          <span
                            className="text-[11px] font-mono px-1.5 py-0.5 rounded"
                            style={{
                              backgroundColor: 'var(--bg-elevated)',
                              color: 'var(--text-secondary)',
                            }}
                          >
                            {m.specs.format}
                            {m.specs.quantization ? ` · ${m.specs.quantization}` : ''}
                          </span>
                        </div>
                        <div
                          className="text-xs flex items-center gap-2 flex-wrap"
                          style={{ color: 'var(--text-secondary)' }}
                        >
                          <span>{m.sourceLabel}</span>
                          <span>•</span>
                          <span className="font-mono">{formatBytes(m.totalBytes)}</span>
                          <span>•</span>
                          <span>{m.entries.length} file{m.entries.length === 1 ? '' : 's'}</span>
                          {m.specs.architecture && (
                            <>
                              <span>•</span>
                              <span>{m.specs.architecture}</span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => onInspectModel(m)}
                          title="Inspect archive files & binary header"
                          className="p-2 rounded-lg border transition-opacity hover:opacity-80"
                          style={{
                            backgroundColor: 'var(--bg-main)',
                            borderColor: 'var(--border-subtle)',
                            color: 'var(--text-secondary)',
                          }}
                        >
                          <Info className="w-4 h-4" />
                        </button>

                        {isActive ? (
                          <button
                            type="button"
                            onClick={onUnloadActiveModel}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium"
                            style={{
                              backgroundColor: 'var(--bg-main)',
                              borderColor: 'var(--border-strong)',
                            }}
                          >
                            <PowerOff className="w-3.5 h-3.5" />
                            <span>Unload</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => onActivateStoredModel(m.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium"
                            style={{
                              backgroundColor: 'var(--accent)',
                              color: 'var(--accent-text)',
                            }}
                          >
                            <Play className="w-3.5 h-3.5" />
                            <span>Load</span>
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => onDeleteModel(m.id)}
                          title="Remove from library"
                          className="p-2 rounded-lg border transition-opacity hover:opacity-80 text-red-400"
                          style={{
                            backgroundColor: 'var(--bg-main)',
                            borderColor: 'var(--border-subtle)',
                          }}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Recommended Android Models Guide */}
          <div
            className="rounded-xl border p-3.5 text-xs space-y-1.5"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-subtle)',
              color: 'var(--text-secondary)',
            }}
          >
            <div className="font-semibold" style={{ color: 'var(--text-primary)' }}>
              Recommended Quantized Models for Android Phones
            </div>
            <p className="leading-relaxed">
              • <strong>4 GB – 6 GB RAM phones:</strong>{' '}
              <code className="font-mono">SmolLM2-360M-Instruct-Q8_0.gguf</code> (~380 MB) or{' '}
              <code className="font-mono">Qwen2.5-0.5B-Instruct-Q4_K_M.gguf</code> (~400 MB)
              <br />• <strong>8 GB+ RAM phones:</strong>{' '}
              <code className="font-mono">Llama-3.2-1B-Instruct-Q4_K_M.gguf</code> (~800 MB),{' '}
              <code className="font-mono">Qwen3-1.7B-Q4_K_M.gguf</code> (~1.1 GB), or ONNX{' '}
              <code className="font-mono">.zip</code> model archives.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
