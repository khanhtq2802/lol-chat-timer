export interface Spell {
	id: number;
	name: string;
	description: string;
	summonerLevel: number;
	cooldown: number;
	gameModes: string[];
	iconPath: string;
}

export interface Champion {
	id: number;
	name: string;
	alias: string;
	squarePortraitPath: string;
	roles: string[];
	spellR?: {
		name: string;
		icon: string;
		cooldown: number;
	};
}

export interface SpellTimer {
	cooldown: number; // milliseconds
	endAt: number; // unix milliseconds
}

export type Team = 'ORDER' | 'CHAOS';

// lane order: top, jungle, mid, bot, support
export const POSITIONS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const;
export type Position = (typeof POSITIONS)[number];

// Subset of the Live Client Data API `allgamedata` response
// @see https://developer.riotgames.com/docs/lol#game-client-api_live-client-data-api
export interface LiveSummonerSpell {
	displayName: string;
	rawDisplayName: string;
}

export interface LivePlayer {
	championName: string;
	rawChampionName: string;
	team: Team;
	// empty when the queue has no roles (e.g. blind pick, practice tool)
	position?: string;
	level: number;
	riotId?: string;
	summonerName: string;
	summonerSpells: {
		summonerSpellOne: LiveSummonerSpell;
		summonerSpellTwo: LiveSummonerSpell;
	};
	items?: { itemID: number }[];
	// only the keystone and the rune trees are known for other players
	runes?: {
		keystone?: { id?: number };
		primaryRuneTree?: { id?: number };
		secondaryRuneTree?: { id?: number };
	};
	scores?: { kills: number; assists: number; creepScore: number };
	// counted from the game events (electron/main.cjs): different champions taken down, epic monsters
	takedowns?: { champions: number; epicMonsters: number };
}

export interface GameData {
	source: 'live';
	// seconds since the match started, when the data was read
	gameTime?: number;
	activePlayer: {
		riotId?: string;
		summonerName?: string;
	};
	allPlayers: LivePlayer[];
}

// Match on the loading screen, from the League Client (electron/leagueClient.cjs)
export interface LoadingData {
	source: 'loading';
	myTeam: Team | null;
	players: {
		team: Team;
		championId: number;
		// "NONE" when the queue has no roles
		position?: string;
		spell1Id?: number;
		spell2Id?: number;
	}[];
}

export type MatchData = GameData | LoadingData;

// Players of a champion with this keystone and rune trees
export interface RunePage {
	keystone: number;
	primary: number;
	secondary: number;
	play: number;
	// share of them (0 to 1) taking each haste rune, by rune id
	rates: { [runeId: string]: number };
}

export interface ChampionSpell {
	name: string;
	icon: string;
	cooldowns: number[];
}

// Latest patch data from Data Dragon, built by electron/gameConstants.cjs
export interface GameConstants {
	schema: number;
	version: string;
	// keyed by lowercase champion id, e.g. "kogmaw"
	champions: {
		[alias: string]: {
			key: number;
			name: string;
			icon: string;
			// cooldown at each rank of the spell
			q: ChampionSpell;
			w: ChampionSpell;
			e: ChampionSpell;
			r: ChampionSpell;
			// skill taken at each level, e.g. "WQEQQRQWQWRWWEE" (most played order on OP.GG)
			skillOrder?: string;
			// most played rune pages (OP.GG), to guess the runes the game does not report
			runePages?: RunePage[];
		};
	};
	// keyed by spell id, e.g. "SummonerFlash"
	summonerSpells: {
		[id: string]: { key: number; name: string; icon: string; cooldown: number };
	};
	// items granting summoner spell haste (Ionian Boots of Lucidity...), keyed by item id
	summonerHasteItems: {
		[itemId: string]: { name: string; haste: number };
	};
	// items granting haste to the ultimate (Ability Haste and Ultimate Ability Haste), keyed by item id
	ultimateHasteItems: {
		[itemId: string]: { name: string; haste: number };
	};
	// same for the basic abilities (Ability Haste and Basic Ability Haste)
	basicHasteItems: {
		[itemId: string]: { name: string; haste: number };
	};
	// names of the stats each item gives, keyed by item id
	itemStats: { [itemId: string]: string[] };
	// runes that change the cooldowns, keyed by rune id (treeId 0: stat shard, fits any page)
	hasteRunes: { [runeId: string]: { name: string; icon: string; treeId: number } };
	cosmicInsight: { name: string; treeId: number; haste: number };
}
