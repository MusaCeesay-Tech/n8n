// Gridwork Discord provisioning.
//
// Creates the Gridwork community server, membership roles, and channels with the
// Discord API. Run it again to add anything that is missing; it never deletes.
//
// The bot must be in fewer than 10 servers, because Discord only lets a bot
// create a server while it is under that limit.
//
// Credentials come from the environment, never from the command line:
//   DISCORD_BOT_TOKEN   the bot token (Developer Portal > Bot > Reset Token)
//
// Optional:
//   GRIDWORK_DISCORD_GUILD_NAME   server name (default: Gridwork)
//   GRIDWORK_DISCORD_ICON         path to a PNG for the server icon
//   GRIDWORK_DISCORD_OWNER_ID     your Discord user id. Assigns server ownership
//                                 to you instead of leaving it with the bot.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = 'https://discord.com/api/v10';
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_NAME = process.env.GRIDWORK_DISCORD_GUILD_NAME ?? 'Gridwork';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_FILE = path.join(__dirname, 'discord-ids.json');

if (!TOKEN) {
	console.error('Missing DISCORD_BOT_TOKEN. Pass it as an environment variable.');
	process.exit(1);
}

const headers = {
	Authorization: `Bot ${TOKEN}`,
	'Content-Type': 'application/json',
};

async function api(method, route, body) {
	const res = await fetch(API + route, {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await res.text();
	let data = null;
	if (text) {
		try {
			data = JSON.parse(text);
		} catch {
			data = text;
		}
	}
	if (!res.ok) {
		const error = new Error(`${method} ${route} -> ${res.status}: ${text}`);
		error.status = res.status;
		throw error;
	}
	return data;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Permission bits we use.
const VIEW_CHANNEL = 1n << 10n; // 1024
const SEND_MESSAGES = 1n << 11n; // 2048
const READ_MESSAGE_HISTORY = 1n << 16n; // 65536
const ADMINISTRATOR = 1n << 3n; // 8

const memberPerms = (VIEW_CHANNEL | SEND_MESSAGES | READ_MESSAGE_HISTORY).toString();

const ROLES = [
	{ name: 'Admin', color: 0xe94ba0, hoist: false, mentionable: true, permissions: ADMINISTRATOR.toString() },
	{ name: 'Moderator', color: 0x3498db, hoist: true, mentionable: true, permissions: memberPerms },
	{ name: 'Premium', color: 0xe94ba0, hoist: true, mentionable: true, permissions: memberPerms },
	{ name: 'Standard', color: 0x9b59b6, hoist: true, mentionable: true, permissions: memberPerms },
	{ name: 'Basic', color: 0x95a5a6, hoist: true, mentionable: true, permissions: memberPerms },
];

// Channel types: 0 text, 2 voice, 4 category, 5 announcement.
const CATEGORIES = [
	{
		name: 'START HERE',
		channels: [
			{ name: 'welcome', readonly: true },
			{ name: 'announcements', type: 0, readonly: true },
			{ name: 'rules', readonly: true },
		],
	},
	{
		name: 'COMMUNITY',
		channels: [{ name: 'general' }, { name: 'introductions' }, { name: 'showcase' }],
	},
	{
		name: 'HELP',
		channels: [
			{ name: 'help-basic' },
			{ name: 'help-priority', premiumOnly: true },
			{ name: 'help-dedicated', premiumOnly: true },
		],
	},
	{
		name: 'PRODUCT',
		channels: [
			{ name: 'releases', type: 0, readonly: true },
			{ name: 'feature-requests' },
			{ name: 'bug-reports' },
		],
	},
	{
		name: 'VOICE',
		channels: [{ name: 'General', type: 2 }],
	},
];

function iconDataUri(filePath) {
	if (!filePath || !fs.existsSync(filePath)) {
		return undefined;
	}
	const buf = fs.readFileSync(filePath);
	return `data:image/png;base64,${buf.toString('base64')}`;
}

async function findOrCreateGuild(botId) {
	const guilds = await api('GET', '/users/@me/guilds');
	const existing = guilds.find((g) => g.name === GUILD_NAME && g.owner) ?? guilds.find((g) => g.name === GUILD_NAME);
	if (existing) {
		console.log(`Using existing server "${existing.name}" (${existing.id})`);
		return existing.id;
	}

	const icon = iconDataUri(process.env.GRIDWORK_DISCORD_ICON);
	const ownerId = process.env.GRIDWORK_DISCORD_OWNER_ID;
	console.log(`Creating server "${GUILD_NAME}"${ownerId ? ` owned by ${ownerId}` : ''}...`);
	try {
		const created = await api('POST', '/guilds', {
			name: GUILD_NAME,
			icon,
			owner_id: ownerId,
			verification_level: 1,
			default_message_notifications: 0,
			explicit_content_filter: 0,
		});
		console.log(`Created server ${created.id} (owner: bot ${botId})`);
		await sleep(3000);
		return created.id;
	} catch (error) {
		if (error.status === 403 || /Bots cannot use this endpoint/i.test(error.message)) {
			throw new Error(
				'Discord no longer lets a bot create a server. Create an empty server yourself, then invite the bot:\n' +
					`  1. In Discord: + > Create My Own > For me and my friends > name it "${GUILD_NAME}".\n` +
					`  2. Invite the bot: https://discord.com/oauth2/authorize?client_id=${botId}&scope=bot%20applications.commands&permissions=8\n` +
					`  3. Re-run this script. It will find and populate "${GUILD_NAME}".`,
			);
		}
		throw error;
	}
}

async function ensureRoles(guildId) {
	const existing = await api('GET', `/guilds/${guildId}/roles`);
	const byName = new Map(existing.map((r) => [r.name, r]));
	const result = {};
	for (const role of ROLES) {
		if (byName.has(role.name)) {
			result[role.name] = byName.get(role.name).id;
			console.log(`Role exists: @${role.name}`);
			continue;
		}
		const created = await api('POST', `/guilds/${guildId}/roles`, role);
		result[role.name] = created.id;
		console.log(`Created role: @${role.name} (${created.id})`);
	}
	return result;
}

function overwritesFor(guildId, channel, roleIds) {
	const overwrites = [];
	if (channel.readonly) {
		overwrites.push({ id: guildId, type: 0, allow: '0', deny: SEND_MESSAGES.toString() });
	}
	if (channel.premiumOnly) {
		overwrites.push({ id: guildId, type: 0, allow: '0', deny: VIEW_CHANNEL.toString() });
		overwrites.push({
			id: roleIds.Premium,
			type: 0,
			allow: (VIEW_CHANNEL | SEND_MESSAGES | READ_MESSAGE_HISTORY).toString(),
			deny: '0',
		});
	}
	return overwrites;
}

async function ensureChannels(guildId, roleIds) {
	const existing = await api('GET', `/guilds/${guildId}/channels`);
	const byName = new Map(existing.map((c) => [c.name, c]));
	const ids = { categories: {}, channels: {}, firstTextChannelId: null };

	for (const category of CATEGORIES) {
		let parent = byName.get(category.name);
		if (!parent) {
			parent = await api('POST', `/guilds/${guildId}/channels`, {
				name: category.name,
				type: 4,
			});
			console.log(`Created category: ${category.name}`);
		}
		ids.categories[category.name] = parent.id;

		for (const channel of category.channels) {
			let ch = byName.get(channel.name);
			if (!ch) {
				ch = await api('POST', `/guilds/${guildId}/channels`, {
					name: channel.name,
					type: channel.type ?? 0,
					parent_id: parent.id,
					permission_overwrites: overwritesFor(guildId, channel, roleIds),
				});
				console.log(`Created channel: #${channel.name}`);
			}
			ids.channels[channel.name] = ch.id;
			if (ids.firstTextChannelId === null && (channel.type ?? 0) === 0) {
				ids.firstTextChannelId = ch.id;
			}
		}
	}
	return ids;
}

async function ensureInvite(guildId, channelId) {
	if (!channelId) {
		return null;
	}
	const invites = await api('GET', `/channels/${channelId}/invites`).catch(() => []);
	if (invites.length > 0) {
		return `https://discord.gg/${invites[0].code}`;
	}
	const invite = await api('POST', `/channels/${channelId}/invites`, {
		max_age: 0,
		max_uses: 0,
		unique: true,
	});
	return `https://discord.gg/${invite.code}`;
}

async function applyBranding(guildId) {
	const icon = iconDataUri(process.env.GRIDWORK_DISCORD_ICON);
	if (!icon) {
		return;
	}
	await api('PATCH', `/guilds/${guildId}`, { icon });
	console.log('Set server icon');
}

async function main() {
	const bot = await api('GET', '/users/@me');
	console.log(`Bot: ${bot.username}#${bot.discriminator} (${bot.id})`);

	const guildId = await findOrCreateGuild(bot.id);
	await applyBranding(guildId);
	const roleIds = await ensureRoles(guildId);
	const channelIds = await ensureChannels(guildId, roleIds);
	const invite = await ensureInvite(guildId, channelIds.firstTextChannelId);

	const result = {
		guildId,
		guildName: GUILD_NAME,
		invite,
		roles: roleIds,
		categories: channelIds.categories,
		channels: channelIds.channels,
		generatedAt: new Date().toISOString(),
	};
	fs.writeFileSync(OUT_FILE, JSON.stringify(result, null, 2));
	console.log('\nProvisioning complete.');
	console.log(JSON.stringify(result, null, 2));
	console.log(`\nWrote ${OUT_FILE}`);
}

main().catch((error) => {
	console.error('\nProvisioning failed:', error.message);
	process.exit(1);
});
