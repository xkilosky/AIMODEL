# Local — On-Device AI Chat for Android

**Local** is a private, offline-first Android mobile AI chat app inspired by the clean interfaces of **Claude** and **ChatGPT**. Users pick their own AI model files (`.gguf`, `.onnx`, `.safetensors`, `.bin`) or compressed model archives (`.zip`, `.tar.gz`, `.tgz`, `.tar`, or model folders) directly from device storage and chat 100% locally.

---

## Key Features

- **Pick Models & Compressed Archives from Device Storage**
  - **Large GGUFs on Android (`.gguf`)**: The native APK's Android Files picker copies raw GGUF weights in a streaming, 1 MB buffer into app-private phone storage, then loads the file directly with ARM64 `llama.cpp`/memory mapping. The local model-library cap is **8 GiB total per app install**; actual import is limited by available phone storage.
  - **Web/PWA GGUFs**: Runs via WebGPU/WASM SIMD and uses browser-managed storage; large browser loads are best-effort and may be session-only depending on browser quota. Use the APK's **Large GGUF (Native)** picker for multi-GB files.
  - **ONNX / Transformers Archives (`.zip`, `.tar.gz`, `.tar`, or directories)**: Unpacks `config.json`, `tokenizer.json`, and `.onnx` weights into IndexedDB virtual storage and runs via **ONNX Runtime (`@huggingface/transformers`)**. Archive extraction memory use depends on archive size; use raw `.gguf` for very large models.
  - **Device fit checks**: The APK reads Android manufacturer/model, available/total RAM and free storage. Local estimates model working memory, warns before risky loads, and offers lower-resource settings. Browser installs show only approximate RAM/device information when the browser exposes it.
  - **Binary Header & Archive Inspector**: Parses GGUF v1–v3 KV metadata, Safetensors tensor tables, and archive file trees without loading multi-GB GGUF weights fully into JavaScript RAM.
  - **Built-in Sample `.zip` Archive**: Export `local-starter-assistant.zip` to your Downloads folder or mount it in one tap to test archive extraction and streaming chat immediately.

- **Claude & ChatGPT Studio Experience**
  - **4 Themes**: *Claude Dark*, *Claude Warm (Light)*, *ChatGPT Dark*, and *ChatGPT Light*.
  - **Conversation Management**: Searchable chat history, pinned threads, Markdown export, message retry, code syntax blocks with one-tap copy, and collapsible `<think>...</think>` reasoning blocks (for Qwen3 / DeepSeek-R1 thinking models).
  - **Local Document Attachments**: Attach `.txt`, `.md`, `.json`, `.csv`, `.py`, `.ts`, `.kt`, and code files in chat for 100% private offline analysis.
  - **Full Inference Controls**: System prompt presets + custom system prompt, Temperature, Top-P, Top-K, Repeat Penalty, Max Tokens, Context Window (`n_ctx`), CPU Threads, and GPU Layer Offload.

---

## Running in Development

```bash
npm install
npm run dev
```

---

## Building the Native Android APK

### Option 1: Download the Android APK
Install the latest signed-by-GitHub Actions debug APK from [GitHub Releases](https://github.com/xkilosky/AIMODEL/releases/latest). On Android, download the APK, open it from Downloads, and approve the one-time unknown-app install prompt if Android asks.

### Option 2: Automated Cloud Build (GitHub Actions)
Push to GitHub or trigger the **Build Local Android APK** workflow in `.github/workflows/android-apk.yml`. GitHub Actions compiles the native ARM64 `llama.cpp` + Capacitor Android app, uploads a workflow artifact, and refreshes the APK in GitHub Releases.

### Option 2: Local Build with Android Studio
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

### Option 3: Instant Offline Install on Android Chrome (PWA)
Open the hosted web app in Chrome on Android and tap **Menu (⋮) → Add to Home screen / Install app** to install **Local** with fullscreen Android navigation and WebGPU/WASM offline model execution.
