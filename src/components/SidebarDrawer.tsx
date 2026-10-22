import React, { useState } from 'react';
import {
  Archive,
  Download,
  MessageSquare,
  Palette,
  Pin,
  Plus,
  Search,
  Smartphone,
  Trash2,
  X,
} from 'lucide-react';
import type { Conversation, StoredModelRecord, ThemeId } from '../types/local';
import { LocalLogo } from './LocalLogo';
import { formatBytes } from '../services/binaryInspectors';

interface SidebarDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  conversations: Conversation[];
  activeConversationId: string;
  onSelectConversation: (id: string) => void;
  onNewChat: () => void;
  onDeleteConversation: (id: string) => void;
  onTogglePin: (id: string) => void;
  onExportConversation: (conv: Conversation) => void;
  activeModel: StoredModelRecord | null;
  storedCount: number;
  onOpenModelModal: () => void;
  theme: ThemeId;
  onChangeTheme: (t: ThemeId) => void;
  onOpenAndroidModal: () => void;
}

const THEMES: Array<{ id: ThemeId; label: string; dot: string }> = [
  { id: 'claude-dark', label: 'Claude Dark', dot: '#d97757' },
  { id: 'claude-light', label: 'Claude Warm', dot: '#c96442' },
  { id: 'chatgpt-dark', label: 'GPT Dark', dot: '#10a37f' },
  { id: 'chatgpt-light', label: 'GPT Light', dot: '#0d0d0d' },
];

export const SidebarDrawer: React.FC<SidebarDrawerProps> = ({
  isOpen,
  onClose,
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewChat,
  onDeleteConversation,
  onTogglePin,
  onExportConversation,
  activeModel,
  storedCount,
  onOpenModelModal,
  theme,
  onChangeTheme,
  onOpenAndroidModal,
}) => {
  const [query, setQuery] = useState('');

  if (!isOpen) return null;

  const filtered = conversations.filter((c) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      c.title.toLowerCase().includes(q) ||
      c.messages.some((m) => m.content.toLowerCase().includes(q))
    );
  });

  const pinned = filtered.filter((c) => c.pinned);
  const unpinned = filtered.filter((c) => !c.pinned);

  return (
    <div className="fixed inset-0 z-30 flex">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/55 backdrop-blur-[2px] transition-opacity"
        onClick={onClose}
      />

      {/* Drawer Panel */}
      <aside
        className="relative z-10 w-[84vw] max-w-[310px] h-full flex flex-col border-r shadow-2xl safe-top safe-bottom"
        style={{
          backgroundColor: 'var(--bg-sidebar)',
          borderColor: 'var(--border-subtle)',
        }}
      >
        {/* Top Brand Row */}
        <div className="flex items-center justify-between px-4 pt-4 pb-3">
          <div className="flex items-center gap-2.5">
            <LocalLogo size={30} />
            <div>
              <div className="font-semibold text-base leading-none tracking-tight">Local</div>
              <div className="text-[10px] mt-1 font-medium" style={{ color: 'var(--accent)' }}>
                100% On-Device AI
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full hover:opacity-80"
            style={{ color: 'var(--text-secondary)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* New Chat + Search */}
        <div className="px-3 space-y-2 pb-3 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          <button
            type="button"
            onClick={() => {
              onNewChat();
              onClose();
            }}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-3.5 rounded-xl text-sm font-medium transition-transform active:scale-[0.99]"
            style={{
              backgroundColor: 'var(--accent)',
              color: 'var(--accent-text)',
            }}
          >
            <Plus className="w-4 h-4" />
            <span>New Chat</span>
          </button>

          <div
            className="flex items-center gap-2 px-3 py-2 rounded-xl border text-xs"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-subtle)',
            }}
          >
            <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--text-muted)' }} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search chats..."
              className="w-full bg-transparent focus:outline-none"
              style={{ color: 'var(--text-primary)' }}
            />
          </div>
        </div>

        {/* Conversations Scroll List */}
        <div className="flex-1 overflow-y-auto px-2.5 py-3 space-y-4">
          {pinned.length > 0 && (
            <ConversationSection
              title="Pinned"
              items={pinned}
              activeId={activeConversationId}
              onSelect={(id) => {
                onSelectConversation(id);
                onClose();
              }}
              onPin={onTogglePin}
              onExport={onExportConversation}
              onDelete={onDeleteConversation}
            />
          )}

          <ConversationSection
            title={pinned.length > 0 ? 'Recent Chats' : 'Conversations'}
            items={unpinned}
            activeId={activeConversationId}
            onSelect={(id) => {
              onSelectConversation(id);
              onClose();
            }}
            onPin={onTogglePin}
            onExport={onExportConversation}
            onDelete={onDeleteConversation}
          />
        </div>

        {/* Bottom Dock: Model Card + Theme Switcher + Android Status */}
        <div
          className="p-3 border-t space-y-2.5"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          {/* Active Model / Archive Button */}
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenModelModal();
            }}
            className="w-full flex items-center justify-between gap-2 p-2.5 rounded-xl border text-left transition-colors hover:opacity-95"
            style={{
              backgroundColor: 'var(--bg-surface)',
              borderColor: 'var(--border-strong)',
            }}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: 'var(--accent-soft)', color: 'var(--accent)' }}
              >
                <Archive className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold truncate">
                  {activeModel ? activeModel.name : 'Pick Model / Archive'}
                </div>
                <div className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
                  {activeModel
                    ? `${activeModel.specs.format} · ${formatBytes(activeModel.totalBytes)}`
                    : `${storedCount} saved in library`}
                </div>
              </div>
            </div>
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{
                backgroundColor: activeModel ? '#10b981' : 'var(--text-muted)',
              }}
            />
          </button>

          {/* Theme Switcher (Claude & ChatGPT Light/Dark) */}
          <div className="space-y-1.5">
            <div
              className="flex items-center justify-between text-[11px] px-1"
              style={{ color: 'var(--text-muted)' }}
            >
              <span className="flex items-center gap-1 font-medium">
                <Palette className="w-3 h-3" />
                <span>Interface Style</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenAndroidModal();
                }}
                className="flex items-center gap-1 underline-offset-2 hover:underline"
                style={{ color: 'var(--accent)' }}
              >
                <Smartphone className="w-3 h-3" />
                <span>Android Info</span>
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {THEMES.map((t) => {
                const selected = theme === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => onChangeTheme(t.id)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-all"
                    style={{
                      backgroundColor: selected ? 'var(--accent-soft)' : 'var(--bg-surface)',
                      borderColor: selected ? 'var(--accent)' : 'var(--border-subtle)',
                    }}
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: t.dot }}
                    />
                    <span className="truncate">{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
};

interface ConversationSectionProps {
  title: string;
  items: Conversation[];
  activeId: string;
  onSelect: (id: string) => void;
  onPin: (id: string) => void;
  onExport: (c: Conversation) => void;
  onDelete: (id: string) => void;
}

const ConversationSection: React.FC<ConversationSectionProps> = ({
  title,
  items,
  activeId,
  onSelect,
  onPin,
  onExport,
  onDelete,
}) => (
  <div>
    <div
      className="px-2 mb-1.5 text-[10px] font-semibold uppercase tracking-wider"
      style={{ color: 'var(--text-muted)' }}
    >
      {title}
    </div>
    {items.length === 0 ? (
      <div className="px-2 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
        No conversations yet.
      </div>
    ) : (
      <div className="space-y-0.5">
        {items.map((conv) => {
          const active = conv.id === activeId;
          return (
            <div
              key={conv.id}
              onClick={() => onSelect(conv.id)}
              className="group flex items-center justify-between gap-1 px-2.5 py-2 rounded-xl cursor-pointer transition-colors"
              style={{
                backgroundColor: active ? 'var(--bg-elevated)' : 'transparent',
              }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <MessageSquare
                  className="w-3.5 h-3.5 shrink-0"
                  style={{ color: active ? 'var(--accent)' : 'var(--text-muted)' }}
                />
                <span className="text-xs font-medium truncate">{conv.title}</span>
              </div>
              <div
                className="flex items-center gap-0.5 opacity-80 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  type="button"
                  title={conv.pinned ? 'Unpin' : 'Pin'}
                  onClick={() => onPin(conv.id)}
                  className="p-1 rounded hover:bg-black/10"
                  style={{ color: conv.pinned ? 'var(--accent)' : 'var(--text-muted)' }}
                >
                  <Pin className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  title="Export Markdown"
                  onClick={() => onExport(conv)}
                  className="p-1 rounded hover:bg-black/10"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <Download className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  title="Delete chat"
                  onClick={() => onDelete(conv.id)}
                  className="p-1 rounded hover:bg-black/10 text-red-400"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    )}
  </div>
);
