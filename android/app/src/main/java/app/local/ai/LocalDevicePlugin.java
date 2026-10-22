package app.local.ai;

import android.app.Activity;
import android.app.ActivityManager;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.StatFs;
import android.provider.OpenableColumns;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.ActivityCallback;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.RandomAccessFile;
import java.util.UUID;

@CapacitorPlugin(name = "LocalDevice")
public class LocalDevicePlugin extends Plugin {
    private static final long MAX_MODEL_LIBRARY_BYTES = 8L * 1024L * 1024L * 1024L;
    private static final long MIN_FREE_SPACE_RESERVE = 256L * 1024L * 1024L;
    private static final int HEADER_PREVIEW_BYTES = 512 * 1024;

    @PluginMethod
    public void getDeviceProfile(PluginCall call) {
        ActivityManager manager = (ActivityManager) getContext().getSystemService(Activity.ACTIVITY_SERVICE);
        ActivityManager.MemoryInfo memory = new ActivityManager.MemoryInfo();
        if (manager != null) manager.getMemoryInfo(memory);

        File modelDir = getModelsDirectory();
        StatFs stat = new StatFs(modelDir.getAbsolutePath());
        long freeBytes = stat.getAvailableBytes();
        long totalBytes = stat.getTotalBytes();

        JSObject result = new JSObject();
        result.put("manufacturer", Build.MANUFACTURER == null ? "Android" : Build.MANUFACTURER);
        result.put("model", Build.MODEL == null ? "Android device" : Build.MODEL);
        result.put("androidVersion", Build.VERSION.RELEASE == null ? "Unknown" : Build.VERSION.RELEASE);
        result.put("apiLevel", Build.VERSION.SDK_INT);
        result.put("totalRamBytes", memory.totalMem);
        result.put("availableRamBytes", memory.availMem);
        result.put("lowMemory", memory.lowMemory);
        result.put("storageFreeBytes", freeBytes);
        result.put("storageTotalBytes", totalBytes);
        result.put("modelStorageUsedBytes", getStoredModelsBytes(modelDir));
        result.put("modelStorageLimitBytes", MAX_MODEL_LIBRARY_BYTES);
        call.resolve(result);
    }

    @PluginMethod
    public void pickAndStoreGguf(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] { "application/octet-stream", "application/x-gguf" });
        startActivityForResult(call, intent, "handleGgufPickerResult");
    }

    @ActivityCallback
    private void handleGgufPickerResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("No model file was selected.");
            return;
        }

        Uri uri = result.getData().getData();
        String displayName = queryDisplayName(uri);
        if (displayName == null || !displayName.toLowerCase().endsWith(".gguf")) {
            call.reject("Choose a single .gguf model file for native Android loading.");
            return;
        }

        long sourceBytes = querySize(uri);
        if (sourceBytes <= 0) {
            call.reject("Android could not read the model file size. Check that the file is available locally.");
            return;
        }
        if (sourceBytes > MAX_MODEL_LIBRARY_BYTES) {
            call.reject("This model exceeds Local's 8 GB on-device model-library limit.");
            return;
        }

        File modelDir = getModelsDirectory();
        long currentlyStored = getStoredModelsBytes(modelDir);
        if (currentlyStored + sourceBytes > MAX_MODEL_LIBRARY_BYTES) {
            call.reject("The 8 GB Local model-library limit would be exceeded. Delete an unused model first.");
            return;
        }
        StatFs stat = new StatFs(modelDir.getAbsolutePath());
        if (sourceBytes + MIN_FREE_SPACE_RESERVE > stat.getAvailableBytes()) {
            call.reject("Not enough free phone storage. Local keeps 256 MB free for Android and model setup.");
            return;
        }

        String safeName = displayName.replaceAll("[^A-Za-z0-9._() -]", "_");
        File destination = new File(modelDir, UUID.randomUUID().toString() + "-" + safeName);
        try {
            getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (Exception ignored) {
            // Some providers don't grant persistable access. The app-private copy below is self-contained.
        }

        new Thread(() -> copyAndResolve(call, uri, destination, displayName, sourceBytes), "LocalModelCopy").start();
    }

    private void copyAndResolve(PluginCall call, Uri uri, File destination, String displayName, long expectedBytes) {
        try (InputStream input = getContext().getContentResolver().openInputStream(uri);
             FileOutputStream output = new FileOutputStream(destination)) {
            if (input == null) throw new IllegalStateException("Android could not open the selected model.");
            byte[] buffer = new byte[1024 * 1024];
            long copied = 0;
            long lastReported = 0;
            int count;
            while ((count = input.read(buffer)) != -1) {
                copied += count;
                if (copied > MAX_MODEL_LIBRARY_BYTES) throw new IllegalStateException("Model exceeds the 8 GB limit.");
                output.write(buffer, 0, count);
                if (copied - lastReported >= 16L * 1024L * 1024L || copied == expectedBytes) {
                    JSObject progress = new JSObject();
                    progress.put("bytesCopied", copied);
                    progress.put("totalBytes", expectedBytes);
                    notifyListeners("modelCopyProgress", progress);
                    lastReported = copied;
                }
            }
            output.flush();
            if (copied == 0 || (expectedBytes > 0 && copied != expectedBytes)) {
                throw new IllegalStateException("The model copy was incomplete. Check phone free storage and try again.");
            }

            int headerLength = (int) Math.min(destination.length(), HEADER_PREVIEW_BYTES);
            byte[] header = new byte[headerLength];
            try (RandomAccessFile file = new RandomAccessFile(destination, "r")) {
                file.readFully(header);
            }

            JSObject response = new JSObject();
            response.put("name", displayName);
            response.put("path", destination.getAbsolutePath());
            response.put("sizeBytes", destination.length());
            response.put("headerBase64", Base64.encodeToString(header, Base64.NO_WRAP));
            response.put("modelStorageUsedBytes", getStoredModelsBytes(getModelsDirectory()));
            response.put("modelStorageLimitBytes", MAX_MODEL_LIBRARY_BYTES);
            getBridge().executeOnMainThread(() -> call.resolve(response));
        } catch (Exception e) {
            if (destination.exists()) destination.delete();
            String message = "Could not copy model into Local storage: " + e.getMessage();
            getBridge().executeOnMainThread(() -> call.reject(message, e));
        }
    }

    @PluginMethod
    public void deleteStoredModel(PluginCall call) {
        String path = call.getString("path", "");
        if (path == null || path.isEmpty()) {
            call.reject("Model path is required.");
            return;
        }
        try {
            File modelDir = getModelsDirectory().getCanonicalFile();
            File target = new File(path).getCanonicalFile();
            if (!target.getPath().startsWith(modelDir.getPath() + File.separator)) {
                call.reject("Refusing to delete a file outside Local model storage.");
                return;
            }
            if (target.exists() && !target.delete()) {
                call.reject("Could not delete the stored model file.");
                return;
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not delete model: " + e.getMessage(), e);
        }
    }

    private File getModelsDirectory() {
        File root = getContext().getExternalFilesDir("models");
        if (root == null) root = new File(getContext().getFilesDir(), "models");
        if (!root.exists()) root.mkdirs();
        return root;
    }

    private long getStoredModelsBytes(File directory) {
        long total = 0;
        File[] files = directory.listFiles();
        if (files == null) return 0;
        for (File file : files) {
            if (file.isFile()) total += file.length();
        }
        return total;
    }

    private String queryDisplayName(Uri uri) {
        try (Cursor cursor = getContext().getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int column = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (column >= 0) return cursor.getString(column);
            }
        } catch (Exception ignored) {}
        return uri.getLastPathSegment();
    }

    private long querySize(Uri uri) {
        try (Cursor cursor = getContext().getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int column = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (column >= 0 && !cursor.isNull(column)) return cursor.getLong(column);
            }
        } catch (Exception ignored) {}
        try (android.os.ParcelFileDescriptor descriptor = getContext().getContentResolver().openFileDescriptor(uri, "r")) {
            return descriptor == null ? -1 : descriptor.getStatSize();
        } catch (Exception ignored) {
            return -1;
        }
    }
}
