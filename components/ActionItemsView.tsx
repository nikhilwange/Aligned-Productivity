import React, { useState, useMemo, useRef, useEffect } from 'react';
import { RecordingSession, TrackedActionItem, ActionItemStatus, ActionItemUpdate } from '../types';
import { updateActionItem, deleteActionItem } from '../services/supabaseService';
import EmptyState from './EmptyState';

interface ActionItemsViewProps {
  recordings: RecordingSession[];
  actionItems: TrackedActionItem[];
  onActionItemsChange: React.Dispatch<React.SetStateAction<TrackedActionItem[]>>;
  userId: string;
  onSelectSession: (id: string) => void;
}

type ViewMode = 'list' | 'board';
type FilterStatus = 'all' | ActionItemStatus;

const STATUS_ORDER: ActionItemStatus[] = ['not_started', 'in_progress', 'on_hold', 'completed'];

const STATUS_CONFIG: Record<ActionItemStatus, {
  label: string; bg: string; text: string; dot: string; border: string; colHeader: string;
}> = {
  not_started: { label: 'Not Started', bg: 'bg-[var(--glass-bg)]',   text: 'text-[var(--text-muted)]',   dot: 'bg-[var(--text-muted)]', border: 'border-[var(--glass-border)]', colHeader: 'text-[var(--text-secondary)]' },
  in_progress: { label: 'In Progress', bg: 'bg-amber-500/10',        text: 'text-amber-400',             dot: 'bg-amber-400',           border: 'border-amber-500/20',          colHeader: 'text-amber-400' },
  on_hold:     { label: 'On Hold',     bg: 'bg-teal-500/10',         text: 'text-teal-400',              dot: 'bg-teal-400',            border: 'border-teal-500/20',           colHeader: 'text-teal-400' },
  completed:   { label: 'Completed',   bg: 'bg-purple-500/10',       text: 'text-purple-400',            dot: 'bg-purple-400',          border: 'border-purple-500/20',         colHeader: 'text-purple-400' },
};

const nextStatus = (s: ActionItemStatus): ActionItemStatus =>
  STATUS_ORDER[(STATUS_ORDER.indexOf(s) + 1) % 4];

// ─── Inline Edit Form ──────────────────────────────────────────────────────────
interface EditFormProps {
  item: TrackedActionItem;
  allTags: string[];
  allAssignees: string[];
  onSave: (updates: ActionItemUpdate) => void;
  onCancel: () => void;
}

const EditForm: React.FC<EditFormProps> = ({ item, allTags, allAssignees, onSave, onCancel }) => {
  const [text, setText] = useState(item.text);
  const [tag, setTag] = useState(item.functionTag ?? '');
  const [assignee, setAssignee] = useState(item.assignee ?? '');
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textRef.current) {
      textRef.current.focus();
      textRef.current.style.height = 'auto';
      textRef.current.style.height = textRef.current.scrollHeight + 'px';
    }
  }, []);

  const handleSave = () => {
    if (!text.trim()) return;
    onSave({ text: text.trim(), functionTag: tag.trim() || null, assignee: assignee.trim() || null });
  };

  return (
    <div className="mt-3 pt-3 border-t border-[var(--glass-border)] flex flex-col gap-2">
      <textarea
        ref={textRef}
        value={text}
        onChange={e => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }}
        className="glass-input rounded-lg px-3 py-2 text-sm text-[var(--text-primary)] resize-none w-full"
        rows={2}
      />
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input value={tag} onChange={e => setTag(e.target.value)} list="aligned-tags-list"
            placeholder="Function / Dept (e.g. Engineering)"
            className="glass-input rounded-lg px-3 py-1.5 text-xs w-full text-[var(--text-primary)]" />
          <datalist id="aligned-tags-list">{allTags.map(t => <option key={t} value={t} />)}</datalist>
        </div>
        <div className="relative flex-1">
          <input value={assignee} onChange={e => setAssignee(e.target.value)} list="aligned-assignees-list"
            placeholder="Assignee (e.g. Me, Priya)"
            className="glass-input rounded-lg px-3 py-1.5 text-xs w-full text-[var(--text-primary)]" />
          <datalist id="aligned-assignees-list">{allAssignees.map(a => <option key={a} value={a} />)}</datalist>
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={handleSave} className="px-4 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 text-xs font-semibold hover:bg-amber-500/30 transition-colors">Save</button>
        <button onClick={onCancel} className="px-4 py-1.5 rounded-lg glass text-[var(--text-muted)] text-xs font-semibold hover:text-[var(--text-secondary)] transition-colors">Cancel</button>
      </div>
    </div>
  );
};

// ─── Action Card ───────────────────────────────────────────────────────────────
interface ActionCardProps {
  item: TrackedActionItem;
  variant: 'board' | 'list';
  allTags: string[];
  allAssignees: string[];
  editingId: string | null;
  savingId: string | null;
  onStatusCycle: (item: TrackedActionItem) => void;
  onEdit: (id: string) => void;
  onSaveEdit: (id: string, updates: ActionItemUpdate) => void;
  onCancelEdit: () => void;
  onDelete: (item: TrackedActionItem) => void;
  onSelectSession: (id: string) => void;
}

const ActionCard: React.FC<ActionCardProps> = ({
  item, variant, allTags, allAssignees, editingId, savingId,
  onStatusCycle, onEdit, onSaveEdit, onCancelEdit, onDelete, onSelectSession,
}) => {
  const cfg = STATUS_CONFIG[item.status];
  const isEditing = editingId === item.id;
  const isSaving = savingId === item.id;
  const isCompleted = item.status === 'completed';

  return (
    <div className={`glass-card rounded-xl p-4 group/card transition-all duration-200 ${variant === 'board' ? 'mb-2' : ''}`}>
      {/* Row 1: status badge + text */}
      <div className="flex items-start gap-2.5">
        <button
          onClick={() => onStatusCycle(item)}
          title={`Click to set: ${STATUS_CONFIG[nextStatus(item.status)].label}`}
          className={`mt-0.5 flex-shrink-0 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[10px] font-bold transition-all duration-200 ${isSaving ? 'opacity-50 cursor-wait' : 'cursor-pointer hover:opacity-75'} ${cfg.bg} ${cfg.text}`}
        >
          <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}`} />
          {cfg.label}
        </button>
        <p
          onClick={() => !isEditing && onEdit(item.id)}
          className={`flex-1 text-sm leading-relaxed cursor-pointer transition-colors ${isCompleted ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-primary)] hover:text-[var(--text-secondary)]'}`}
        >
          {item.text}
        </p>
      </div>

      {/* Row 2: pills + actions — always visible */}
      <div className="flex items-center gap-2 mt-2.5 flex-wrap">
        {item.functionTag ? (
          <button onClick={() => onEdit(item.id)} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-300 text-[10px] font-semibold hover:bg-amber-500/20 transition-colors">
            {item.functionTag}
          </button>
        ) : (
          <button onClick={() => onEdit(item.id)} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md glass text-[var(--text-muted)] text-[10px] font-semibold hover:text-amber-300 transition-colors">
            + Function
          </button>
        )}

        {item.assignee ? (
          <button onClick={() => onEdit(item.id)} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-teal-500/10 text-teal-300 text-[10px] font-semibold hover:bg-teal-500/20 transition-colors">
            {item.assignee}
          </button>
        ) : (
          <button onClick={() => onEdit(item.id)} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md glass text-[var(--text-muted)] text-[10px] font-semibold hover:text-teal-300 transition-colors">
            + Assignee
          </button>
        )}

        <div className="ml-auto flex items-center gap-1">
          {variant === 'list' && item.recordingId && (
            <button onClick={() => onSelectSession(item.recordingId!)} title="Open session"
              className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-white/5 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </button>
          )}
          <button onClick={() => onDelete(item)}
            className="p-1 rounded-lg text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        </div>
      </div>

      {isEditing && (
        <EditForm item={item} allTags={allTags} allAssignees={allAssignees}
          onSave={updates => onSaveEdit(item.id, updates)} onCancel={onCancelEdit} />
      )}
    </div>
  );
};

// ─── Main Component ────────────────────────────────────────────────────────────
const ActionItemsView: React.FC<ActionItemsViewProps> = ({
  recordings, actionItems, onActionItemsChange, userId, onSelectSession,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    (localStorage.getItem('aligned-action-view') as ViewMode) || 'list'
  );
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [filterTag, setFilterTag] = useState('all');
  const [filterAssignee, setFilterAssignee] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const toggleView = (mode: ViewMode) => { setViewMode(mode); localStorage.setItem('aligned-action-view', mode); };

  const allTags = useMemo(() =>
    [...new Set(actionItems.map(i => i.functionTag).filter(Boolean) as string[])].sort(), [actionItems]);

  const allAssignees = useMemo(() =>
    [...new Set(actionItems.map(i => i.assignee).filter(Boolean) as string[])].sort(), [actionItems]);

  const filteredItems = useMemo(() => {
    let items = actionItems;
    if (filterStatus !== 'all') items = items.filter(i => i.status === filterStatus);
    if (filterTag !== 'all') items = items.filter(i => i.functionTag === filterTag);
    if (filterAssignee !== 'all') items = items.filter(i => i.assignee === filterAssignee);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(i =>
        i.text.toLowerCase().includes(q) ||
        (i.sessionTitle ?? '').toLowerCase().includes(q) ||
        (i.functionTag ?? '').toLowerCase().includes(q) ||
        (i.assignee ?? '').toLowerCase().includes(q)
      );
    }
    return items;
  }, [actionItems, filterStatus, filterTag, filterAssignee, searchQuery]);

  const boardColumns = useMemo(() => ({
    not_started: filteredItems.filter(i => i.status === 'not_started'),
    in_progress: filteredItems.filter(i => i.status === 'in_progress'),
    on_hold:     filteredItems.filter(i => i.status === 'on_hold'),
    completed:   filteredItems.filter(i => i.status === 'completed'),
  }), [filteredItems]);

  const groupedBySession = useMemo(() => {
    const map = new Map<string, { id: string; title: string; date: number; items: TrackedActionItem[] }>();
    filteredItems.forEach(item => {
      const key = item.recordingId ?? 'standalone';
      if (!map.has(key)) {
        map.set(key, { id: item.recordingId ?? 'standalone', title: item.sessionTitle ?? 'Standalone Items', date: item.sessionDate ?? item.createdAt, items: [] });
      }
      map.get(key)!.items.push(item);
    });
    return [...map.values()].sort((a, b) => b.date - a.date);
  }, [filteredItems]);

  const statusCounts = useMemo(() => ({
    not_started: actionItems.filter(i => i.status === 'not_started').length,
    in_progress: actionItems.filter(i => i.status === 'in_progress').length,
    on_hold:     actionItems.filter(i => i.status === 'on_hold').length,
    completed:   actionItems.filter(i => i.status === 'completed').length,
  }), [actionItems]);

  const handleStatusCycle = async (item: TrackedActionItem) => {
    const newStatus = nextStatus(item.status);
    onActionItemsChange(prev => prev.map(i => i.id === item.id ? { ...i, status: newStatus } : i));
    setSavingId(item.id);
    try {
      await updateActionItem(item.id, { status: newStatus });
    } catch {
      onActionItemsChange(prev => prev.map(i => i.id === item.id ? { ...i, status: item.status } : i));
    } finally {
      setSavingId(null);
    }
  };

  const handleSaveEdit = async (id: string, updates: ActionItemUpdate) => {
    onActionItemsChange(prev => prev.map(i => i.id === id ? { ...i, ...updates } : i));
    setEditingId(null);
    await updateActionItem(id, updates);
  };

  const handleDelete = async (item: TrackedActionItem) => {
    onActionItemsChange(prev => prev.filter(i => i.id !== item.id));
    await deleteActionItem(item.id);
  };

  const cardProps = {
    allTags, allAssignees, editingId, savingId,
    onStatusCycle: handleStatusCycle,
    onEdit: (id: string) => setEditingId(prev => prev === id ? null : id),
    onSaveEdit: handleSaveEdit,
    onCancelEdit: () => setEditingId(null),
    onDelete: handleDelete,
    onSelectSession,
  };

  if (actionItems.length === 0) {
    return (
      <EmptyState
        tone="amber"
        title="No action items yet"
        description="Action items from your recorded sessions will appear here automatically once processing is complete."
        icon={
          <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
        }
      />
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="px-6 md:px-8 pt-6 pb-4 border-b border-[var(--glass-border)] shrink-0">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/15 flex items-center justify-center border border-white/[0.08]">
              <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
            </div>
            <div>
              <h1 className="font-display-tight text-xl font-semibold text-[var(--text-primary)]">Action Tracker</h1>
              <p className="text-xs text-[var(--text-muted)]">{actionItems.length} items total</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Status counts */}
            <div className="hidden sm:flex items-center gap-2">
              {STATUS_ORDER.map(s => (
                <div key={s} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold ${STATUS_CONFIG[s].bg} ${STATUS_CONFIG[s].text}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${STATUS_CONFIG[s].dot}`} />
                  {statusCounts[s]}
                </div>
              ))}
            </div>
            {/* View toggle */}
            <div className="flex glass-card p-1 rounded-xl gap-1">
              <button onClick={() => toggleView('list')} title="List view"
                className={`p-1.5 rounded-lg transition-all ${viewMode === 'list' ? 'bg-white/10 text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
              </button>
              <button onClick={() => toggleView('board')} title="Board view"
                className={`p-1.5 rounded-lg transition-all ${viewMode === 'board' ? 'bg-white/10 text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap gap-2">
          <div className="flex glass-card p-1 rounded-xl gap-1">
            <button onClick={() => setFilterStatus('all')}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${filterStatus === 'all' ? 'bg-white/10 text-[var(--text-primary)]' : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
              All
            </button>
            {STATUS_ORDER.map(s => (
              <button key={s} onClick={() => setFilterStatus(s)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${filterStatus === s ? `${STATUS_CONFIG[s].bg} ${STATUS_CONFIG[s].text}` : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'}`}>
                {STATUS_CONFIG[s].label}
              </button>
            ))}
          </div>

          {allTags.length > 0 && (
            <select value={filterTag} onChange={e => setFilterTag(e.target.value)}
              className="glass-input rounded-xl px-3 py-1.5 text-xs text-[var(--text-secondary)] cursor-pointer">
              <option value="all">All Functions</option>
              {allTags.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          )}

          {allAssignees.length > 0 && (
            <select value={filterAssignee} onChange={e => setFilterAssignee(e.target.value)}
              className="glass-input rounded-xl px-3 py-1.5 text-xs text-[var(--text-secondary)] cursor-pointer">
              <option value="all">All Assignees</option>
              {allAssignees.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
          )}

          <div className="relative flex-1 min-w-[160px]">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search actions..."
              className="glass-input rounded-xl pl-8 pr-3 py-1.5 text-xs w-full text-[var(--text-primary)]" />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-secondary)]">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden">
        {filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <svg className="w-10 h-10 text-[var(--text-muted)] mb-4 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <p className="text-sm font-semibold text-[var(--text-secondary)]">No items match your filters</p>
            <button onClick={() => { setFilterStatus('all'); setFilterTag('all'); setFilterAssignee('all'); setSearchQuery(''); }}
              className="mt-3 text-xs text-amber-400 hover:text-amber-300 font-semibold transition-colors">
              Clear all filters
            </button>
          </div>

        ) : viewMode === 'board' ? (
          // ── Board View ────────────────────────────────────────────────
          <div className="h-full overflow-x-auto">
            <div className="grid grid-cols-4 gap-4 min-w-[860px] h-full p-6">
              {STATUS_ORDER.map(status => {
                const cfg = STATUS_CONFIG[status];
                const col = boardColumns[status];
                return (
                  <div key={status} className="flex flex-col h-full min-h-0">
                    <div className="flex items-center justify-between mb-3 px-1">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                        <span className={`text-xs font-bold uppercase tracking-wider ${cfg.colHeader}`}>{cfg.label}</span>
                      </div>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-lg ${cfg.bg} ${cfg.text}`}>{col.length}</span>
                    </div>
                    <div className={`flex-1 overflow-y-auto rounded-xl border ${cfg.border} p-2 bg-[var(--glass-bg)]`}>
                      {col.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-32 text-center opacity-30">
                          <span className={`w-6 h-6 rounded-full border-2 ${cfg.border} mb-2`} />
                          <p className="text-xs text-[var(--text-muted)]">No items</p>
                        </div>
                      ) : (
                        col.map(item => <ActionCard key={item.id} item={item} variant="board" {...cardProps} />)
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

        ) : (
          // ── List View ─────────────────────────────────────────────────
          <div className="h-full overflow-y-auto px-6 md:px-8 py-6">
            <p className="text-xs text-[var(--text-muted)] mb-6">
              {filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''}
              {statusCounts.in_progress > 0 && ` · ${statusCounts.in_progress} in progress`}
              {statusCounts.completed > 0 && ` · ${statusCounts.completed} completed`}
            </p>

            {groupedBySession.map(group => (
              <div key={group.id} className="mb-8">
                <div className="flex items-center gap-3 mb-3">
                  <button
                    onClick={() => group.id !== 'standalone' && onSelectSession(group.id)}
                    className={`text-sm font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors truncate max-w-xs ${group.id === 'standalone' ? 'cursor-default' : 'cursor-pointer'}`}
                  >
                    {group.title}
                  </button>
                  <span className="text-xs text-[var(--text-muted)] shrink-0">{new Date(group.date).toLocaleDateString()}</span>
                  <span className="text-xs text-[var(--text-muted)] ml-auto shrink-0">{group.items.length} item{group.items.length !== 1 ? 's' : ''}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {group.items.map(item => <ActionCard key={item.id} item={item} variant="list" {...cardProps} />)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default ActionItemsView;
