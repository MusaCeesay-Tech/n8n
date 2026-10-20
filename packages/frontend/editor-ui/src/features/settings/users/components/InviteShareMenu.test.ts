import { cleanup, render, screen } from '@testing-library/vue';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import InviteShareMenu from './InviteShareMenu.vue';

const { clipboardCopy, showError, showMessage } = vi.hoisted(() => ({
	clipboardCopy: vi.fn(),
	showError: vi.fn(),
	showMessage: vi.fn(),
}));

vi.mock('@n8n/composables/useClipboard', () => ({
	useClipboard: vi.fn(() => ({ copy: clipboardCopy })),
}));

vi.mock('@n8n/composables/useToast', () => ({
	useToast: vi.fn(() => ({ showMessage, showError })),
}));

vi.mock('@n8n/i18n', () => ({
	useI18n: vi.fn(() => ({
		baseText: vi.fn((key: string) => key),
	})),
}));

const link = 'https://x.test/invite?a=b';
const triggerName = 'settings.users.inviteShare.tooltip';

function label(channel: string) {
	return `settings.users.inviteShare.${channel}`;
}

async function openMenu() {
	const user = userEvent.setup();
	render(InviteShareMenu, { props: { link } });
	await user.click(screen.getByRole('button', { name: triggerName }));
	return user;
}

describe('InviteShareMenu', () => {
	let open: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.clearAllMocks();
		clipboardCopy.mockReset().mockResolvedValue(undefined);
		open = vi.spyOn(window, 'open').mockImplementation(() => null);
	});

	afterEach(() => {
		open.mockRestore();
		cleanup();
	});

	it('renders an item for every share channel', async () => {
		await openMenu();

		for (const channel of ['whatsapp', 'email', 'linkedin', 'telegram', 'discord']) {
			expect(await screen.findByRole('menuitem', { name: label(channel) })).toBeVisible();
		}
	});

	it.each([
		['whatsapp', 'https://wa.me/?text='],
		['telegram', 'https://t.me/share/url?'],
		['linkedin', 'https://www.linkedin.com/sharing/share-offsite/?url='],
		['email', 'mailto:?'],
	])('opens the %s share URL without copying', async (channel, expectedPrefix) => {
		const user = await openMenu();

		await user.click(screen.getByRole('menuitem', { name: label(channel) }));

		expect(open).toHaveBeenCalledTimes(1);
		expect(String(open.mock.calls[0][0]).startsWith(expectedPrefix)).toBe(true);
		expect(clipboardCopy).not.toHaveBeenCalled();
	});

	it('copies the link, shows a toast, then opens Discord', async () => {
		const user = await openMenu();

		await user.click(screen.getByRole('menuitem', { name: label('discord') }));

		expect(clipboardCopy).toHaveBeenCalledWith(link);
		expect(showMessage).toHaveBeenCalledWith({
			type: 'success',
			title: 'settings.users.inviteShare.discordCopied',
		});
		expect(open).toHaveBeenCalledWith('https://discord.com/app', '_blank', 'noopener,noreferrer');
	});

	it('reports a clipboard failure and does not open Discord', async () => {
		const error = new Error('Clipboard unavailable');
		clipboardCopy.mockRejectedValueOnce(error);
		const user = await openMenu();

		await user.click(screen.getByRole('menuitem', { name: label('discord') }));

		expect(showError).toHaveBeenCalledWith(error, 'settings.users.inviteLinkError');
		expect(open).not.toHaveBeenCalled();
	});
});
