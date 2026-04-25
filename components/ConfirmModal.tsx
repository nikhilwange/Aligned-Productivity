import React, { useEffect } from 'react';

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'destructive';
  onConfirm: () => void;
  onCancel?: () => void;
}

interface ConfirmModalProps {
  request: ConfirmRequest;
  onClose: () => void;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({ request, onClose }) => {
  const {
    title,
    message,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    variant = 'default',
    onConfirm,
    onCancel,
  } = request;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCancel = () => {
    onCancel?.();
    onClose();
  };

  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  const isDestructive = variant === 'destructive';
  const confirmClasses = isDestructive
    ? 'bg-red-500 hover:bg-red-400 text-white'
    : 'bg-amber-500 hover:bg-amber-400 text-black';
  const accentTint = isDestructive ? 'bg-red-500/15' : 'bg-amber-500/15';
  const iconColor = isDestructive ? 'text-red-400' : 'text-amber-400';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <button
        aria-label="Close"
        onClick={handleCancel}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm cursor-default"
      />

      <div className="relative w-full max-w-sm rounded-2xl bg-[var(--surface-900)] border border-white/[0.08] shadow-2xl overflow-hidden animate-fade-in">
        <div className={`absolute top-0 left-0 right-0 h-0.5 ${isDestructive ? 'bg-red-500' : 'bg-amber-500'}`} />

        <div className="p-6">
          <div className={`w-12 h-12 mx-auto mb-5 rounded-2xl ${accentTint} border border-white/[0.08] flex items-center justify-center`}>
            {isDestructive ? (
              <svg className={`w-6 h-6 ${iconColor}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M8 7V4a1 1 0 011-1h6a1 1 0 011 1v3" />
              </svg>
            ) : (
              <svg className={`w-6 h-6 ${iconColor}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093M12 17h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            )}
          </div>

          <h3 className="font-display-tight text-xl font-semibold text-[var(--text-primary)] text-center mb-2">
            {title}
          </h3>
          <p className="text-sm text-[var(--text-secondary)] text-center mb-6 leading-relaxed">
            {message}
          </p>

          <div className="flex gap-3">
            <button
              onClick={handleCancel}
              className="flex-1 px-4 py-3 rounded-xl bg-white/[0.06] hover:bg-white/[0.10] border border-white/[0.08] text-sm font-semibold text-[var(--text-secondary)] transition-all active:scale-95"
            >
              {cancelLabel}
            </button>
            <button
              onClick={handleConfirm}
              autoFocus
              className={`flex-1 px-4 py-3 rounded-xl text-sm font-bold transition-all active:scale-95 shadow-lg ${confirmClasses}`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
