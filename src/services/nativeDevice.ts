import { registerPlugin, Capacitor, type PluginListenerHandle } from '@capacitor/core';

export const MAX_LOCAL_MODEL_BYTES = 8 * 1024 * 1024 * 1024;

export interface DeviceProfile {
  manufacturer?: string;
  model?: string;
  androidVersion?: string;
  apiLevel?: number;
  totalRamBytes?: number;
  availableRamBytes?: number;
  lowMemory?: boolean;
  storageFreeBytes?: number;
  storageTotalBytes?: number;
  modelStorageUsedBytes?: number;
  modelStorageLimitBytes?: number;
  deviceMemoryGb?: number;
  hardwareConcurrency?: number;
  isNative: boolean;
}

export interface NativePickedModel {
  name: string;
  path: string;
  sizeBytes: number;
  headerBase64: string;
  modelStorageUsedBytes: number;
  modelStorageLimitBytes: number;
}

interface NativeDeviceBridge {
  getDeviceProfile(): Promise<Omit<DeviceProfile, 'isNative'>>;
  pickAndStoreGguf(): Promise<NativePickedModel>;
  deleteStoredModel(options: { path: string }): Promise<void>;
  addListener(
    eventName: 'modelCopyProgress',
    listener: (event: { bytesCopied: number; totalBytes: number }) => void
  ): Promise<PluginListenerHandle>;
}

const NativeDevice = registerPlugin<NativeDeviceBridge>('LocalDevice');

function estimateManufacturer(userAgent: string): string | undefined {
  if (/Samsung|SM-[A-Z0-9]+/i.test(userAgent)) return 'Samsung';
  if (/Pixel|Google/i.test(userAgent)) return 'Google';
  if (/Xiaomi|Redmi|POCO/i.test(userAgent)) return 'Xiaomi';
  if (/OnePlus/i.test(userAgent)) return 'OnePlus';
  if (/Motorola|Moto/i.test(userAgent)) return 'Motorola';
  return undefined;
}

function friendlyDeviceModel(manufacturer?: string, model?: string): string | undefined {
  if (!model) return undefined;
  if (/samsung/i.test(manufacturer || '')) {
    const series = model.match(/^SM-([SAFX])/i)?.[1]?.toUpperCase();
    const family = series === 'S' ? 'Galaxy S series' : series === 'A' ? 'Galaxy A series' : series === 'F' ? 'Galaxy Z series' : series === 'X' ? 'Galaxy Tab' : 'Galaxy';
    return `${family} (${model})`;
  }
  return model;
}

export async function getDeviceProfile(): Promise<DeviceProfile> {
  const native = Capacitor.isNativePlatform();
  if (native) {
    try {
      const profile = await NativeDevice.getDeviceProfile();
      return {
        ...profile,
        model: friendlyDeviceModel(profile.manufacturer, profile.model),
        isNative: true,
      };
    } catch {
      // Use browser estimates if the native plugin isn't present in an older installed APK.
    }
  }

  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  const deviceMemoryGb =
    typeof navigator !== 'undefined' && 'deviceMemory' in navigator
      ? Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory) || undefined
      : undefined;
  const userAgentData = (
    typeof navigator !== 'undefined'
      ? (navigator as Navigator & {
          userAgentData?: { getHighEntropyValues?: (keys: string[]) => Promise<{ model?: string }> };
        }).userAgentData
      : undefined
  );
  let model: string | undefined;
  try {
    model = (await userAgentData?.getHighEntropyValues?.(['model']))?.model || undefined;
  } catch {
    // Chromium may withhold the exact model for privacy.
  }

  const manufacturer = estimateManufacturer(ua);
  return {
    manufacturer,
    model: friendlyDeviceModel(manufacturer, model),
    deviceMemoryGb,
    hardwareConcurrency: typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined,
    isNative: false,
  };
}

export async function addNativeModelCopyProgressListener(
  listener: (event: { bytesCopied: number; totalBytes: number }) => void
): Promise<PluginListenerHandle | null> {
  if (!Capacitor.isNativePlatform()) return null;
  return NativeDevice.addListener('modelCopyProgress', listener);
}

export async function pickAndStoreNativeGguf(): Promise<NativePickedModel> {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Native Android model-file storage is only available in the Local APK.');
  }
  return NativeDevice.pickAndStoreGguf();
}

export async function deleteNativeStoredModel(path: string): Promise<void> {
  if (!path || !Capacitor.isNativePlatform()) return;
  await NativeDevice.deleteStoredModel({ path });
}

export function getModelFitAssessment(
  modelBytes: number,
  profile: DeviceProfile | null,
  contextSize: number
): { level: 'ok' | 'caution' | 'high'; message: string; estimatedPeakBytes?: number } {
  const totalRam = profile?.totalRamBytes ?? (profile?.deviceMemoryGb ? profile.deviceMemoryGb * 1024 ** 3 : 0);
  const availableRam = profile?.availableRamBytes ?? (totalRam ? totalRam * 0.45 : 0);
  if (!totalRam || !modelBytes) {
    return {
      level: modelBytes >= 2 * 1024 ** 3 ? 'high' : modelBytes >= 1024 ** 3 ? 'caution' : 'ok',
      message:
        modelBytes >= 2 * 1024 ** 3
          ? 'This is a very large model. Your browser does not expose enough RAM information to confirm it will run smoothly.'
          : 'Phone memory information is limited in the browser; performance depends on available RAM.',
    };
  }

  // Model weights plus KV cache, runtime buffers and backend allocations. This is an estimate,
  // not a guarantee; quantization and context length significantly affect peak memory use.
  const estimatedPeakBytes = Math.ceil(modelBytes * 1.35 + (contextSize / 1024) * 96 * 1024 ** 2);
  const safeBudget = availableRam * 0.72;
  if (estimatedPeakBytes > safeBudget || profile?.lowMemory) {
    return {
      level: 'high',
      estimatedPeakBytes,
      message: `High lag or out-of-memory risk: estimated model working memory is about ${formatGb(estimatedPeakBytes)} while Android reports only about ${formatGb(availableRam)} RAM available right now.`,
    };
  }
  if (estimatedPeakBytes > safeBudget * 0.65) {
    return {
      level: 'caution',
      estimatedPeakBytes,
      message: `This model may make your phone warm or slow. Estimated working memory is about ${formatGb(estimatedPeakBytes)}; close other apps before loading.`,
    };
  }
  return {
    level: 'ok',
    estimatedPeakBytes,
    message: `Estimated model working memory: about ${formatGb(estimatedPeakBytes)}. This is an estimate, not a guarantee.`,
  };
}

function formatGb(bytes: number): string {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}
