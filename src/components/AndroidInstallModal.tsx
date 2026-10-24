import React from 'react';
import { Capacitor } from '@capacitor/core';
import {
  CheckCircle2,
  Cpu,
  Download,
  ExternalLink,
  Package,
  Shield,
  Smartphone,
  Sparkles,
  X,
} from 'lucide-react';
import { formatBytes } from '../services/binaryInspectors';
import type { DeviceProfile } from '../services/nativeDevice';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface AndroidInstallModalProps {
  isOpen: boolean;
  onClose: () => void;
  storageInfo: { usage: number; quota: number };
  deviceProfile: DeviceProfile | null;
  installPrompt: BeforeInstallPromptEvent | null;
  onTriggerInstallPrompt: () => void;
}

const GITHUB_ACTIONS_URL = 'https://github.com/xkilosky/AIMODEL/actions';
const APK_RELEASE_URL =
  'https://github.com/xkilosky/AIMODEL/releases/download/v1.0.0-apk/Local-Android.apk';

export const AndroidInstallModal: React.FC<AndroidInstallModalProps> = ({
  isOpen,
  onClose,
  storageInfo,
  deviceProfile,
  installPrompt,
  onTriggerInstallPrompt,
}) => {
  if (!isOpen) return null;

  const isNative = Capacitor.isNativePlatform();
  const hasWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
  const cores = deviceProfile?.hardwareConcurrency || (navigator.hardwareConcurrency || 4);
  const deviceName = deviceProfile?.manufacturer && deviceProfile?.model
    ? `${deviceProfile.manufacturer} ${deviceProfile.model}`
    : deviceProfile?.model || deviceProfile?.manufacturer || 'Android phone';
  const ramLabel = deviceProfile?.totalRamBytes
    ? `${formatBytes(deviceProfile.totalRamBytes)} total · ${formatBytes(deviceProfile.availableRamBytes || 0)} free`
    : deviceProfile?.deviceMemoryGb
      ? `About ${deviceProfile.deviceMemoryGb} GB (browser estimate)`
      : 'Not exposed by browser';
  const modelStorageLabel = deviceProfile?.isNative
    ? `${formatBytes(deviceProfile.modelStorageUsedBytes || 0)} / 8 GB used`
    : storageInfo.quota > 0
      ? `${formatBytes(storageInfo.usage)} / ${formatBytes(storageInfo.quota)}`
      : 'Browser quota unavailable';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4">
      <div
        className="w-full sm:max-w-lg max-h-[92vh] flex flex-col rounded-t-3xl sm:rounded-2xl border shadow-2xl overflow-hidden"
        style={{
          backgroundColor: 'var(--bg-main)',
          borderColor: 'var(--border-strong)',
        }}
      >
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <div className="flex items-center gap-2.5">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
            >
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold">Load Local on Your Phone</h2>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Install as a Fullscreen Android App (WebAPK or Native .apk)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full"
            style={{ backgroundColor: 'var(--bg-surface)', color: 'var(--text-secondary)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4 text-xs">
          {/* Option 1: Instant 1-Tap Phone App Install */}
          <div
            className="rounded-2xl border p-4 space-y-3"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-strong)',
            }}
          >
            <div className="font-semibold text-sm flex items-center gap-1.5">
              <Sparkles className="w-4 h-4" style={{ color: 'var(--accent)' }} />
              <span>Option 1: Instant Phone Install (Fastest — 10 Seconds)</span>
            </div>

            {installPrompt ? (
              <button
                type="button"
                onClick={onTriggerInstallPrompt}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-semibold transition-opacity hover:opacity-90"
                style={{
                  backgroundColor: 'var(--accent)',
                  color: 'var(--accent-text)',
                }}
              >
                <Smartphone className="w-4 h-4" />
                <span>Install Local App Now (1-Tap)</span>
              </button>
            ) : (
              <div className="space-y-2 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                <p>
                  <strong style={{ color: 'var(--text-primary)' }}>On Android (Chrome):</strong>{' '}
                  Open this app&apos;s URL in Chrome on your phone → tap{' '}
                  <strong>Menu (⋮)</strong> in the top-right → tap{' '}
                  <strong>Install app / Add to Home screen</strong>. Android installs{' '}
                  <strong>Local</strong> into your App Drawer as a standalone fullscreen app!
                </p>
                <p>
                  <strong style={{ color: 'var(--text-primary)' }}>On iPhone (Safari):</strong>{' '}
                  Open in Safari → tap <strong>Share</strong> → tap{' '}
                  <strong>Add to Home Screen</strong>.
                </p>
              </div>
            )}
          </div>

          {/* Option 2: Native Android APK Build */}
          <div
            className="rounded-2xl border p-4 space-y-3"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-subtle)',
            }}
          >
            <div className="font-semibold text-sm flex items-center gap-1.5">
              <Package className="w-4 h-4" style={{ color: 'var(--accent)' }} />
              <span>Option 2: Native Android APK (.apk File)</span>
            </div>
            <p className="leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Install the native Android app for direct file-backed GGUF loading, native llama.cpp,
              and device RAM/storage detection. Download the APK, open it from Downloads, and approve
              Android&apos;s one-time &ldquo;Install unknown apps&rdquo; prompt if shown.
            </p>
            <a
              href={APK_RELEASE_URL}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-3.5 rounded-xl text-xs font-semibold transition-opacity hover:opacity-90"
              style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-text)' }}
            >
              <Download className="w-4 h-4" />
              <span>Download Local Android APK</span>
            </a>
            <a
              href={GITHUB_ACTIONS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center justify-center gap-2 py-2 px-3.5 rounded-xl border text-xs font-medium transition-opacity hover:opacity-85"
              style={{
                backgroundColor: 'var(--bg-main)',
                borderColor: 'var(--border-strong)',
              }}
            >
              <span>View latest APK builds</span>
              <ExternalLink className="w-3.5 h-3.5 opacity-75" />
            </a>
          </div>

          {/* Hardware Capabilities */}
          <div
            className="rounded-xl border p-3.5 space-y-2.5"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-subtle)',
            }}
          >
            <div className="font-semibold flex items-center gap-1.5 text-sm">
              <Cpu className="w-4 h-4" style={{ color: 'var(--accent)' }} />
              <span>Detected Device Runtime</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <StatusBadge label="Phone" value={deviceName} />
              <StatusBadge label="RAM (estimated)" value={ramLabel} />
              <StatusBadge
                label="Runtime"
                value={isNative ? 'Native Android / llama.cpp' : 'Mobile Web / WASM'}
              />
              <StatusBadge label="CPU Cores" value={`${cores} logical cores`} />
              <StatusBadge
                label="GPU"
                value={hasWebGpu ? 'WebGPU available' : 'CPU fallback'}
              />
              <StatusBadge label="Model library" value={modelStorageLabel} />
            </div>
            <p className="text-[10px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              RAM figures from the native APK are system-reported. Browser RAM figures are approximate or hidden; model-fit warnings are estimates, not guarantees.
            </p>
          </div>

          <div
            className="rounded-xl p-3 flex items-center gap-2.5"
            style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--text-primary)' }}
          >
            <Shield className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} />
            <span>
              Zero telemetry, zero API keys, zero cloud servers. Picked model archives run strictly
              inside your phone.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

const StatusBadge: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div
    className="p-2.5 rounded-lg border"
    style={{
      backgroundColor: 'var(--bg-main)',
      borderColor: 'var(--border-subtle)',
    }}
  >
    <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
      {label}
    </div>
    <div className="font-medium mt-0.5 flex items-center gap-1">
      <CheckCircle2 className="w-3 h-3 shrink-0" style={{ color: 'var(--accent)' }} />
      <span className="truncate">{value}</span>
    </div>
  </div>
);
