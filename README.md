# Local — On-Device AI Chat for Android

**Local** is a private, offline-first Android mobile AI chat app inspired by the clean interfaces of **Claude** and **ChatGPT**. Users pick their own AI model files (`.gguf`, `.onnx`, `.safetensors`, `.bin`) or compressed model archives (`.zip`, `.tar.gz`, `.tgz`, `.tar`, or model folders) directly from device storage and chat 100% locally.

---

## Key Features

- **Pick Models & Compressed Archives from Device Storage**
  - **GGUF Models (`.gguf` or `.zip` containing `.gguf`)**: Runs on **llama.cpp** — Native ARM64 C++ JNI (`llama-cpp-capacitor`) inside the Android APK, plus WebGPU / WASM SIMD (`@wllama/wllama`) in Android WebView & browsers.
  - **ONNX / Transformers Archives (`.zip`, `.tar.gz`, `.tar`, or directories)**: Automatically unpacks `config.json`, `tokenizer.json`, and `.onnx` weights into persistent IndexedDB virtual storage and runs via **ONNX Runtime (`@huggingface/transformers`)**.
  - **Binary Header & Archive Inspector**: Instantly parses GGUF v1–v3 KV metadata, Safetensors tensor tables, and archive file trees without loading multi-GB files fully into RAM.
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

### Option 1: Automated Cloud Build (GitHub Actions)
Push to GitHub or trigger the **Build Local Android APK** workflow in `.github/workflows/android-apk.yml`. GitHub Actions compiles the native ARM64 `llama.cpp` + Capacitor Android app and publishes `Local-Android-arm64-debug-apk` as a downloadable `.apk` artifact.

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
