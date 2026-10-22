import React from 'react';
import { RotateCcw, SlidersHorizontal, X } from 'lucide-react';
import type { InferenceSettings } from '../types/local';
import { DEFAULT_INFERENCE_SETTINGS } from '../services/modelStorage';

interface InferenceControlsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  settings: InferenceSettings;
  onChange: (next: InferenceSettings) => void;
}

const SYSTEM_PRESETS: Array<{ label: string; prompt: string }> = [
  {
    label: 'Balanced (Claude/ChatGPT)',
    prompt: DEFAULT_INFERENCE_SETTINGS.systemPrompt,
  },
  {
    label: 'Senior Engineer',
    prompt:
      'You are an expert mobile & full-stack software engineer running locally on-device. Provide concise, production-ready code with clear architectural explanations.',
  },
  {
    label: 'Document Analyst',
    prompt:
      'You analyze user-attached files, notes, and data strictly based on provided text. Cite key lines, summarize clearly, and highlight actionable insights.',
  },
  {
    label: 'Español / Bilingual',
    prompt:
      'Eres Local, un asistente de IA privado que funciona 100% sin conexión en el dispositivo Android del usuario. Responde en el mismo idioma del usuario con claridad y precisión.',
  },
];

export const InferenceControlsSheet: React.FC<InferenceControlsSheetProps> = ({
  isOpen,
  onClose,
  settings,
  onChange,
}) => {
  if (!isOpen) return null;

  const update = <K extends keyof InferenceSettings>(key: K, value: InferenceSettings[K]) => {
    onChange({ ...settings, [key]: value });
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4">
      <div
        className="w-full sm:max-w-lg max-h-[90vh] flex flex-col rounded-t-3xl sm:rounded-2xl border shadow-2xl overflow-hidden"
        style={{
          backgroundColor: 'var(--bg-main)',
          borderColor: 'var(--border-strong)',
        }}
      >
        <div
          className="flex items-center justify-between px-5 py-4 border-b shrink-0"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            <h2 className="text-base font-semibold">Model & Sampling Controls</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...settings,
                  maxTokens: 256,
                  contextSize: 2048,
                  threads: Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 4) - 2)),
                  gpuLayers: 0,
                })
              }
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs border hover:opacity-85"
              style={{
                backgroundColor: 'var(--accent-soft)',
                borderColor: 'var(--accent)',
                color: 'var(--text-primary)',
              }}
              title="Use fewer phone resources. Unload and reload the model to apply."
            >
              <span>Phone-safe</span>
            </button>
            <button
              type="button"
              onClick={() => onChange(DEFAULT_INFERENCE_SETTINGS)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs border hover:opacity-85"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-subtle)',
                color: 'var(--text-secondary)',
              }}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-full"
              style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-secondary)' }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-5 overflow-y-auto space-y-5 text-xs">
          {/* System Instructions */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="font-semibold text-sm">System Instructions</label>
              <span style={{ color: 'var(--text-muted)' }}>Injected at conversation start</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SYSTEM_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => update('systemPrompt', preset.prompt)}
                  className="px-2.5 py-1 rounded-full border text-[11px] transition-colors"
                  style={{
                    backgroundColor:
                      settings.systemPrompt === preset.prompt
                        ? 'var(--accent-soft)'
                        : 'var(--bg-surface)',
                    borderColor:
                      settings.systemPrompt === preset.prompt
                        ? 'var(--accent)'
                        : 'var(--border-subtle)',
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <textarea
              rows={3}
              value={settings.systemPrompt}
              onChange={(e) => update('systemPrompt', e.target.value)}
              placeholder="Enter custom system instructions..."
              className="w-full rounded-xl border p-3 text-xs leading-relaxed focus:outline-none"
              style={{
                backgroundColor: 'var(--bg-surface)',
                borderColor: 'var(--border-strong)',
                color: 'var(--text-primary)',
              }}
            />
          </div>

          {/* Sliders */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <SliderField
              label="Temperature"
              value={settings.temperature}
              min={0}
              max={1.5}
              step={0.05}
              display={settings.temperature.toFixed(2)}
              hint="0 = deterministic, 0.8+ = creative"
              onChange={(v) => update('temperature', v)}
            />
            <SliderField
              label="Top-P (Nucleus)"
              value={settings.topP}
              min={0.1}
              max={1.0}
              step={0.02}
              display={settings.topP.toFixed(2)}
              hint="Cumulative probability cutoff"
              onChange={(v) => update('topP', v)}
            />
            <SliderField
              label="Top-K"
              value={settings.topK}
              min={1}
              max={100}
              step={1}
              display={String(settings.topK)}
              hint="Candidate token pool size"
              onChange={(v) => update('topK', v)}
            />
            <SliderField
              label="Repeat Penalty"
              value={settings.repeatPenalty}
              min={1.0}
              max={1.4}
              step={0.02}
              display={settings.repeatPenalty.toFixed(2)}
              hint="Discourages repetitive loops"
              onChange={(v) => update('repeatPenalty', v)}
            />
            <SliderField
              label="Max Output Tokens"
              value={settings.maxTokens}
              min={128}
              max={4096}
              step={128}
              display={String(settings.maxTokens)}
              hint="Maximum reply length"
              onChange={(v) => update('maxTokens', v)}
            />
            <SliderField
              label="Context Window (n_ctx)"
              value={settings.contextSize}
              min={1024}
              max={16384}
              step={1024}
              display={`${settings.contextSize}`}
              hint="Applies on next model load"
              onChange={(v) => update('contextSize', v)}
            />
            <SliderField
              label="CPU Threads"
              value={settings.threads}
              min={1}
              max={8}
              step={1}
              display={String(settings.threads)}
              hint="Android big.LITTLE worker threads"
              onChange={(v) => update('threads', v)}
            />
            <SliderField
              label="GPU Offload Layers"
              value={settings.gpuLayers}
              min={0}
              max={99}
              step={1}
              display={settings.gpuLayers >= 99 ? 'Auto (All)' : String(settings.gpuLayers)}
              hint="WebGPU / Vulkan layer offload"
              onChange={(v) => update('gpuLayers', v)}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

interface SliderFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  hint: string;
  onChange: (val: number) => void;
}

const SliderField: React.FC<SliderFieldProps> = ({
  label,
  value,
  min,
  max,
  step,
  display,
  hint,
  onChange,
}) => (
  <div
    className="p-3 rounded-xl border space-y-2"
    style={{
      backgroundColor: 'var(--bg-surface)',
      borderColor: 'var(--border-subtle)',
    }}
  >
    <div className="flex items-center justify-between">
      <span className="font-medium">{label}</span>
      <span className="font-mono font-semibold" style={{ color: 'var(--accent)' }}>
        {display}
      </span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full accent-amber-600 cursor-pointer"
    />
    <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
      {hint}
    </div>
  </div>
);
