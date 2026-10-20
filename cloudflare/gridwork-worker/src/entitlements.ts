// What each Gridwork tier unlocks. The app and the Worker both read this, so
// the numbers live in one place. `null` means "no limit".

import type { Tier } from './config';

export interface Entitlements {
	monthlyCredits: number;
	maxAgents: number | null;
	tasksPerMonth: number | null;
	realtime: boolean;
	pollingMinutes: number;
	canInviteMembers: boolean;
	priorityQueue: boolean;
	topups: boolean;
}

export const ENTITLEMENTS: Record<Tier, Entitlements> = {
	basic: {
		monthlyCredits: 1000,
		maxAgents: 3,
		tasksPerMonth: 250,
		realtime: false,
		pollingMinutes: 15,
		canInviteMembers: false,
		priorityQueue: false,
		topups: true,
	},
	standard: {
		monthlyCredits: 100000,
		maxAgents: null,
		tasksPerMonth: null,
		realtime: true,
		pollingMinutes: 1,
		canInviteMembers: true,
		priorityQueue: false,
		topups: true,
	},
	premium: {
		monthlyCredits: 500000,
		maxAgents: null,
		tasksPerMonth: null,
		realtime: true,
		pollingMinutes: 1,
		canInviteMembers: true,
		priorityQueue: true,
		topups: true,
	},
};

export function entitlementsForTier(tier: Tier): Entitlements {
	return ENTITLEMENTS[tier] ?? ENTITLEMENTS.basic;
}
