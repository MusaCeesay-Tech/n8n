<script lang="ts" setup>
import { computed } from 'vue';
import { N8nDropdownMenu, N8nIconButton, N8nTooltip, type DropdownMenuItemProps } from '@n8n/design-system';
import { useI18n } from '@n8n/i18n';
import { useClipboard } from '@n8n/composables/useClipboard';
import { useToast } from '@n8n/composables/useToast';
import {
	INVITE_SHARE_TARGETS,
	buildInviteShareUrl,
	type InviteShareChannel,
} from '../invite-share.utils';

const props = defineProps<{
	/** Full invite URL. The component never mutates it. */
	link: string;
	dataTestId?: string;
}>();

const i18n = useI18n();
const clipboard = useClipboard();
const { showMessage, showError } = useToast();

const items = computed<Array<DropdownMenuItemProps<InviteShareChannel>>>(() =>
	INVITE_SHARE_TARGETS.map((target) => ({
		id: target.channel,
		label: i18n.baseText(target.labelKey),
		icon: { type: 'icon', value: target.icon },
	})),
);

async function onSelect(channel: InviteShareChannel) {
	const target = INVITE_SHARE_TARGETS.find((candidate) => candidate.channel === channel);
	if (!target) return;

	try {
		if (target.copyLinkBeforeOpen) {
			await clipboard.copy(props.link);
			showMessage({
				type: 'success',
				title: i18n.baseText('settings.users.inviteShare.discordCopied'),
			});
		}

		const message = i18n.baseText('settings.users.inviteShare.message');
		window.open(buildInviteShareUrl(channel, props.link, message), '_blank', 'noopener,noreferrer');
	} catch (error) {
		showError(error, i18n.baseText('settings.users.inviteLinkError'));
	}
}
</script>

<template>
	<N8nTooltip placement="top" :content="i18n.baseText('settings.users.inviteShare.tooltip')">
		<N8nDropdownMenu
			:items="items"
			placement="bottom-end"
			:data-test-id="dataTestId"
			@select="onSelect"
		>
			<template #trigger>
				<N8nIconButton
					variant="subtle"
					icon="share"
					:aria-label="i18n.baseText('settings.users.inviteShare.tooltip')"
					data-test-id="share-invite-link-button"
				/>
			</template>
		</N8nDropdownMenu>
	</N8nTooltip>
</template>
