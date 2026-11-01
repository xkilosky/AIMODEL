import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packageJsonPath = require.resolve('llama-cpp-capacitor/package.json');
const packageRoot = new URL('.', `file://${packageJsonPath}`).pathname;
const jniPath = `${packageRoot}android/src/main/jni.cpp`;
let source = await readFile(jniPath, 'utf8');

const oldLoop = `                    // Check for end-of-sequence (simplified check)
                    if (token_output.tok == 2) { // Most models use 2 as EOS token
                        LOGI("Reached EOS token, stopping generation");
                        break;
                    }
                    
                    // Convert token to text
                    std::string token_text = capllama::tokens_to_output_formatted_string(ctx->ctx, token_output.tok);
                    generated_text += token_text;
                    tokens_generated++;`;

const threadAnchor = `                    // Extract n_batch`;
const threadPatch = `                    // Extract n_threads for CPU inference. The plugin accepts this setting,
                    // but its Android JNI model-init path previously ignored it.
                    jstring nThreadsKey = jni_utils::string_to_jstring(env, "n_threads");
                    jobject nThreadsObj = env->CallObjectMethod(params, getIntegerMethod, nThreadsKey);
                    if (nThreadsObj != nullptr && !env->ExceptionCheck()) {
                        jclass integerClass = env->FindClass("java/lang/Integer");
                        jmethodID intValueMethod = env->GetMethodID(integerClass, "intValue", "()I");
                        if (intValueMethod != nullptr && !env->ExceptionCheck()) {
                            const jint requestedThreads = env->CallIntMethod(nThreadsObj, intValueMethod);
                            if (requestedThreads > 0) {
                                cparams.cpuparams.n_threads = requestedThreads;
                                cparams.cpuparams_batch.n_threads = requestedThreads;
                            }
                        }
                        env->DeleteLocalRef(nThreadsObj);
                    }
                    env->DeleteLocalRef(nThreadsKey);
                    if (env->ExceptionCheck()) {
                        env->ExceptionClear();
                    }
                    LOGI("Configured CPU inference threads: %d", cparams.cpuparams.n_threads);

`;

if (source.includes('Extract n_threads for CPU inference')) {
  console.log('Android llama.cpp CPU-thread patch already applied.');
} else {
  if (!source.includes(threadAnchor)) {
    throw new Error('Could not locate the expected Android JNI n_batch parameter block; refusing an unsafe thread patch.');
  }
  source = source.replace(threadAnchor, threadPatch + threadAnchor);
  console.log('Applied Android llama.cpp CPU-thread patch.');
}

const fixedLoop = `                    // nextToken() tracks model-specific EOS/EOG tokens and the n_predict limit.
                    // Do not hard-code token ID 2: Qwen and other vocabularies use different EOS IDs.
                    if (ctx->completion->stopped_eos || token_output.tok < 0) {
                        LOGI("Reached model end-of-generation token, stopping generation");
                        break;
                    }

                    // Convert token to text
                    std::string token_text = capllama::tokens_to_output_formatted_string(ctx->ctx, token_output.tok);
                    generated_text += token_text;
                    tokens_generated++;

                    // nextToken() marks the final sampled token when the requested token budget is spent.
                    if (!ctx->completion->has_next_token) {
                        LOGI("Reached requested generation token limit");
                        break;
                    }`;

let changed = false;
if (source.includes('Reached model end-of-generation token, stopping generation')) {
  console.log('Android llama.cpp EOS patch already applied.');
} else {
  if (!source.includes(oldLoop)) {
    throw new Error('Could not locate the expected llama-cpp-capacitor Android token loop; refusing an unsafe patch.');
  }
  source = source.replace(oldLoop, fixedLoop);
  changed = true;
  console.log('Applied Android llama.cpp EOS/token-limit patch.');
}

if (changed || source !== await readFile(jniPath, 'utf8')) {
  await writeFile(jniPath, source);
}
