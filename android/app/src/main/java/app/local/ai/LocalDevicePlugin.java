package app.local.ai;

import android.app.Activity;
import android.app.ActivityManager;
import android.app.DownloadManager;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.StatFs;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.content.pm.PackageManager;
import android.util.Base64;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
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
    private static final String UPDATE_APK_URL = "https://github.com/xkilosky/AIMODEL/releases/download/v1.0.0-apk/Linor-Android.apk";
    private static final String UPDATE_PREFS = "linor_update";

    @PluginMethod
    public void startUpdateDownload(PluginCall call) {
        String url = call.getString("url", "");
        String versionCode = call.getString("versionCode", "");
        if (!UPDATE_APK_URL.equals(url)) {
            call.reject("Update URL is not the official Linor APK release.");
            return;
        }
        if (versionCode == null || !versionCode.matches("[0-9]{1,12}")) {
            call.reject("A valid Linor update version is required.");
            return;
        }

        DownloadManager manager = (DownloadManager) getContext().getSystemService(Activity.DOWNLOAD_SERVICE);
        if (manager == null) {
            call.reject("Android download service is unavailable.");
            return;
        }

        SharedPreferences preferences = getContext().getSharedPreferences(UPDATE_PREFS, Activity.MODE_PRIVATE);
        long previousId = preferences.getLong("download_id", -1L);
        if (previousId >= 0) {
            String previousVersion = preferences.getString("version_code", "");
            JSObject previous = queryUpdateDownload(manager, previousId,
                preferences.getString("file_name", ""), previousVersion);
            String previousState = previous.optString("state", "");
            if (versionCode.equals(previousVersion)
                    && ("queued".equals(previousState) || "downloading".equals(previousState)
                    || "downloaded".equals(previousState))) {
                call.resolve(previous);
                return;
            }
            manager.remove(previousId);
        }

        String fileName = "Linor-update-" + versionCode + ".apk";
        try {
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setTitle("Linor update");
            request.setDescription("Downloading Linor update " + versionCode + " over Wi-Fi");
            request.setMimeType("application/vnd.android.package-archive");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setAllowedOverMetered(false);
            request.setAllowedOverRoaming(false);
            request.setDestinationInExternalFilesDir(getContext(), Environment.DIRECTORY_DOWNLOADS, fileName);
            long id = manager.enqueue(request);
            preferences.edit().putLong("download_id", id).putString("file_name", fileName)
                .putString("version_code", versionCode).apply();
            call.resolve(queryUpdateDownload(manager, id, fileName, versionCode));
        } catch (Exception e) {
            call.reject("Could not start the update download: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void getUpdateDownloadStatus(PluginCall call) {
        SharedPreferences preferences = getContext().getSharedPreferences(UPDATE_PREFS, Activity.MODE_PRIVATE);
        long id = preferences.getLong("download_id", -1L);
        if (id < 0) {
            JSObject result = new JSObject();
            result.put("state", "none");
            call.resolve(result);
            return;
        }
        DownloadManager manager = (DownloadManager) getContext().getSystemService(Activity.DOWNLOAD_SERVICE);
        if (manager == null) {
            call.reject("Android download service is unavailable.");
            return;
        }
        call.resolve(queryUpdateDownload(manager, id, preferences.getString("file_name", ""),
            preferences.getString("version_code", "")));
    }

    @PluginMethod
    public void installDownloadedUpdate(PluginCall call) {
        SharedPreferences preferences = getContext().getSharedPreferences(UPDATE_PREFS, Activity.MODE_PRIVATE);
        String fileName = preferences.getString("file_name", "");
        long id = preferences.getLong("download_id", -1L);
        if (id < 0 || fileName.isEmpty()) {
            call.reject("There is no downloaded Linor update to install.");
            return;
        }
        DownloadManager manager = (DownloadManager) getContext().getSystemService(Activity.DOWNLOAD_SERVICE);
        JSObject status = manager == null ? null : queryUpdateDownload(manager, id, fileName,
            preferences.getString("version_code", ""));
        if (status == null || !"downloaded".equals(status.optString("state", ""))) {
            call.reject("The Linor update has not finished downloading yet.");
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !getContext().getPackageManager().canRequestPackageInstalls()) {
            JSObject result = new JSObject();
            result.put("permissionGranted", false);
            try {
                Intent settingsIntent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:" + getContext().getPackageName()));
                settingsIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(settingsIntent);
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Android could not open the install-permission settings: " + e.getMessage(), e);
            }
            return;
        }

        File downloadDirectory = getContext().getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        File apk = downloadDirectory == null ? null : new File(downloadDirectory, fileName);
        if (apk == null || !apk.isFile() || apk.length() < 1024 * 1024) {
            call.reject("The downloaded update file is missing or incomplete. Download it again.");
            return;
        }
        try {
            Uri apkUri = FileProvider.getUriForFile(getContext(),
                getContext().getPackageName() + ".fileprovider", apk);
            Intent installIntent = new Intent(Intent.ACTION_INSTALL_PACKAGE);
            installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(installIntent);
            JSObject result = new JSObject();
            result.put("permissionGranted", true);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Android could not open the installer: " + e.getMessage(), e);
        }
    }

    private JSObject queryUpdateDownload(DownloadManager manager, long id, String fileName, String versionCode) {
        JSObject result = new JSObject();
        result.put("downloadId", id);
        result.put("fileName", fileName == null ? "" : fileName);
        result.put("versionCode", versionCode == null ? "" : versionCode);
        DownloadManager.Query query = new DownloadManager.Query().setFilterById(id);
        try (Cursor cursor = manager.query(query)) {
            if (cursor == null || !cursor.moveToFirst()) {
                result.put("state", "failed");
                result.put("error", "Android no longer has this download.");
                return result;
            }
            int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            long downloaded = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR));
            long total = cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES));
            result.put("downloadedBytes", Math.max(0, downloaded));
            result.put("totalBytes", Math.max(0, total));
            if (total > 0) result.put("progress", Math.min(100, (int) (downloaded * 100L / total)));
            if (status == DownloadManager.STATUS_SUCCESSFUL) {
                result.put("state", "downloaded");
            } else if (status == DownloadManager.STATUS_RUNNING) {
                result.put("state", "downloading");
            } else if (status == DownloadManager.STATUS_PENDING || status == DownloadManager.STATUS_PAUSED) {
                result.put("state", "queued");
            } else {
                result.put("state", "failed");
                int reason = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
                result.put("error", "Android download failed (" + reason + "). Try again on Wi-Fi.");
            }
        } catch (Exception e) {
            result.put("state", "failed");
            result.put("error", "Could not read download status: " + e.getMessage());
        }
        return result;
    }

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
        result.put("hardwareConcurrency", Runtime.getRuntime().availableProcessors());
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
            call.reject("This model exceeds Linor's 8 GB on-device model-library limit.");
            return;
        }

        File modelDir = getModelsDirectory();
        long currentlyStored = getStoredModelsBytes(modelDir);
        if (currentlyStored + sourceBytes > MAX_MODEL_LIBRARY_BYTES) {
            call.reject("The 8 GB Linor model-library limit would be exceeded. Delete an unused model first.");
            return;
        }
        StatFs stat = new StatFs(modelDir.getAbsolutePath());
        if (sourceBytes + MIN_FREE_SPACE_RESERVE > stat.getAvailableBytes()) {
            call.reject("Not enough free phone storage. Linor keeps 256 MB free for Android and model setup.");
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
            String message = "Could not copy model into Linor storage: " + e.getMessage();
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
                call.reject("Refusing to delete a file outside Linor model storage.");
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
