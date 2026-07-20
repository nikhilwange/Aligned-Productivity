import React from 'react';
import PricingView from './PricingView';
import type { PlanTier, User } from '../types';

interface UpgradeModalProps {
  user: User;
  reason?: string;
  // Which paid tiers to offer. Free hitting the cap → [pro, max]; a Pro user
  // hitting the soft cap → [max]. Undefined shows all paid tiers.
  offerTiers?: PlanTier[];
  open: boolean;
  onClose: () => void;
  onSubscribed?: () => void;
}

// Slim wrapper around PricingView for the blocking in-app upgrade flow.
// Reason copy explains *why* the modal opened (usually cap-hit context).
const UpgradeModal: React.FC<UpgradeModalProps> = ({ user, reason, offerTiers, open, onClose, onSubscribed }) => {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl rounded-2xl bg-[var(--surface-950)] border border-white/[0.08] shadow-2xl overflow-hidden max-h-[92vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {reason && (
          <div className="px-6 md:px-8 pt-6 pb-0">
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-200">
              {reason}
            </div>
          </div>
        )}
        <PricingView
          user={user}
          variant="modal"
          onlyTiers={offerTiers}
          onClose={onClose}
          onSubscribed={onSubscribed}
        />
      </div>
    </div>
  );
};

export default UpgradeModal;
