import { atom } from 'nanostores';
import { championsByAlias, spellsById } from '../data/load';
import builtInGameConstants from '../data/gameConstants.json';
import type {
	GameConstants,
	GameData,
	LivePlayer,
	LiveSummonerSpell,
	LoadingData,
	MatchData,
	Position
} from '../types';
import { POSITIONS } from '../types';
import { mockGameData, mockLoadingData } from './mockGameData';

export const matchDataAtom = atom<MatchData | null>(null);
// snapshot shipped with the app, replaced by the latest patch data once Electron downloads it
export const gameConstantsAtom = atom<GameConstants>(builtInGameConstants);

// game clock reading from the last Live Client Data update
let gameClock: { gameTime: number; readAt: number } | null = null;
matchDataAtom.subscribe((data) => {
	gameClock =
		data?.source === 'live' && data.gameTime !== undefined
			? { gameTime: data.gameTime, readAt: Date.now() }
			: null;
});

/** Seconds since the match started, null outside a match (e.g. on the loading screen) */
export function currentGameTime(now = Date.now()) {
	return gameClock ? gameClock.gameTime + (now - gameClock.readAt) / 1000 : null;
}

if (window.overlay) {
	window.overlay.onGameData((data) => matchDataAtom.set(data));
	window.overlay.onGameConstants((data) => gameConstantsAtom.set(data));
} else if (import.meta.env.DEV) {
	// running in a plain browser (`npm run dev`), show a sample match
	const loading = new URLSearchParams(location.search).has('loading');
	matchDataAtom.set(loading ? mockLoadingData : mockGameData);
}

const SELF_TEST = import.meta.env.MODE === 'selftest';
if (SELF_TEST) {
	// with the stack, Electron logs these to overlay-errors.log
	window.addEventListener('error', (e) => console.error(e.error?.stack ?? e.message));
	window.addEventListener('unhandledrejection', (e) => console.error(e.reason?.stack ?? e.reason));
}

// Data Dragon spell ids to the CommunityDragon ids of the bundled icons
const LOCAL_SPELL_IDS: { [key: string]: number } = {
	SummonerBoost: 1,
	SummonerExhaust: 3,
	SummonerFlash: 4,
	SummonerHaste: 6,
	SummonerHeal: 7,
	SummonerSmite: 11,
	SummonerTeleport: 12,
	SummonerMana: 13,
	SummonerDot: 14,
	SummonerBarrier: 21
};

const UNKNOWN_CHAMPION_ICON = '/lol-game-data/assets/v1/champion-icons/-1.png';

export interface OverlaySpell {
	key: string;
	title: string;
	icon: string;
	cooldown: number; // seconds, before haste
	// summoner spells are reduced by summoner spell haste, ultimates are not
	isSummonerSpell: boolean;
}

export interface EnemyChampion {
	id: string;
	name: string;
	icon: string;
	spells: OverlaySpell[];
	// Ionian Boots of Lucidity (or its upgrade) seen in the enemy items, null on the loading screen
	boots: { name: string; haste: number } | null;
	// ultimate haste from the enemy items, null on the loading screen
	ultimateHaste: { haste: number; items: string[] } | null;
	// false when neither rune tree is Inspiration, null when the rune trees are unknown
	canHaveCosmicInsight: boolean | null;
	// reported by the game when the queue has roles, guessed otherwise (see assignPositions)
	position: Position | null;
}

// same formula for summoner spell haste and ability haste
export function applyHaste(cooldown: number, haste: number) {
	return (cooldown * 100) / (100 + haste);
}

// R rank the champion most likely has at this level (ranks unlock at 6/11/16)
function ultimateRank(level: number, ranks: number) {
	const unlocked = [6, 11, 16].filter((l) => level >= l).length;
	// champions with 4 ranks (e.g. Elise, Nidalee) have R from level 1
	const rank = ranks >= 4 ? unlocked + 1 : unlocked;
	return Math.min(Math.max(rank, 1), ranks);
}

function toSummonerSpell(
	id: string | undefined,
	constants: GameConstants
): OverlaySpell | undefined {
	const data = id ? constants.summonerSpells[id] : undefined;
	if (!id || !data) return undefined;

	const local = spellsById[LOCAL_SPELL_IDS[id]];
	return {
		key: id,
		title: data.name,
		icon: local?.iconPath ?? data.icon,
		cooldown: data.cooldown,
		isSummonerSpell: true
	};
}

function toUltimate(
	alias: string,
	level: number,
	constants: GameConstants
): OverlaySpell | undefined {
	const champion = constants.champions[alias];
	if (!champion) return undefined;

	const { cooldowns } = champion.r;
	return {
		key: 'R',
		title: champion.r.name,
		icon: championsByAlias[alias]?.spellR?.icon ?? champion.r.icon,
		cooldown: cooldowns[ultimateRank(level, cooldowns.length) - 1],
		isSummonerSpell: false
	};
}

function toEnemy(
	alias: string,
	fallbackName: string,
	level: number,
	summonerSpellIds: (string | undefined)[],
	constants: GameConstants
): EnemyChampion {
	const champion = constants.champions[alias];
	const spells = [
		...summonerSpellIds.map((id) => toSummonerSpell(id, constants)),
		toUltimate(alias, level, constants)
	]
		.filter((s): s is OverlaySpell => !!s)
		// the overlay keys the spells, e.g. Practice Tool dummies can report the same spell twice
		.filter((s, i, all) => all.findIndex((other) => other.key === s.key) === i);

	return {
		id: alias || fallbackName,
		name: champion?.name ?? fallbackName,
		icon: championsByAlias[alias]?.squarePortraitPath ?? champion?.icon ?? UNKNOWN_CHAMPION_ICON,
		spells,
		boots: null,
		ultimateHaste: null,
		canHaveCosmicInsight: null,
		position: null
	};
}

/**
 * Gives each enemy a lane, sorted top, jungle, mid, bot, support. Uses the position the game reports
 * (role-based queues), else Smite means jungle, and the others fill the free lanes in scoreboard order.
 */
function assignPositions(enemies: { enemy: EnemyChampion; reported?: string }[]): EnemyChampion[] {
	const free = new Set<Position>(POSITIONS);
	// Practice Tool target dummies have no spells to time, and must not take a lane
	const assigned = enemies
		.filter(({ enemy }) => enemy.spells.length > 0)
		.map(({ enemy, reported }) => {
			const position = POSITIONS.find((p) => p === reported?.toUpperCase());
			if (position && free.has(position)) {
				free.delete(position);
				return { ...enemy, position };
			}
			return enemy;
		});

	const smiter = assigned.find(
		(e) => !e.position && e.spells.some((s) => s.key === 'SummonerSmite')
	);
	if (smiter && free.delete('JUNGLE')) smiter.position = 'JUNGLE';

	for (const enemy of assigned) {
		if (enemy.position) continue;
		const position = POSITIONS.find((p) => free.has(p));
		if (!position) break;
		free.delete(position);
		enemy.position = position;
	}

	const order = (e: EnemyChampion) =>
		e.position ? POSITIONS.indexOf(e.position) : POSITIONS.length;
	return assigned.sort((a, b) => order(a) - order(b));
}

// "GeneratedTip_SummonerSpell_SummonerFlash_DisplayName" -> "SummonerFlash"
function liveSummonerSpellId(spell: LiveSummonerSpell | undefined, constants: GameConstants) {
	if (!spell) return undefined;
	const rawKey = spell.rawDisplayName?.match(/Summoner(?!Spell)[A-Za-z]+/)?.[0];
	// longest known id that prefixes the raw key, e.g. "SummonerTeleportUpgrade" -> "SummonerTeleport"
	const id =
		rawKey &&
		Object.keys(constants.summonerSpells)
			.filter((k) => rawKey.startsWith(k))
			.sort((a, b) => b.length - a.length)[0];
	return (
		id ||
		Object.keys(constants.summonerSpells).find(
			(k) => constants.summonerSpells[k].name === spell.displayName
		)
	);
}

function liveEnemy(player: LivePlayer, constants: GameConstants): EnemyChampion {
	// rawChampionName is not localized, and looks like "game_character_displayname_KogMaw"
	// or, for some champions, "Character_Seraphine_Name"
	let alias = (player.rawChampionName ?? '')
		.replace(/^game_character_displayname_/i, '')
		.replace(/^Character_(.+)_Name$/i, '$1')
		.toLowerCase();
	if (!constants.champions[alias]) {
		alias =
			Object.keys(constants.champions).find(
				(k) => constants.champions[k].name === player.championName
			) ?? alias;
	}

	const enemy = toEnemy(
		alias,
		player.championName,
		player.level,
		[
			liveSummonerSpellId(player.summonerSpells?.summonerSpellOne, constants),
			liveSummonerSpellId(player.summonerSpells?.summonerSpellTwo, constants)
		],
		constants
	);

	const boots = (player.items ?? [])
		.map((item) => constants.summonerHasteItems[item.itemID])
		.filter((item) => !!item)
		.sort((a, b) => b.haste - a.haste)[0];
	const hasteItems = (player.items ?? [])
		.map((item) => constants.ultimateHasteItems?.[item.itemID])
		.filter((item) => !!item);
	const trees = [player.runes?.primaryRuneTree?.id, player.runes?.secondaryRuneTree?.id];

	return {
		...enemy,
		boots: boots ?? null,
		ultimateHaste: {
			haste: hasteItems.reduce((sum, item) => sum + item.haste, 0),
			items: hasteItems.map((item) => item.name)
		},
		canHaveCosmicInsight: trees.some((id) => id)
			? trees.includes(constants.cosmicInsight.treeId)
			: null
	};
}

function liveEnemies(data: GameData, constants: GameConstants) {
	const me = data.allPlayers.find(
		(p) =>
			(p.riotId && p.riotId === data.activePlayer.riotId) ||
			(p.summonerName && p.summonerName === data.activePlayer.summonerName)
	);
	// spectating: no active player, show the red side
	const myTeam = me?.team ?? 'ORDER';
	const enemies = assignPositions(
		data.allPlayers
			.filter((p) => p.team !== myTeam)
			.map((p) => ({ enemy: liveEnemy(p, constants), reported: p.position }))
	);
	// self-test build (`npm run dist:selftest`): your own champion as a 6th row, to try the timers
	if (SELF_TEST && me) {
		const self = liveEnemy(me, constants);
		enemies.push({ ...self, id: `self:${self.id}`, position: null });
	}
	return enemies;
}

function loadingEnemies(data: LoadingData, constants: GameConstants) {
	const aliasByKey = new Map(Object.entries(constants.champions).map(([a, c]) => [c.key, a]));
	const spellIdByKey = new Map(
		Object.entries(constants.summonerSpells).map(([id, s]) => [s.key, id])
	);
	const myTeam = data.myTeam ?? 'ORDER';

	return assignPositions(
		data.players
			.filter((p) => p.team !== myTeam)
			.map((p) => ({
				enemy: toEnemy(
					aliasByKey.get(p.championId) ?? '',
					`Champion ${p.championId}`,
					1,
					[p.spell1Id, p.spell2Id].map((key) => (key ? spellIdByKey.get(key) : undefined)),
					constants
				),
				reported: p.position
			}))
	);
}

export function getEnemies(data: MatchData, constants: GameConstants): EnemyChampion[] {
	const enemies =
		data.source === 'loading' ? loadingEnemies(data, constants) : liveEnemies(data, constants);
	// the overlay rows and timers are keyed by id, which repeats with the same champion twice
	// (e.g. One for All), and a repeated key breaks the overlay rendering
	const seen = new Map<string, number>();
	return enemies.map((e) => {
		const count = seen.get(e.id) ?? 0;
		seen.set(e.id, count + 1);
		return count === 0 ? e : { ...e, id: `${e.id}#${count + 1}` };
	});
}
