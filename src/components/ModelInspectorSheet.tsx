import React from 'react';
import { Cpu, FileArchive, FileCode2, Layers, ShieldCheck, X } from 'lucide-react';
import type { StoredModelRecord } from '../types/local';
import { formatBytes } from '../services/binaryInspectors';

interface ModelInspectorSheetProps {
  model: StoredModelRecord | null;
  onClose: () => void;
}

export const ModelInspectorSheet: React.FC<ModelInspectorSheetProps> = ({ model, onClose }) => {
  if (!model) return null;

  const { specs, entries } = model;

  const specRows: Array<{ label: string; value: string }> = [
    { label: 'Format', value: specs.format },
    { label: 'Source Type', value: model.sourceLabel },
    { label: 'Total Archive Size', value: formatBytes(model.totalBytes) },
    ...(specs.architecture ? [{ label: 'Architecture', value: specs.architecture }] : []),
    ...(specs.quantization ? [{ label: 'Quantization / Dtype', value: specs.quantization }] : []),
    ...(specs.parameterCount ? [{ label: 'Parameters', value: specs.parameterCount }] : []),
    ...(specs.contextLength
      ? [{ label: 'Trained Context', value: `${specs.contextLength.toLocaleString()} tokens` }]
      : []),
    ...(specs.layers ? [{ label: 'Transformer Layers', value: String(specs.layers) }] : []),
    ...(specs.embeddingSize
      ? [{ label: 'Hidden Dimension', value: String(specs.embeddingSize) }]
      : []),
    ...(specs.vocabSize
      ? [{ label: 'Vocabulary Size', value: specs.vocabSize.toLocaleString() }]
      : []),
    ...(specs.tensorCount
      ? [{ label: 'Tensor Count', value: specs.tensorCount.toLocaleString() }]
      : []),
    ...(specs.ggufVersion ? [{ label: 'GGUF Spec', value: `v${specs.ggufVersion}` }] : []),
    {
      label: 'Chat Template',
      value: specs.hasChatTemplate ? 'Embedded Jinja / Tokenizer' : 'Standard ChatML Fallback',
    },
    {
      label: 'On-Device Cache',
      value: model.persistedInIdb ? 'Saved in IndexedDB' : 'Active Session Handle',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4">
      <div
        className="w-full sm:max-w-lg max-h-[88vh] flex flex-col rounded-t-3xl sm:rounded-2xl border shadow-2xl overflow-hidden"
        style={{
          backgroundColor: 'var(--bg-main)',
          borderColor: 'var(--border-strong)',
        }}
      >
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              <Cpu className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-base truncate">{model.name}</h3>
              <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                Binary Header & Archive Contents Inspector
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full hover:opacity-80"
            style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-secondary)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5">
          {specs.notes && (
            <div
              className="p-3.5 rounded-xl border text-xs leading-relaxed"
              style={{
                backgroundColor: 'var(--accent-soft)',
                borderColor: 'var(--accent)',
                color: 'var(--text-primary)',
              }}
            >
              {specs.notes}
            </div>
          )}

          <div>
            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider mb-2.5" style={{ color: 'var(--text-muted)' }}>
              <Layers className="w-3.5 h-3.5" />
              <span>Parsed Model Specifications</span>
            </div>
            <div
              className="rounded-xl border divide-y overflow-hidden"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-subtle)',
              }}
            >
              {specRows.map((row) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between px-3.5 py-2.5 text-xs"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <span style={{ color: 'var(--text-secondary)' }}>{row.label}</span>
                  <span className="font-mono font-medium text-right ml-3">{row.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider mb-2.5" style={{ color: 'var(--text-muted)' }}>
              <span className="flex items-center gap-1.5">
                <FileArchive className="w-3.5 h-3.5" />
                <span>Archive / Model Files ({entries.length})</span>
              </span>
              <span>{formatBytes(model.totalBytes)}</span>
            </div>
            <div
              className="rounded-xl border divide-y max-h-56 overflow-y-auto"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-subtle)',
              }}
            >
              {entries.map((entry) => (
                <div
                  key={entry.path}
                  className="flex items-center justify-between px-3.5 py-2 text-xs gap-2"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <FileCode2
                      className="w-3.5 h-3.5 shrink-0"
                      style={{ color: 'var(--accent)' }}
                    />
                    <span className="font-mono truncate">{entry.path}</span>
                  </div>
                  <span
                    className="font-mono shrink-0 text-[11px]"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {formatBytes(entry.size)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div
            className="flex items-center gap-2 text-xs px-3 py-2.5 rounded-xl"
            style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-secondary)' }}
          >
            <ShieldCheck className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} />
            <span>100% offline verification — model weights stay inside local device storage.</span>
          </div>
        </div>
      </div>
    </div>
  );
};
