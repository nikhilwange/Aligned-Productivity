import React, { useState, useMemo, useRef, useEffect } from 'react';
import { RecordingSession, TrackedActionItem, ActionItemStatus, ActionItemUpdate } from '../types';
import { updateActionItem, deleteActionItem, createActionItem } from '../services/supabaseService';
import { initialsOf, colorFor, formatActionId } from '../utils/avatar';
import EmptyState from './EmptyState';

interface ActionItemsViewProps {
  recordings: RecordingSession[];
  actionItems: TrackedActionItem[];
  onActionItemsChange: React.Dispatch<React.SetStateAction<TrackedActionItem[]>>;
  userId: string;
  userName?: string;
  onSelectSession: (id: string) => void;
}

type FilterTab = 'all' | 'mine' | 'this_week' | 'done';

// Cycle order excludes 'on_hold' for the granola single-click pattern.
// Click status circle: not_started → in_progress → completed → not_started.
const CYCLE: ActionItemStatus[] = ['not_started', 'in_progress', 'completed'];
const cycleNext = (s: ActionItemStatus): ActionItemStatus => {
  const i = CYCLE.indexOf(s);
  return CYCLE[(i + 1) % CYCLE.length] ?? 'not_started';
};

// ─── Date helpers ──────────────────────────────────────────────────────────
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const dayDiff = (target: number, ref: Date = new Date()) => {
  const t = startOfDay(new Date(target)).getTime();
  const r = startOfDay(ref).getTime();
  return Math.round((t - r) / 86400000);
};
const formatDue = (ms: number | null): string => {
  if (ms == null) return '';
  const diff = dayDiff(ms);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return new Date(ms).toLocaleDateString(undefined, { weekday: 'short' });
  if (diff < 0) return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};
const isWithinWeek = (ms: number | null) => {
  if (ms == null) return false;
  const d = dayDiff(ms);
  return d >= 0 && d <= 7;
};

// ─── Status circle (clickable) ─────────────────────────────────────────────
const StatusCircle: React.FC<{ status: ActionItemStatus; onClick: () => void; busy?: boolean }> =
  ({ status, onClick, busy }) => {
    const accent = 'var(--accent)';
    const muted  = 'var(--border-strong)';
    const common = 'inline-flex items-center justify-center w-[18px] h-[18px] rounded-full border-[1.5px] transition shrink-0';
    if (status === 'completed') {
      return (
        <button onClick={onClick} disabled={busy}
          className={common}
          style={{ background: accent, borderColor: accent, color: 'var(--accent-fg)', opacity: busy ? 0.5 : 1 }}
          aria-label="Mark not started">
          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </button>
      );
    }
    if (status === 'in_progress') {
      return (
        <button onClick={onClick} disabled={busy}
          className={common}
          style={{ borderColor: accent, color: accent, opacity: busy ? 0.5 : 1 }}
          aria-label="Mark complete">
          <span className="text-[10px] font-bold leading-none">◐</span>
        </button>
      );
    }
    return (
      <button onClick={onClick} disabled={busy}
        className={common}
        style={{ borderColor: muted, opacity: busy ? 0.5 : 1 }}
        aria-label="Mark in progress" />
    );
  };

// ─── Inline edit form ──────────────────────────────────────────────────────
interface EditFormProps {
  item: TrackedActionItem;
  allAssignees: string[];
  onSave: (updates: ActionItemUpdate) => void;
  onCancel: () => void;
}
const EditForm: React.FC<EditFormProps> = ({ item, allAssignees, onSave, onCancel }) => {
  const [text, setText] = useState(item.text);
  const [assignee, setAssignee] = useState(item.assignee ?? '');
  const [dueDate, setDueDate] = useState(item.dueDate ? new Date(item.dueDate).toISOString().slice(0, 10) : '');
  const textRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!textRef.current) return;
    textRef.current.focus();
    textRef.current.style.height = 'auto';
    textRef.current.style.height = textRef.current.scrollHeight + 'px';
  }, []);

  const handleSave = () => {
    if (!text.trim()) return;
    onSave({
      text: text.trim(),
      assignee: assignee.trim() || null,
      dueDate: dueDate ? new Date(dueDate).getTime() : null,
    });
  };

  return (
    <div className="mt-3 p-3 rounded-2xl flex flex-col gap-2"
         style={{ background: 'var(--bg-sunken)' }}>
      <textarea
        ref={textRef}
        value={text}
        onChange={e => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; }}
        className="px-3 py-2 text-sm resize-none w-full rounded-xl outline-none"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text)' }}
        rows={2}
      />
      <div className="flex flex-wrap gap-2">
        <input value={assignee} onChange={e => setAssignee(e.target.value)} list="aligned-assignees-list"
          placeholder="Assignee"
          className="flex-1 min-w-[140px] px-3 py-1.5 text-xs rounded-full outline-none"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text)' }} />
        <datalist id="aligned-assignees-list">{allAssignees.map(a => <option key={a} value={a} />)}</datalist>
        <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
          className="px-3 py-1.5 text-xs rounded-full outline-none"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text)' }} />
      </div>
      <div className="flex gap-2">
        <button onClick={handleSave}
          className="px-4 py-1.5 rounded-full text-xs font-semibold"
          style={{ background: 'var(--accent)', color: 'var(--accent-fg)' }}>
          Save
        </button>
        <button onClick={onCancel}
          className="px-4 py-1.5 rounded-full text-xs font-semibold"
          style={{ background: 'transparent', color: 'var(--text-muted)' }}>
          Cancel
        </button>
      </div>
    </div>
  );
};

// ─── Main component ────────────────────────────────────────────────────────
const ActionItemsView: React.FC<ActionItemsViewProps> = ({
  actionItems, onActionItemsChange, userId, userName, onSelectSession,
}) => {
  const [tab, setTab] = useState<FilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const [newText, setNewText] = useState('');
  const newRef = useRef<HTMLInputElement>(null);

  const allAssignees = useMemo(() =>
    [...new Set(actionItems.map(i => i.assignee).filter(Boolean) as string[])].sort(), [actionItems]);

  // Tab counts
  const counts = useMemo(() => {
    const open = actionItems.filter(i => i.status !== 'completed');
    const mineMatch = (i: TrackedActionItem) => {
      if (!i.assignee) return false;
      if (userName && i.assignee.toLowerCase() === userName.toLowerCase()) return true;
      return i.assignee.toLowerCase() === 'me';
    };
    return {
      all:       open.length,
      mine:      open.filter(mineMatch).length,
      this_week: open.filter(i => isWithinWeek(i.dueDate)).length,
      done:      actionItems.filter(i => i.status === 'completed').length,
    };
  }, [actionItems, userName]);

  // Filtered list
  const filtered = useMemo(() => {
    let items = actionItems.slice();
    if (tab === 'all')       items = items.filter(i => i.status !== 'completed');
    if (tab === 'done')      items = items.filter(i => i.status === 'completed');
    if (tab === 'mine')      items = items.filter(i => i.status !== 'completed' &&
      (i.assignee && (
        (userName && i.assignee.toLowerCase() === userName.toLowerCase()) ||
        i.assignee.toLowerCase() === 'me'
      )));
    if (tab === 'this_week') items = items.filter(i => i.status !== 'completed' && isWithinWeek(i.dueDate));

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      items = items.filter(i =>
        i.text.toLowerCase().includes(q) ||
        (i.sessionTitle ?? '').toLowerCase().includes(q) ||
        (i.assignee ?? '').toLowerCase().includes(q) ||
        formatActionId(i.displayId).toLowerCase().includes(q)
      );
    }
    // Sort: in-progress first, then by due date asc (nulls last), then by displayId desc
    return items.sort((a, b) => {
      if (a.status !== b.status) {
        const order = { in_progress: 0, not_started: 1, on_hold: 2, completed: 3 };
        return (order[a.status] ?? 9) - (order[b.status] ?? 9);
      }
      if (a.dueDate && b.dueDate) return a.dueDate - b.dueDate;
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return b.displayId - a.displayId;
    });
  }, [actionItems, tab, searchQuery, userName]);

  // ⌘N → open composer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault();
        setComposing(true);
        setTimeout(() => newRef.current?.focus(), 0);
      }
      if (e.key === 'Escape' && composing) {
        setComposing(false);
        setNewText('');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [composing]);

  // ─── Mutations ──────────────────────────────────────────────────────────
  const handleStatusClick = async (item: TrackedActionItem) => {
    const newStatus = cycleNext(item.status);
    onActionItemsChange(prev => prev.map(i => i.id === item.id ? { ...i, status: newStatus } : i));
    setSavingId(item.id);
    try { await updateActionItem(item.id, { status: newStatus }); }
    catch { onActionItemsChange(prev => prev.map(i => i.id === item.id ? { ...i, status: item.status } : i)); }
    finally { setSavingId(null); }
  };

  const handleSaveEdit = async (id: string, updates: ActionItemUpdate) => {
    onActionItemsChange(prev => prev.map(i => i.id === id ? { ...i, ...updates, dueDate: updates.dueDate ?? i.dueDate } : i));
    setEditingId(null);
    await updateActionItem(id, updates);
  };

  const handleDelete = async (item: TrackedActionItem) => {
    onActionItemsChange(prev => prev.filter(i => i.id !== item.id));
    await deleteActionItem(item.id);
  };

  const handleCreate = async () => {
    if (!newText.trim()) { setComposing(false); return; }
    const text = newText.trim();
    setNewText('');
    setComposing(false);
    const created = await createActionItem(userId, text);
    if (created) onActionItemsChange(prev => [created, ...prev]);
  };

  // ─── Empty state ────────────────────────────────────────────────────────
  if (actionItems.length === 0 && !composing) {
    return (
      <div className="h-full flex flex-col bg-[var(--bg)]">
        <div className="px-6 md:px-10 pt-7 pb-5 flex items-center justify-between border-b border-[var(--border)]">
          <h1 className="font-display-tight text-[22px] font-semibold text-[var(--text)]">Actions</h1>
        </div>
        <div className="flex-1 flex items-center justify-center px-6">
          <EmptyState
            tone="amber"
            title="No action items yet"
            description="Action items from your recorded sessions will appear here automatically. Press ⌘N to add one manually."
            icon={
              <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
            }
            action={{ label: '+ New action', onClick: () => { setComposing(true); setTimeout(() => newRef.current?.focus(), 0); } }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-[var(--bg)]">

      {/* ─── Header ─────────────────────────────────────────────────── */}
      <div className="px-6 md:px-10 pt-6 pb-3 shrink-0 border-b border-[var(--border)]">
        <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
          <div className="flex items-baseline gap-3.5">
            <h1 className="font-display-tight text-[22px] font-semibold text-[var(--text)]">Actions</h1>
            <span className="px-2.5 py-0.5 rounded-full text-[11.5px] font-semibold font-mono"
                  style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
              {counts.all} open
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2.5 px-3.5 py-2 rounded-full text-[13px] min-w-[260px]"
                 style={{ background: 'var(--bg-sunken)', color: 'var(--text-muted)' }}>
              <span className="font-mono text-[10.5px] px-1.5 py-0.5 rounded"
                    style={{ background: 'var(--bg-elevated)' }}>⌘K</span>
              <input
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search or jump to…"
                className="bg-transparent outline-none flex-1 text-[13px]"
                style={{ color: 'var(--text)' }}
              />
            </div>
            <button
              onClick={() => { setComposing(true); setTimeout(() => newRef.current?.focus(), 0); }}
              className="px-4 py-2 rounded-full text-[13px] font-medium"
              style={{ background: 'var(--cta-bg)', color: 'var(--cta-fg)' }}
              title="New action (⌘N)">
              + New
            </button>
          </div>
        </div>

        {/* Pill tabs */}
        <div className="flex gap-1">
          {[
            { id: 'all'       as const, label: 'All',           count: counts.all },
            { id: 'mine'      as const, label: 'Mine',          count: counts.mine },
            { id: 'this_week' as const, label: 'Due this week', count: counts.this_week },
            { id: 'done'      as const, label: 'Done',          count: counts.done },
          ].map(t => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[13px] font-medium transition"
                style={active
                  ? { background: 'var(--accent)', color: 'var(--accent-fg)' }
                  : { background: 'transparent', color: 'var(--text-muted)' }}>
                {t.label}
                <span className="text-[11px] opacity-70">{t.count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── List ───────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-6 md:px-10 py-3">
        {composing && (
          <div className="grid items-center gap-3.5 px-3 py-3 mb-1 rounded-xl"
               style={{ background: 'var(--bg-sunken)', gridTemplateColumns: '22px 60px 1fr auto' }}>
            <span className="w-[18px] h-[18px] rounded-full border-[1.5px]"
                  style={{ borderColor: 'var(--border-strong)' }} />
            <span className="font-mono text-[11.5px]" style={{ color: 'var(--text-tertiary)' }}>A-NEW</span>
            <input
              ref={newRef}
              value={newText}
              onChange={e => setNewText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleCreate();
                if (e.key === 'Escape') { setComposing(false); setNewText(''); }
              }}
              onBlur={() => { if (!newText.trim()) setComposing(false); }}
              placeholder="What needs to happen?"
              className="bg-transparent outline-none text-[13.5px]"
              style={{ color: 'var(--text)' }}
            />
            <span className="text-[11px]" style={{ color: 'var(--text-tertiary)' }}>↵ to save · esc to cancel</span>
          </div>
        )}

        {filtered.length === 0 && !composing ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-16">
            <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>
              No items in this view.
            </p>
            <button
              onClick={() => { setTab('all'); setSearchQuery(''); }}
              className="mt-3 text-xs font-semibold"
              style={{ color: 'var(--accent)' }}>
              Show all open actions →
            </button>
          </div>
        ) : (
          <ul className="list-none p-0 m-0">
            {filtered.map(item => {
              const isEditing = editingId === item.id;
              const isCompleted = item.status === 'completed';
              const owner = item.assignee ?? '';
              const due = formatDue(item.dueDate);
              const dueClass = item.dueDate && dayDiff(item.dueDate) < 0 && !isCompleted
                ? { color: 'var(--accent-signal)', fontWeight: 500 } : undefined;

              return (
                <li key={item.id}
                    className="grid items-center gap-3.5 px-3 py-3 -mx-3 rounded-xl group/row hover:bg-[var(--bg-sunken)] transition"
                    style={{ gridTemplateColumns: '22px 60px 1fr 200px 32px 80px 28px' }}>
                  <StatusCircle status={item.status}
                    onClick={() => handleStatusClick(item)} busy={savingId === item.id} />

                  <span className="font-mono text-[11.5px]" style={{ color: 'var(--text-tertiary)' }}>
                    {formatActionId(item.displayId)}
                  </span>

                  <div className="min-w-0">
                    <div
                      onClick={() => !isEditing && setEditingId(item.id)}
                      className={`text-[13.5px] cursor-pointer truncate ${isCompleted ? 'line-through' : ''}`}
                      style={{ color: isCompleted ? 'var(--text-muted)' : 'var(--text)' }}>
                      {item.text}
                    </div>
                  </div>

                  <button
                    onClick={() => item.recordingId && onSelectSession(item.recordingId)}
                    disabled={!item.recordingId}
                    title={item.recordingId ? 'Open session' : 'Standalone'}
                    className="text-[12.5px] truncate text-left"
                    style={{ color: 'var(--text-tertiary)' }}>
                    {item.sessionTitle ?? 'Standalone'}
                  </button>

                  {owner ? (
                    <span
                      className="inline-flex items-center justify-center w-[26px] h-[26px] rounded-full text-[10.5px] font-bold text-white"
                      style={{ background: colorFor(owner) }}
                      title={owner}>
                      {initialsOf(owner)}
                    </span>
                  ) : (
                    <button
                      onClick={() => setEditingId(item.id)}
                      className="inline-flex items-center justify-center w-[26px] h-[26px] rounded-full font-mono text-[10.5px]"
                      style={{ background: 'var(--bg-sunken)', color: 'var(--text-muted)' }}
                      title="Add assignee">
                      —
                    </button>
                  )}

                  <span className="text-[12.5px] text-right" style={{ color: 'var(--text-muted)', ...dueClass }}>
                    {due || '—'}
                  </span>

                  <button
                    onClick={() => handleDelete(item)}
                    className="opacity-0 group-hover/row:opacity-100 p-1 rounded-md transition"
                    style={{ color: 'var(--text-muted)' }}
                    title="Delete">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>

                  {isEditing && (
                    <div className="col-span-7">
                      <EditForm
                        item={item}
                        allAssignees={allAssignees}
                        onSave={updates => handleSaveEdit(item.id, updates)}
                        onCancel={() => setEditingId(null)}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* ─── Footer keyboard hints ──────────────────────────────────── */}
      <div className="px-6 md:px-10 py-3.5 shrink-0 flex items-center gap-3 border-t border-[var(--border)]"
           style={{ fontSize: 12, color: 'var(--text-muted)' }}>
        <span>↑↓ navigate</span>
        <span style={{ color: 'var(--text-tertiary)' }}>·</span>
        <span>Click circle to toggle</span>
        <span style={{ color: 'var(--text-tertiary)' }}>·</span>
        <span>⌘N new action</span>
      </div>
    </div>
  );
};

export default ActionItemsView;
