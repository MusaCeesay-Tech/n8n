<script setup lang="ts">
import { useFavicon } from '@vueuse/core';
import { computed, onMounted, useCssModule } from 'vue';

import LogoImage from './gridwork-logo.png';

const props = defineProps<
	(
		| {
				size: 'large';
		  }
		| {
				size: 'small';
				collapsed: boolean;
		  }
	) & {
		releaseChannel?: 'stable' | 'beta' | 'nightly' | 'dev' | 'rc';
	}
>();

const { size, releaseChannel } = props;

const $style = useCssModule();
const containerClasses = computed(() => {
	if (size === 'large') {
		return [$style.logoContainer, $style.large];
	}
	return [
		$style.logoContainer,
		$style.sidebar,
		props.collapsed ? $style.sidebarCollapsed : $style.sidebarExpanded,
	];
});

onMounted(() => {
	// Reuse the brand image as the favicon for non-stable release channels.
	if (!releaseChannel || releaseChannel === 'stable') {
		return;
	}
	useFavicon(LogoImage);
});
</script>

<template>
	<div :class="containerClasses" data-test-id="n8n-logo">
		<img :src="LogoImage" :class="$style.logo" alt="Gridwork" />
		<slot />
	</div>
</template>

<style lang="scss" module>
.logoContainer {
	display: flex;
	justify-content: center;
	align-items: center;
}

.logo {
	display: block;
	height: 26px;
	width: auto;
	object-fit: contain;
}

.large {
	transform: scale(2);
	margin-bottom: var(--spacing--xl);

	.logo {
		transform: scale(1.3) translateY(-2px);
	}
}

.sidebarExpanded .logo {
	margin-left: var(--spacing--2xs);
}

.sidebarCollapsed .logo {
	width: 40px;
	height: 30px;
	padding: 0 var(--spacing--4xs);
}
</style>
