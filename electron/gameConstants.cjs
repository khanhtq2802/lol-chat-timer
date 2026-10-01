// Champion ultimate and summoner spell cooldowns from Riot's Data Dragon, for the latest patch.
// Data Dragon still uses the old version numbers (16.19 is patch 26.19 in the client).
// @see https://developer.riotgames.com/docs/lol#data-dragon
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const DDRAGON = 'https://ddragon.leagueoflegends.com';
const CACHE_PREFIX = 'ddragon-';
// bump when the shape of the data changes, older caches are then ignored
const SCHEMA = 3;
const COSMIC_INSIGHT_ID = 8347;
const INSPIRATION_TREE_ID = 8300;

const cacheDir = () => app.getPath('userData');
const cacheFile = (version) => path.join(cacheDir(), `${CACHE_PREFIX}${version}.json`);

async function fetchJson(url) {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`${res.status} ${url}`);
	return res.json();
}

async function download(version) {
	const [championFull, summoner, items, runeTrees] = await Promise.all([
		fetchJson(`${DDRAGON}/cdn/${version}/data/en_US/championFull.json`),
		fetchJson(`${DDRAGON}/cdn/${version}/data/en_US/summoner.json`),
		fetchJson(`${DDRAGON}/cdn/${version}/data/en_US/item.json`),
		fetchJson(`${DDRAGON}/cdn/${version}/data/en_US/runesReforged.json`)
	]);
	const img = (group, file) => `${DDRAGON}/cdn/${version}/img/${group}/${file}`;

	const champions = {};
	for (const c of Object.values(championFull.data)) {
		const r = c.spells[3];
		champions[c.id.toLowerCase()] = {
			key: Number(c.key),
			name: c.name,
			icon: img('champion', c.image.full),
			r: { name: r.name, icon: img('spell', r.image.full), cooldowns: r.cooldown }
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

	// haste that shortens the ultimate: the item stats ("15 Ability Haste", not "Basic Ability Haste")
	// and passives like Malignance "Gain 20 Ultimate Ability Haste". Conditional passives
	// (Imperial Mandate, Staff of Flowing Water) are left out.
	const ultimateHaste = (html) => {
		const text = (s) => s.replace(/<[^>]+>/g, ' ');
		const stats = text(html.match(/<stats>([\s\S]*?)<\/stats>/)?.[1] ?? '');
		const ability = stats.match(/(\d+)\s+Ability Haste/i);
		const ultimate = text(html).match(/(\d+)\s+Ultimate Ability Haste/i);
		return (ability ? Number(ability[1]) : 0) + (ultimate ? Number(ultimate[1]) : 0);
	};
	const ultimateHasteItems = {};
	for (const [id, item] of Object.entries(items.data)) {
		const haste = ultimateHaste(item.description);
		if (haste) ultimateHasteItems[id] = { name: item.name, haste };
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
		writeCache(data);
		console.log(`[game constants] updated to ${latest}`);
		return data;
	} catch (e) {
		console.warn('[game constants] update failed, using cache:', e.message);
		const version = newestCachedVersion();
		return version ? readCache(version) : null;
	}
}

module.exports = { loadGameConstants, download, fetchJson, DDRAGON };
