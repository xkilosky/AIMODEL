import React, { useCallback, useEffect, useState } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { CheckCircle2, Download, Loader2, RefreshCw, Shield, X } from 'lucide-react';
import {
  getNativeUpdateDownloadStatus,
  installNativeUpdate,
  startNativeUpdateDownload,
  type NativeUpdateDownloadStatus,
} from '../services/nativeDevice';

const UPDATE_METADATA_URL =
  'https://github.com/xkilosky/AIMODEL/releases/download/v1.0.0-apk/linor-update.json';
const OFFICIAL_APK_URL =
  'https://github.com/xkilosky/AIMODEL/releases/download/v1.0.0-apk/Linor-Android.apk';

interface UpdateMetadata {
  versionCode: number;
  versionName: string;
  apkUrl: string;
  releaseNotes?: string;
}

const EMPTY_STATUS: NativeUpdateDownloadStatus = { state: 'none' };

export const AppUpdateNotice: React.FC = () => {
  const [update, setUpdate] = useState<UpdateMetadata | null>(null);
  const [download, setDownload] = useState<NativeUpdateDownloadStatus>(EMPTY_STATUS);
  const [message, setMessage] = useState('');
  const [installing, setInstalling] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const checkForUpdate = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) return;
    try {
      const [appInfo, response] = await Promise.all([
        CapacitorApp.getInfo(),
        fetch(UPDATE_METADATA_URL, { cache: 'no-store' }),
      ]);
      if (!response.ok) return;
      const candidate = (await response.json()) as Partial<UpdateMetadata>;
      const installedBuild = Number.parseInt(appInfo.build || '0', 10) || 0;
      const availableBuild = Number(candidate.versionCode);
      if (
        !Number.isSafeInteger(availableBuild) ||
        availableBuild <= installedBuild ||
        typeof candidate.versionName !== 'string' ||
        candidate.apkUrl !== OFFICIAL_APK_URL
      ) {
        return;
      }

      const nextUpdate: UpdateMetadata = {
        versionCode: availableBuild,
        versionName: candidate.versionName,
        apkUrl: OFFICIAL_APK_URL,
        releaseNotes: typeof candidate.releaseNotes === 'string' ? candidate.releaseNotes : undefined,
      };
      setUpdate(nextUpdate);
      setDismissed(false);
      setMessage('');

      let currentStatus = await getNativeUpdateDownloadStatus();
      if (currentStatus.state === 'none' || currentStatus.state === 'failed') {
        currentStatus = await startNativeUpdateDownload(nextUpdate.apkUrl, nextUpdate.versionCode);
      }
      setDownload(currentStatus);
    } catch {
      // Update checks are best-effort and must not interrupt offline chat/model use.
    }
  }, []);

  const refreshDownloadStatus = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) return;
    try {
      const status = await getNativeUpdateDownloadStatus();
      setDownload(status);
      if (status.state === 'failed' && status.error) setMessage(status.error);
    } catch {
      // Keep the last known progress visible if Android temporarily cannot query the download.
    }
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    void checkForUpdate();
    const statusTimer = window.setInterval(() => void refreshDownloadStatus(), 2500);
    const checkTimer = window.setInterval(() => void checkForUpdate(), 6 * 60 * 60 * 1000);
    let listener: { remove: () => Promise<void> } | undefined;
    let cancelled = false;
    CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) {
        void checkForUpdate();
        void refreshDownloadStatus();
      }
    }).then((handle) => {
      if (cancelled) void handle.remove();
      else listener = handle;
    }).catch(() => {});
    return () => {
      cancelled = true;
      window.clearInterval(statusTimer);
      window.clearInterval(checkTimer);
      void listener?.remove();
    };
  }, [checkForUpdate, refreshDownloadStatus]);

  const handleRetryDownload = async () => {
    if (!update) return;
    setMessage('');
    try {
      setDownload(await startNativeUpdateDownload(update.apkUrl, update.versionCode));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not start the update download.');
    }
  };

  const handleInstall = async () => {
    setInstalling(true);
    setMessage('');
    try {
      const result = await installNativeUpdate();
      if (!result.permissionGranted) {
        setMessage('Allow Linor to install unknown apps in Android Settings, return here, then tap Install again.');
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not open the Android installer.');
    } finally {
      setInstalling(false);
    }
  };

  if (!Capacitor.isNativePlatform() || !update || dismissed) return null;

  const progress = Math.max(0, Math.min(100, download.progress ?? 0));
  const isWaiting = download.state === 'queued';
  const isDownloading = download.state === 'downloading';
  const isDownloaded = download.state === 'downloaded';
  const isFailed = download.state === 'failed';

  return (
    <section
      role="status"
      aria-live="polite"
      className="fixed bottom-4 left-3 right-3 z-[70] mx-auto max-w-lg rounded-2xl border p-4 shadow-2xl"
      style={{ backgroundColor: 'var(--bg-main)', borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}>
          {isDownloaded ? <CheckCircle2 className="h-5 w-5" /> : isDownloading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold">Linor update · {update.versionName}</h2>
              <p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                {isDownloaded
                  ? 'Update downloaded. Android will ask you to approve the installation.'
                  : isDownloading
                    ? `Downloading automatically over Wi-Fi… ${progress}%`
                    : isWaiting
                      ? 'Update queued; Android will download it when Wi-Fi is available.'
                      : isFailed
                        ? 'The automatic download did not finish. Retry when you have a stable connection.'
                        : 'Preparing the update download over Wi-Fi.'}
              </p>
            </div>
            <button type="button" onClick={() => setDismissed(true)} aria-label="Dismiss update notice" className="rounded-lg p-1.5" style={{ color: 'var(--text-muted)' }}>
              <X className="h-4 w-4" />
            </button>
          </div>
          {isDownloading && (
            <div className="mt-3 h-1.5 overflow-hidden rounded-full" style={{ backgroundColor: 'var(--border-subtle)' }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, backgroundColor: 'var(--accent)' }} />
            </div>
          )}
          {update.releaseNotes && <p className="mt-2 line-clamp-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>{update.releaseNotes}</p>}
          {message && <p className="mt-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300">{message}</p>}
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
              <Shield className="h-3 w-3" /> Wi-Fi download · Android approval required
            </span>
            {isDownloaded ? (
              <button type="button" onClick={() => void handleInstall()} disabled={installing} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold disabled:opacity-60" style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-text)' }}>
                {installing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                Install update
              </button>
            ) : isFailed ? (
              <button type="button" onClick={() => void handleRetryDownload()} className="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold" style={{ borderColor: 'var(--border-strong)' }}>
                <RefreshCw className="h-3.5 w-3.5" /> Retry
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
};
