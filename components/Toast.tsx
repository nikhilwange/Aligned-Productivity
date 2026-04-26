import React, { useEffect, useState } from 'react';

export interface ToastData {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
  actionLabel?: string;
  onAction?: () => void;
  duration?: number; // ms, default 5000
}

interface ToastProps {
  toast: ToastData;
  onDismiss: (id: string) => void;
}

const Toast: React.FC<ToastProps> = ({ toast, onDismiss }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    // Enter animation
    requestAnimationFrame(() => setIsVisible(true));

    // Auto-dismiss
    const timer = setTimeout(() => {
      setIsExiting(true);
      setTimeout(() => onDismiss(toast.id), 300);
    }, toast.duration || 5000);

    return () => clearTimeout(timer);
  }, [toast.id, toast.duration, onDismiss]);

  const dismiss = () => {
    setIsExiting(true);
    setTimeout(() => onDismiss(toast.id), 300);
  };

  // Token-driven colors so Toast looks correct in both dark and granola light.
  const accent = {
    success: 'var(--accent-success)',
    error:   'var(--accent-signal)',
    info:    'var(--accent)',
  }[toast.type];

  const iconClass = {
    success: 'text-success',
    error:   'text-signal',
    info:    'text-brand',
  }[toast.type];

  return (
    <div
      className={`w-full max-w-sm rounded-2xl overflow-hidden transition-all duration-300 ${
        isVisible && !isExiting
          ? 'opacity-100 translate-y-0 scale-100'
          : 'opacity-0 translate-y-3 scale-95'
      }`}
      style={{
        background: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-xl, 0 20px 25px -5px rgba(0,0,0,0.30))',
      }}
    >
      {/* Top accent bar */}
      <div className="h-0.5" style={{ background: accent }} />

      <div className="flex items-start gap-3 p-3.5">
        {/* Icon */}
        <div className={`shrink-0 mt-0.5 ${iconClass}`}>
          {toast.type === 'success' ? (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          ) : toast.type === 'error' ? (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-[var(--text-primary)] leading-snug">
            {toast.message}
          </p>
          {toast.actionLabel && toast.onAction && (
            <button
              onClick={() => { toast.onAction?.(); dismiss(); }}
              className="mt-1.5 text-xs font-bold text-brand hover:opacity-80 transition-opacity"
            >
              {toast.actionLabel} →
            </button>
          )}
        </div>

        {/* Dismiss */}
        <button
          onClick={dismiss}
          className="shrink-0 p-1 rounded-lg hover:bg-white/[0.06] transition-colors"
        >
          <svg className="w-4 h-4 text-[var(--text-secondary)] opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
};

/* ─── Toast Container ─── */
interface ToastContainerProps {
  toasts: ToastData[];
  onDismiss: (id: string) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-20 md:bottom-6 right-4 md:right-6 z-[90] flex flex-col gap-2 items-end pointer-events-none">
      {toasts.map(t => (
        <div key={t.id} className="pointer-events-auto">
          <Toast toast={t} onDismiss={onDismiss} />
        </div>
      ))}
    </div>
  );
};

export default Toast;
