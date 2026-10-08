import type { GameData, LivePlayer, LoadingData } from '../types';

const INSPIRATION = 8300;
const PRECISION = 8000;
const DOMINATION = 8100;
const RESOLVE = 8400;

const spell = (key: string, displayName: string) => ({
	displayName,
	rawDisplayName: `GeneratedTip_SummonerSpell_${key}_DisplayName`
});

const player = (
	team: LivePlayer['team'],
	riotId: string,
	championName: string,
	alias: string,
	spells: [string, string, string, string],
	runeTrees: [number, number],
	itemIds: number[] = [],
	keystone?: number
): LivePlayer => ({
	championName,
	rawChampionName: `game_character_displayname_${alias}`,
	team,
	level: 11,
	riotId,
	summonerName: riotId.split('#')[0],
	summonerSpells: {
		summonerSpellOne: spell(spells[0], spells[1]),
		summonerSpellTwo: spell(spells[2], spells[3])
	},
	items: itemIds.map((itemID) => ({ itemID })),
	runes: {
		keystone: { id: keystone },
		primaryRuneTree: { id: runeTrees[0] },
		secondaryRuneTree: { id: runeTrees[1] }
	},
	scores: { kills: 2, assists: 3, creepScore: 80 },
	takedowns: { champions: 3, epicMonsters: 1 }
});

// Sample Live Client Data API response used when running in a browser without Electron
export const mockGameData: GameData = {
	source: 'live',
	gameTime: 600,
	activePlayer: { riotId: 'Me#VN2', summonerName: 'Me' },
	allPlayers: [
		player(
			'ORDER',
			'Me#VN2',
			'Corki',
			'Corki',
			['SummonerFlash', 'Flash', 'SummonerHeal', 'Heal'],
			[PRECISION, INSPIRATION]
		),
		player(
			'CHAOS',
			'Top#VN2',
			'Darius',
			'Darius',
			['SummonerFlash', 'Flash', 'SummonerTeleport', 'Teleport'],
			[PRECISION, RESOLVE]
		),
		player(
			'CHAOS',
			'Jungle#VN2',
			'Lee Sin',
			'LeeSin',
			['SummonerSmite', 'Smite', 'SummonerFlash', 'Flash'],
			[PRECISION, INSPIRATION],
			[3158]
		),
		player(
			'CHAOS',
			'Mid#VN2',
			'Ahri',
			'Ahri',
			['SummonerFlash', 'Flash', 'SummonerDot', 'Ignite'],
			[DOMINATION, INSPIRATION],
			[3171],
			8112 // Electrocute
		),
		player(
			'CHAOS',
			'Bot#VN2',
			"Kog'Maw",
			'KogMaw',
			['SummonerHeal', 'Heal', 'SummonerFlash', 'Flash'],
			[PRECISION, DOMINATION]
		),
		player(
			'CHAOS',
			'Sup#VN2',
			'Thresh',
			'Thresh',
			['SummonerFlash', 'Flash', 'SummonerExhaust', 'Exhaust'],
			[INSPIRATION, RESOLVE],
			[],
			8351 // Glacial Augment
		)
	]
};

// Sample League Client loading screen, shown in the browser with `?loading`
export const mockLoadingData: LoadingData = {
	source: 'loading',
	myTeam: 'ORDER',
	players: [
		{ team: 'ORDER', championId: 42, spell1Id: 4, spell2Id: 7 },
		{ team: 'CHAOS', championId: 122, spell1Id: 4, spell2Id: 12 },
		{ team: 'CHAOS', championId: 64, spell1Id: 11, spell2Id: 4 },
		{ team: 'CHAOS', championId: 103, spell1Id: 4, spell2Id: 14 },
		{ team: 'CHAOS', championId: 96, spell1Id: 7, spell2Id: 4 },
		{ team: 'CHAOS', championId: 412, spell1Id: 4, spell2Id: 3 }
	]
};
