import type { SubscriptionState } from '../types';

export type PaywallReason = 'usage_cap' | 'inactive_sub';

export interface PaywallDecision {
  allowed: boolean;
  reason?: PaywallReason;
  message?: string;
}

// Pure function — easier to test and reason about than a hook. Caller passes
// the SubscriptionState from useSubscription. The single chokepoint we gate
// on is "can the user start a new recording right now".
export function canStartNewRecording(state: SubscriptionState): PaywallDecision {
  if (state.loading) {
    // Don't block on first paint; subscription state should resolve quickly.
    // If usePaywall is asked while loading, fail open — better than blocking
    // a legit user behind a network blip.
    return { allowed: true };
  }
  if (state.isPro) return { allowed: true };
  if (state.isOverCap) {
    const overMeetings = state.caps && state.usage.meetings >= state.caps.meetings;
    const overMinutes = state.caps && state.usage.minutes >= state.caps.minutes;
    let detail = '';
    if (overMeetings && overMinutes) {
      detail = `You've used all ${state.caps?.meetings} meetings and ${state.caps?.minutes} minutes this month.`;
    } else if (overMeetings) {
      detail = `You've used all ${state.caps?.meetings} meetings this month.`;
    } else if (overMinutes) {
      detail = `You've used all ${state.caps?.minutes} minutes this month.`;
    }
    return {
      allowed: false,
      reason: 'usage_cap',
      message: `${detail} Upgrade to Pro for unlimited recordings.`,
    };
  }
  return { allowed: true };
}
