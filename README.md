# Linor — On-Device AI Chat for Android

**Linor** is a private, offline-first Android mobile AI chat app inspired by the clean interfaces of **Claude** and **ChatGPT**. Users pick their own AI model files (`.gguf`, `.onnx`, `.safetensors`, `.bin`) or compressed model archives (`.zip`, `.tar.gz`, `.tgz`, `.tar`, or model folders) directly from device storage and chat 100% locally.

---

## Key Features

- **Pick Models & Compressed Archives from Device Storage**
  - **Large GGUFs on Android (`.gguf`)**: The native APK's Android Files picker copies raw GGUF weights in a streaming, 1 MB buffer into app-private phone storage, then loads the file directly with ARM64 `llama.cpp`/memory mapping. The local model-library cap is **8 GiB total per app install**; actual import is limited by available phone storage.
  - **Web/PWA GGUFs**: Runs via WebGPU/WASM SIMD and uses browser-managed storage; large browser loads are best-effort and may be session-only depending on browser quota. Use the APK's **Large GGUF (Native)** picker for multi-GB files.
  - **ONNX / Transformers Archives (`.zip`, `.tar.gz`, `.tar`, or directories)**: Unpacks `config.json`, `tokenizer.json`, and `.onnx` weights into IndexedDB virtual storage and runs via **ONNX Runtime (`@huggingface/transformers`)**. Archive extraction memory use depends on archive size; use raw `.gguf` for very large models.
  - **Device fit checks**: The APK reads Android manufacturer/model, available/total RAM and free storage. Linor estimates model working memory, warns before risky loads, and offers lower-resource settings. Browser installs show only approximate RAM/device information when the browser exposes it.
  - **Binary Header & Archive Inspector**: Parses GGUF v1–v3 KV metadata, Safetensors tensor tables, and archive file trees without loading multi-GB GGUF weights fully into JavaScript RAM.
  - **Built-in Sample `.zip` Archive**: Export `linor-starter-assistant.zip` to your Downloads folder or mount it in one tap to test archive extraction and streaming chat immediately.

- **Claude & ChatGPT Studio Experience**
  - **5 Themes**: Linor White (white primary, black secondary), Claude Dark/Light, and ChatGPT Dark/Light.
  - **Conversation Management**: Searchable chat history, pinned threads, Markdown export, message retry, code syntax blocks with one-tap copy, and collapsible `<think>...</think>` reasoning blocks (for Qwen3 / DeepSeek-R1 thinking models).
  - **On-Device Document Attachments**: Attach `.txt`, `.md`, `.json`, `.csv`, `.py`, `.ts`, `.kt`, and code files in chat for 100% private offline analysis.
  - **Full Inference Controls**: System prompt presets + custom system prompt, Temperature, Top-P, Top-K, Repeat Penalty, Max Tokens, Context Window (`n_ctx`), CPU Threads, and GPU Layer Offload.

---

## Running in Development

```bash
npm install
npm run dev
```

---

## Building the Native Android APK

### Option 1: Download and update the Android APK
After the maintainer configures the signing secrets and publishes the first stable-signed APK, install it from [GitHub Releases](https://github.com/xkilosky/AIMODEL/releases/latest). Linor then checks for updates when it opens and periodically while it is running, and downloads updates automatically over Wi-Fi. Tap **Install update** when it is ready; Android requires the user to approve each sideloaded APK installation. Updates keep Linor's private model files when the APK has the same signing key.

The first stable-signed release is a one-time migration from older CI debug APKs. Back up your original `.gguf` first; uninstalling the old build to change its signing key deletes Linor's private model files. After installing the stable-signed release, future updates can install in place and retain app data.

### Option 2: Automated Cloud Build (GitHub Actions)
Push to GitHub or trigger the **Build Linor Android APK** workflow in `.github/workflows/android-apk.yml`. Non-main branches and pull requests build a debug APK for CI checks; pushing or manually running the workflow on `main` can publish a signed update. To publish an installable auto-updating release, configure these repository Actions secrets once: `LINOR_RELEASE_KEYSTORE_BASE64` (base64-encoded PKCS#12 signing keystore) and `LINOR_RELEASE_STORE_PASSWORD`. Create the PKCS#12 keystore with alias `linor-release` and use its export password as the store password. Keep the keystore and password private and backed up; do not commit them. The workflow then publishes `Linor-Android.apk` and its update metadata to GitHub Releases.

### Option 3: Linor Build with Android Studio
1. Install JDK 21 and Android Studio (with Android SDK 36 & NDK `29.0.13113456`).
2. Sync the web bundle into `android/`:
   ```bash
   npm run android:sync
   ```
3. Open in Android Studio or build from CLI:
   ```bash
   npx cap open android
   # or:
   cd android && ./gradlew assembleDebug
   ```
   The installable APK is output to `android/app/build/outputs/apk/debug/app-debug.apk`.

### Option 4: Instant Offline Install on Android Chrome (PWA)
Open the hosted web app in Chrome on Android and tap **Menu (⋮) → Add to Home screen / Install app** to install **Linor** with fullscreen Android navigation and WebGPU/WASM offline model execution.
