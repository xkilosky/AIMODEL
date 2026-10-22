import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packageJsonPath = require.resolve('llama-cpp-capacitor/package.json');
const packageRoot = new URL('.', `file://${packageJsonPath}`).pathname;
const jniPath = `${packageRoot}android/src/main/jni.cpp`;
const source = await readFile(jniPath, 'utf8');

const oldLoop = `                    // Check for end-of-sequence (simplified check)
                    if (token_output.tok == 2) { // Most models use 2 as EOS token
                        LOGI("Reached EOS token, stopping generation");
                        break;
                    }
                    
                    // Convert token to text
                    std::string token_text = capllama::tokens_to_output_formatted_string(ctx->ctx, token_output.tok);
                    generated_text += token_text;
                    tokens_generated++;`;

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

if (source.includes('Reached model end-of-generation token, stopping generation')) {
  console.log('Android llama.cpp EOS patch already applied.');
} else {
  if (!source.includes(oldLoop)) {
    throw new Error('Could not locate the expected llama-cpp-capacitor Android token loop; refusing an unsafe patch.');
  }
  await writeFile(jniPath, source.replace(oldLoop, fixedLoop));
  console.log('Applied Android llama.cpp EOS/token-limit patch.');
}
