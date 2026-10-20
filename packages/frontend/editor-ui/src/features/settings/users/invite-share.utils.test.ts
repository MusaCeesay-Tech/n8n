import {
	INVITE_SHARE_TARGETS,
	buildInviteShareUrl,
	type InviteShareChannel,
} from './invite-share.utils';

describe('INVITE_SHARE_TARGETS', () => {
	it('lists every channel once, in menu order', () => {
		expect(INVITE_SHARE_TARGETS.map((target) => target.channel)).toEqual([
			'whatsapp',
			'email',
			'linkedin',
			'telegram',
			'discord',
		]);
	});

	it('marks only Discord as needing a copy before opening', () => {
		const needsCopy = INVITE_SHARE_TARGETS.filter((target) => target.copyLinkBeforeOpen).map(
			(target) => target.channel,
		);
		expect(needsCopy).toEqual(['discord']);
	});

	it.each(INVITE_SHARE_TARGETS.map((target) => [target.channel, target.icon, target.labelKey]))(
		'provides an icon and label for %s',
		(_channel, icon, labelKey) => {
			expect(icon).toBeTruthy();
			expect(labelKey).toMatch(/^settings\.users\.inviteShare\./);
		},
	);
});

describe('buildInviteShareUrl', () => {
	const link = 'https://x.test/invite?a=b';
	const message = 'Join me';

	it.each<[InviteShareChannel, string]>([
		['whatsapp', 'https://wa.me/?text=Join%20me%20https%3A%2F%2Fx.test%2Finvite%3Fa%3Db'],
		['telegram', 'https://t.me/share/url?url=https%3A%2F%2Fx.test%2Finvite%3Fa%3Db&text=Join%20me'],
		[
			'linkedin',
			'https://www.linkedin.com/sharing/share-offsite/?url=https%3A%2F%2Fx.test%2Finvite%3Fa%3Db',
		],
		['email', 'mailto:?subject=Join%20me&body=Join%20me%20https%3A%2F%2Fx.test%2Finvite%3Fa%3Db'],
		['discord', 'https://discord.com/app'],
	])('builds the %s share URL', (channel, expected) => {
		expect(buildInviteShareUrl(channel, link, message)).toBe(expected);
	});
});
