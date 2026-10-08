// Runes that change the cooldowns. The game only reports the keystone and the two rune trees of the
// other players, so the overlay guesses the rest from the rune pages played on OP.GG, and works out
// what each rune gives from the match (level, items, takedowns).
import type { GameConstants, RunePage } from '../types';

const COSMIC_INSIGHT = '8347';
const HASTE_SHARD = '5007';
const TRANSCENDENCE = '8210';
const ULTIMATE_HUNTER = '8106';
const JACK_OF_ALL_TRADES = '8316';
const LEGEND_HASTE = '9105';
const TRIPLE_TONIC = '8313';

// a rune is on by default when at least this share of the players take it
export const AUTO_RATE = 0.5;
// rarer runes get no button (Cosmic Insight always has one, to tick it by hand)
const SHOWN_RATE = 0.1;
const MAX_RUNES = 5;

// progress to a Legend stack (100 each): takedowns give 100, minions about 4, jungle camps more
const LEGEND_STACK = 100;
const LEGEND_PER_CS = 4;
const LEGEND_PER_JUNGLE_CS = 7;

/** What the match tells about a player */
export interface RuneContext {
	level: number;
	itemIds: number[];
	// different champions taken down, epic monsters (from the game events)
	takedowns: { champions: number; epicMonsters: number };
	scores: { kills: number; assists: number; creepScore: number };
	isJungler: boolean;
}

export const LOADING_CONTEXT: RuneContext = {
	level: 1,
	itemIds: [],
	takedowns: { champions: 0, epicMonsters: 0 },
	scores: { kills: 0, assists: 0, creepScore: 0 },
	isJungler: false
};

export interface RuneGuess {
	id: string;
	name: string;
	icon: string;
	// share of the players with this rune page taking the rune, null when OP.GG has no such page
	rate: number | null;
	// what the rune gives right now
	summonerHaste: number;
	basicHaste: number;
	ultimateHaste: number;
	skillPoints: number;
	detail: string;
}

type RuneEffect = Pick<
	RuneGuess,
	'summonerHaste' | 'basicHaste' | 'ultimateHaste' | 'skillPoints' | 'detail'
>;

function runeEffect(id: string, context: RuneContext, constants: GameConstants): RuneEffect {
	const effect: RuneEffect = {
		summonerHaste: 0,
		basicHaste: 0,
		ultimateHaste: 0,
		skillPoints: 0,
		detail: ''
	};
	const abilityHaste = (haste: number) => {
		effect.basicHaste = haste;
		effect.ultimateHaste = haste;
	};

	switch (id) {
		case COSMIC_INSIGHT:
			effect.summonerHaste = constants.cosmicInsight.haste;
			effect.detail = `+${effect.summonerHaste} summoner spell haste`;
			break;
		case HASTE_SHARD:
			abilityHaste(8);
			effect.detail = '+8 ability haste';
			break;
		case TRANSCENDENCE:
			// +5 at level 5 and at level 8
			abilityHaste((context.level >= 5 ? 5 : 0) + (context.level >= 8 ? 5 : 0));
			effect.detail = `+${effect.basicHaste} ability haste (level 5 and 8)`;
			break;
		case ULTIMATE_HUNTER: {
			// one Bounty Hunter stack for each enemy champion taken down
			const stacks = Math.min(context.takedowns.champions, 5);
			effect.ultimateHaste = 6 + 5 * stacks;
			effect.detail = `${stacks} stacks, +${effect.ultimateHaste} ultimate haste`;
			break;
		}
		case JACK_OF_ALL_TRADES: {
			// 1 ability haste for each different stat from the items
			const stats = new Set(context.itemIds.flatMap((item) => constants.itemStats?.[item] ?? []));
			abilityHaste(stats.size);
			effect.detail = `${stats.size} item stats, +${stats.size} ability haste`;
			break;
		}
		case LEGEND_HASTE: {
			// the stacks are not reported, estimated from what earns them
			const { scores, takedowns, isJungler } = context;
			const progress =
				LEGEND_STACK * (scores.kills + scores.assists + takedowns.epicMonsters) +
				(isJungler ? LEGEND_PER_JUNGLE_CS : LEGEND_PER_CS) * scores.creepScore;
			const stacks = Math.min(Math.floor(progress / LEGEND_STACK), 10);
			effect.basicHaste = 1.5 * stacks;
			effect.detail = `about ${stacks} stacks, +${effect.basicHaste} basic ability haste`;
			break;
		}
		case TRIPLE_TONIC:
			// the Elixir of Skill given at level 9
			effect.skillPoints = context.level >= 9 ? 1 : 0;
			effect.detail = '+1 skill point at level 9';
			break;
	}
	return effect;
}

/**
 * Rune pages of the champion like the one of the player: same keystone and trees, else same trees,
 * else same keystone. All the pages when the runes are unknown (loading screen).
 */
function matchingPages(pages: RunePage[], runes: PlayerRunes | null) {
	if (!runes) return pages;
	const sameTrees = (p: RunePage) => p.primary === runes.primary && p.secondary === runes.secondary;
	const sameKeystone = (p: RunePage) => p.keystone === runes.keystone;
	return [
		pages.filter((p) => sameTrees(p) && sameKeystone(p)),
		pages.filter(sameTrees),
		pages.filter(sameKeystone)
	].find((matches) => matches.length > 0);
}

export interface PlayerRunes {
	keystone?: number;
	primary?: number;
	secondary?: number;
}

/**
 * Haste runes the player may have, most likely first.
 * @param runes keystone and rune trees of the player, null when unknown (loading screen)
 */
export function guessRunes(
	pages: RunePage[] | undefined,
	runes: PlayerRunes | null,
	context: RuneContext,
	constants: GameConstants
): RuneGuess[] {
	const matches = matchingPages(pages ?? [], runes) ?? [];
	const players = matches.reduce((sum, page) => sum + page.play, 0);
	const rateOf = (id: string) =>
		players > 0
			? matches.reduce((sum, page) => sum + page.play * (page.rates[id] ?? 0), 0) / players
			: null;

	return Object.entries(constants.hasteRunes ?? {})
		.filter(
			// a rune needs its tree, a stat shard fits any page
			([, rune]) =>
				!runes || rune.treeId === 0 || [runes.primary, runes.secondary].includes(rune.treeId)
		)
		.map(([id, rune]) => ({
			id,
			name: rune.name,
			icon: id === COSMIC_INSIGHT ? '/icons/cosmic-insight.png' : rune.icon,
			rate: rateOf(id),
			...runeEffect(id, context, constants)
		}))
		.filter((rune) => rune.id === COSMIC_INSIGHT || (rune.rate ?? 0) >= SHOWN_RATE)
		.sort(
			(a, b) =>
				Number(b.id === COSMIC_INSIGHT) - Number(a.id === COSMIC_INSIGHT) ||
				(b.rate ?? 0) - (a.rate ?? 0)
		)
		.slice(0, MAX_RUNES);
}
