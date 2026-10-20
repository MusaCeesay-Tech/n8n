import type { IconName } from '@n8n/design-system';
import type { BaseTextKey } from '@n8n/i18n';

/** Messenger or social channel an invite link can be shared to. */
export type InviteShareChannel = 'whatsapp' | 'email' | 'linkedin' | 'telegram' | 'discord';

export interface InviteShareTarget {
	channel: InviteShareChannel;
	icon: IconName;
	labelKey: BaseTextKey;
	/**
	 * True when the channel has no share-intent URL. The caller copies the link
	 * first, then opens the app so the user can paste it.
	 */
	copyLinkBeforeOpen?: boolean;
}

/** Share channels in menu order. */
export const INVITE_SHARE_TARGETS: readonly InviteShareTarget[] = [
	{ channel: 'whatsapp', icon: 'whatsapp', labelKey: 'settings.users.inviteShare.whatsapp' },
	{ channel: 'email', icon: 'mail', labelKey: 'settings.users.inviteShare.email' },
	{ channel: 'linkedin', icon: 'linkedin', labelKey: 'settings.users.inviteShare.linkedin' },
	{ channel: 'telegram', icon: 'telegram', labelKey: 'settings.users.inviteShare.telegram' },
	{
		channel: 'discord',
		icon: 'discord',
		labelKey: 'settings.users.inviteShare.discord',
		copyLinkBeforeOpen: true,
	},
];

/**
 * Builds the URL that opens a channel's native share or compose flow for an
 * invite link. Discord returns its web app because it has no share-intent URL.
 */
export function buildInviteShareUrl(
	channel: InviteShareChannel,
	link: string,
	message: string,
): string {
	const text = `${message} ${link}`;

	switch (channel) {
		case 'whatsapp':
			return `https://wa.me/?text=${encodeURIComponent(text)}`;
		case 'telegram':
			return `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(message)}`;
		case 'linkedin':
			return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(link)}`;
		case 'email':
			return `mailto:?subject=${encodeURIComponent(message)}&body=${encodeURIComponent(text)}`;
		case 'discord':
			return 'https://discord.com/app';
	}
}
