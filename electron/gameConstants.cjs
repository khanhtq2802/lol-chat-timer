// Champion ultimate and summoner spell cooldowns from Riot's Data Dragon, for the latest patch.
// Data Dragon still uses the old version numbers (16.19 is patch 26.19 in the client).
// @see https://developer.riotgames.com/docs/lol#data-dragon
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const DDRAGON = 'https://ddragon.leagueoflegends.com';
const CACHE_PREFIX = 'ddragon-';
// bump when the shape of the data changes, older caches are then ignored
const SCHEMA = 5;
const COSMIC_INSIGHT_ID = 8347;
const INSPIRATION_TREE_ID = 8300;
// Runes that change the cooldowns (see src/lib/runes.ts). The game only tells the keystone and the
// rune trees of the enemies, the overlay guesses these from the rune pages played on OP.GG.
const HASTE_RUNE_IDS = [COSMIC_INSIGHT_ID, 8210, 8106, 8316, 9105, 8313];
// "Ability Haste" stat shard, not part of the Data Dragon runes
const HASTE_SHARD = {
	id: 5007,
	name: 'Ability Haste shard',
	icon: 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/perk-images/statmods/statmodscdrscalingicon.png'
};
// Most played skill order and rune pages of each champion. Riot does not publish them, this is the
// API of the OP.GG website (not an official one, so the app works without it).
const OPGG = 'https://lol-api-champion.op.gg/api/global/champions/ranked';
const OPGG_PARALLEL = 8;

const cacheDir = () => app.getPath('userData');
const cacheFile = (version) => path.join(cacheDir(), `${CACHE_PREFIX}${version}.json`);

async function fetchJson(url) {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`${res.status} ${url}`);
	return res.json();
}

// Share of the players of a rune page (same keystone and trees) taking each haste rune
function toRunePage(page) {
	const builds = page.builds ?? [];
	const total = builds.reduce((sum, b) => sum + b.play, 0);
	const rates = {};
	for (const id of [...HASTE_RUNE_IDS, HASTE_SHARD.id]) {
		const play = builds
			.filter((b) =>
				[...b.primary_rune_ids, ...b.secondary_rune_ids, ...b.stat_mod_ids].includes(id)
			)
			.reduce((sum, b) => sum + b.play, 0);
		if (play > 0) rates[id] = Math.round((play / total) * 100) / 100;
	}
	return {
		keystone: page.id,
		primary: page.primary_page_id,
		secondary: page.secondary_page_id,
		play: page.play,
		rates
	};
}

/**
 * Builds by champion key, for the most played position of the champion, e.g.
 * { 103: { skillOrder: "WQEQQRQWQWRWWEE", runePages: [...] } } (the skill taken at each level, and
 * the most played rune pages). Empty when OP.GG can't be reached.
 */
async function downloadBuilds() {
	const orders = {};
	try {
		const { data } = await fetchJson(OPGG);
		const queue = data
			.filter((c) => c.positions?.length > 0)
			.map((c) => ({ key: c.id, position: c.positions[0].name.toLowerCase() }));
		const worker = async () => {
			for (let c = queue.pop(); c; c = queue.pop()) {
				try {
					const build = await fetchJson(`${OPGG}/${c.key}/${c.position}`);
					const order = build.data?.skills?.[0]?.order;
					const valid = Array.isArray(order) && order.every((s) => /^[QWER]$/.test(s));
					orders[c.key] = {
						skillOrder: valid ? order.join('') : undefined,
						runePages: (build.data?.rune_pages ?? []).map(toRunePage)
					};
				} catch {
					// this champion falls back to the default order, and its runes are not guessed
				}
			}
		};
		await Promise.all(Array.from({ length: OPGG_PARALLEL }, worker));
	} catch (e) {
		console.warn('[game constants] no builds:', e.message);
	}
	return orders;
}

async function download(version) {
	const [championFull, summoner, items, runeTrees, builds] = await Promise.all([
		fetchJson(`${DDRAGON}/cdn/${version}/data/en_US/championFull.json`),
		fetchJson(`${DDRAGON}/cdn/${version}/data/en_US/summoner.json`),
		fetchJson(`${DDRAGON}/cdn/${version}/data/en_US/item.json`),
		fetchJson(`${DDRAGON}/cdn/${version}/data/en_US/runesReforged.json`),
		downloadBuilds()
	]);
	const img = (group, file) => `${DDRAGON}/cdn/${version}/img/${group}/${file}`;

	const champions = {};
	for (const c of Object.values(championFull.data)) {
		// cooldown at each rank of the spell
		const spell = (s) => ({
			name: s.name,
			icon: img('spell', s.image.full),
			cooldowns: s.cooldown
		});
		const [q, w, e, r] = c.spells.map(spell);
		champions[c.id.toLowerCase()] = {
			key: Number(c.key),
			name: c.name,
			icon: img('champion', c.image.full),
			q,
			w,
			e,
			r,
			skillOrder: builds[c.key]?.skillOrder,
			runePages: builds[c.key]?.runePages
		};
	}

	const summonerSpells = {};
	for (const s of Object.values(summoner.data)) {
		summonerSpells[s.id] = {
			key: Number(s.key),
			name: s.name,
			icon: img('spell', s.image.full),
			cooldown: s.cooldown[0]
		};
	}

	// e.g. Ionian Boots of Lucidity: "... Gain 10 Summoner Spell Haste."
	const summonerHaste = (html) => {
		const match = html.replace(/<[^>]+>/g, ' ').match(/(\d+)\s+Summoner Spell Haste/i);
		return match ? Number(match[1]) : 0;
	};
	const summonerHasteItems = {};
	for (const [id, item] of Object.entries(items.data)) {
		const haste = summonerHaste(item.description);
		if (haste) summonerHasteItems[id] = { name: item.name, haste };
	}

	// ability haste: the item stats ("15 Ability Haste") plus the passives for one kind of ability,
	// Malignance "Gain 20 Ultimate Ability Haste" or Spear of Shojin "Gain 25 Basic Ability Haste".
	// Conditional passives (Imperial Mandate, Staff of Flowing Water) are left out.
	const abilityHaste = (html, kind) => {
		const text = (s) => s.replace(/<[^>]+>/g, ' ');
		const stats = text(html.match(/<stats>([\s\S]*?)<\/stats>/)?.[1] ?? '');
		const ability = stats.match(/(\d+)\s+Ability Haste/i);
		const extra = text(html).match(new RegExp(`(\\d+)\\s+${kind} Ability Haste`, 'i'));
		return (ability ? Number(ability[1]) : 0) + (extra ? Number(extra[1]) : 0);
	};
	const ultimateHasteItems = {};
	const basicHasteItems = {};
	for (const [id, item] of Object.entries(items.data)) {
		const ultimate = abilityHaste(item.description, 'Ultimate');
		if (ultimate) ultimateHasteItems[id] = { name: item.name, haste: ultimate };
		const basic = abilityHaste(item.description, 'Basic');
		if (basic) basicHasteItems[id] = { name: item.name, haste: basic };
	}
	// names of the stats each item gives ("Ability Power", "Move Speed"...), Jack of All Trades
	// counts the different ones
	const itemStats = {};
	for (const [id, item] of Object.entries(items.data)) {
		const stats = (item.description.match(/<stats>([\s\S]*?)<\/stats>/)?.[1] ?? '')
			.split(/<br\s*\/?>/)
			.map((line) =>
				line
					.replace(/<[^>]+>/g, ' ')
					.replace(/^[\s\d.%+]+/, '')
					.trim()
			)
			.filter(Boolean);
		if (stats.length > 0) itemStats[id] = [...new Set(stats)];
	}

	const hasteRunes = {
		[HASTE_SHARD.id]: { name: HASTE_SHARD.name, icon: HASTE_SHARD.icon, treeId: 0 }
	};
	for (const tree of runeTrees) {
		for (const rune of tree.slots.flatMap((slot) => slot.runes)) {
			if (!HASTE_RUNE_IDS.includes(rune.id)) continue;
			hasteRunes[rune.id] = {
				name: rune.name,
				icon: `${DDRAGON}/cdn/img/${rune.icon}`,
				treeId: tree.id
			};
		}
	}
	const cosmicInsight = runeTrees
		.flatMap((tree) => tree.slots.flatMap((slot) => slot.runes))
		.find((rune) => rune.id === COSMIC_INSIGHT_ID);

	return {
		schema: SCHEMA,
		version,
		champions,
		summonerSpells,
		summonerHasteItems,
		ultimateHasteItems,
		basicHasteItems,
		itemStats,
		hasteRunes,
		cosmicInsight: {
			name: cosmicInsight?.name ?? 'Cosmic Insight',
			treeId: INSPIRATION_TREE_ID,
			haste: cosmicInsight ? summonerHaste(cosmicInsight.longDesc) : 18
		}
	};
}

function readCache(version) {
	try {
		const data = JSON.parse(fs.readFileSync(cacheFile(version), 'utf8'));
		return data.schema === SCHEMA ? data : null;
	} catch {
		return null;
	}
}

function newestCachedVersion() {
	try {
		return fs
			.readdirSync(cacheDir())
			.filter((f) => f.startsWith(CACHE_PREFIX) && f.endsWith('.json'))
			.map((f) => f.slice(CACHE_PREFIX.length, -'.json'.length))
			.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
			.pop();
	} catch {
		return undefined;
	}
}

function writeCache(data) {
	fs.mkdirSync(cacheDir(), { recursive: true });
	for (const f of fs.readdirSync(cacheDir())) {
		if (f.startsWith(CACHE_PREFIX)) fs.rmSync(path.join(cacheDir(), f));
	}
	fs.writeFileSync(cacheFile(data.version), JSON.stringify(data));
}

/**
 * Returns the game constants of the latest patch, downloading them when the patch changed.
 * Falls back to the newest cache when offline, or null when there is nothing cached.
 */
async function loadGameConstants() {
	try {
		const [latest] = await fetchJson(`${DDRAGON}/api/versions.json`);
		const cached = readCache(latest);
		if (cached) return cached;

		const data = await download(latest);
		// without the skill orders, try again the next time the app starts
		if (Object.values(data.champions).some((c) => c.skillOrder)) writeCache(data);
		console.log(`[game constants] updated to ${latest}`);
		return data;
	} catch (e) {
		console.warn('[game constants] update failed, using cache:', e.message);
		const version = newestCachedVersion();
		return version ? readCache(version) : null;
	}
}

module.exports = { loadGameConstants, download, fetchJson, DDRAGON };
