import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Brain, Check, ChevronDown, ChevronRight, Copy } from 'lucide-react';

interface MarkdownMessageProps {
  content: string;
  reasoning?: string;
  isStreaming?: boolean;
}

export const MarkdownMessage: React.FC<MarkdownMessageProps> = ({
  content,
  reasoning,
  isStreaming = false,
}) => {
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [copiedBlock, setCopiedBlock] = useState<string | null>(null);

  const isCurrentlyThinking = Boolean(isStreaming && reasoning && !content);

  const handleCopyCode = (code: string) => {
    navigator.clipboard?.writeText(code);
    setCopiedBlock(code);
    setTimeout(() => setCopiedBlock(null), 1800);
  };

  return (
    <div className="space-y-3">
      {reasoning && (
        <div
          className="rounded-xl border overflow-hidden transition-colors"
          style={{
            backgroundColor: 'var(--bg-surface)',
            borderColor: 'var(--border-subtle)',
          }}
        >
          <button
            type="button"
            onClick={() => setThinkingOpen((prev) => !prev)}
            className="w-full flex items-center justify-between px-3.5 py-2.5 text-left text-xs font-medium transition-opacity hover:opacity-90"
            style={{ color: 'var(--text-secondary)' }}
          >
            <span className="flex items-center gap-2">
              <Brain
                className={`w-3.5 h-3.5 ${isCurrentlyThinking ? 'animate-pulse' : ''}`}
                style={{ color: 'var(--accent)' }}
              />
              <span>
                {isCurrentlyThinking ? 'Thinking on-device...' : 'Thought process'}
              </span>
            </span>
            {thinkingOpen || isCurrentlyThinking ? (
              <ChevronDown className="w-3.5 h-3.5 opacity-70" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 opacity-70" />
            )}
          </button>
          {(thinkingOpen || isCurrentlyThinking) && (
            <div
              className="px-3.5 pb-3 pt-1 text-xs leading-relaxed border-t whitespace-pre-wrap"
              style={{
                color: 'var(--text-muted)',
                borderColor: 'var(--border-subtle)',
                fontFamily: 'var(--font-sans)',
              }}
            >
              {reasoning}
              {isCurrentlyThinking && <span className="streaming-cursor" />}
            </div>
          )}
        </div>
      )}

      {(content || (!reasoning && isStreaming)) && (
        <div className="assistant-prose break-words" style={{ color: 'var(--text-primary)' }}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => <p className="mb-3.5 last:mb-0">{children}</p>,
              h1: ({ children }) => (
                <h1 className="text-xl font-semibold mt-5 mb-2.5 tracking-tight font-sans">
                  {children}
                </h1>
              ),
              h2: ({ children }) => (
                <h2 className="text-lg font-semibold mt-4 mb-2 tracking-tight font-sans">
                  {children}
                </h2>
              ),
              h3: ({ children }) => (
                <h3 className="text-base font-semibold mt-3.5 mb-1.5 font-sans">{children}</h3>
              ),
              ul: ({ children }) => (
                <ul className="list-disc pl-5 mb-3.5 space-y-1.5">{children}</ul>
              ),
              ol: ({ children }) => (
                <ol className="list-decimal pl-5 mb-3.5 space-y-1.5">{children}</ol>
              ),
              li: ({ children }) => <li className="leading-relaxed">{children}</li>,
              blockquote: ({ children }) => (
                <blockquote
                  className="border-l-3 pl-3.5 py-0.5 my-3 italic"
                  style={{
                    borderColor: 'var(--accent)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {children}
                </blockquote>
              ),
              table: ({ children }) => (
                <div
                  className="my-3.5 overflow-x-auto rounded-xl border font-sans text-sm"
                  style={{ borderColor: 'var(--border-strong)' }}
                >
                  <table className="w-full border-collapse text-left">{children}</table>
                </div>
              ),
              th: ({ children }) => (
                <th
                  className="px-3 py-2 font-semibold border-b text-xs uppercase tracking-wider"
                  style={{
                    backgroundColor: 'var(--bg-surface)',
                    borderColor: 'var(--border-strong)',
                  }}
                >
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td
                  className="px-3 py-2 border-b text-sm"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  {children}
                </td>
              ),
              a: ({ href, children }) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-2"
                  style={{ color: 'var(--accent)' }}
                >
                  {children}
                </a>
              ),
              code: ({ className, children }) => {
                const rawCode = String(children).replace(/\n$/, '');
                const match = /language-(\w+)/.exec(className || '');
                const isBlock = Boolean(match || rawCode.includes('\n'));

                if (!isBlock) {
                  return (
                    <code
                      className="px-1.5 py-0.5 rounded-md text-[0.86em]"
                      style={{
                        backgroundColor: 'var(--bg-elevated)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {children}
                    </code>
                  );
                }

                const lang = match?.[1] || 'code';
                const copied = copiedBlock === rawCode;

                return (
                  <div
                    className="my-3.5 rounded-xl overflow-hidden border font-sans"
                    style={{
                      backgroundColor: 'var(--code-bg)',
                      borderColor: 'rgba(255,255,255,0.1)',
                    }}
                  >
                    <div
                      className="flex items-center justify-between px-3.5 py-2 text-xs border-b"
                      style={{
                        backgroundColor: 'rgba(255,255,255,0.04)',
                        borderColor: 'rgba(255,255,255,0.08)',
                        color: '#a3a3a3',
                      }}
                    >
                      <span className="font-mono lowercase">{lang}</span>
                      <button
                        type="button"
                        onClick={() => handleCopyCode(rawCode)}
                        className="flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-white/10 transition-colors text-[#d4d4d4]"
                      >
                        {copied ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="text-emerald-400">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>
                    <pre className="p-3.5 overflow-x-auto text-[13px] leading-relaxed text-[#f1f1ef] m-0">
                      <code style={{ fontFamily: 'var(--font-mono)' }}>{rawCode}</code>
                    </pre>
                  </div>
                );
              },
            }}
          >
            {content}
          </ReactMarkdown>
          {isStreaming && !isCurrentlyThinking && <span className="streaming-cursor" />}
        </div>
      )}
    </div>
  );
};
