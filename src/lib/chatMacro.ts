import { persistentAtom } from '@nanostores/persistent';
import type { Position } from '../types';

export interface MacroKey {
	vk: number; // Windows virtual-key code, 0 when the macro is off
	mods: number; // 1 ctrl, 2 shift, 4 alt
	label: string;
}

const encoder = { encode: JSON.stringify, decode: JSON.parse };
export const macroKeyAtom = persistentAtom<MacroKey>(
	'macroKeyAtom',
	{ vk: 84, mods: 0, label: 'T' },
	encoder
);

// short names teammates know, by Data Dragon spell id
const SHORT_NAMES: { [spellKey: string]: string } = {
	SummonerFlash: 'F',
	SummonerTeleport: 'TP',
	SummonerDot: 'Ign',
	SummonerHeal: 'Heal',
	SummonerExhaust: 'Exh',
	SummonerBarrier: 'Barrier',
	SummonerBoost: 'Cleanse',
	SummonerHaste: 'Ghost',
	SummonerSmite: 'Smite',
	SummonerMana: 'Clarity'
};

const POSITION_NAMES: { [position in Position]: string } = {
	TOP: 'top',
	JUNGLE: 'jg',
	MIDDLE: 'mid',
	BOTTOM: 'ad',
	UTILITY: 'sp'
};

export interface MacroEnemy {
	champion: string;
	position: Position | null;
	// running timers, in the overlay order (summoner spells, then Q W E R)
	spells: {
		key: string; // summoner spell id, or Q W E R
		title: string;
		isSummonerSpell: boolean;
		endAt: number; // unix milliseconds
	}[];
}

// game clock, "05:00"
export function formatGameTime(seconds: number) {
	const s = Math.max(0, Math.round(seconds));
	return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * One chat line per enemy with a running timer, "top F 05:00 | Q 4s | R 45s": the game clock time
 * the summoner spells are back up, and the seconds left for the abilities (too short for a clock
 * time). Uses the champion name when the lane is unknown.
 */
export function buildChatLines(enemies: MacroEnemy[], gameTime: number, now = Date.now()) {
	return enemies
		.filter((e) => e.spells.length > 0)
		.map((e) => {
			const name = e.position ? POSITION_NAMES[e.position] : e.champion;
			const spells = e.spells.map((s) => {
				const secondsLeft = Math.max(0, (s.endAt - now) / 1000);
				return s.isSummonerSpell
					? `${SHORT_NAMES[s.key] ?? s.title} ${formatGameTime(gameTime + secondsLeft)}`
					: `${s.key} ${Math.ceil(secondsLeft)}s`;
			});
			return `${name} ${spells.join(' | ')}`;
		});
}

// the game drops messages sent in a quick burst past this (the 5th line never showed up)
const MAX_MESSAGES = 4;

/**
 * One message per line, the lines past the limit join the last message: "ad F 05:00 / sp Exh 04:30".
 */
export function packChatMessages(lines: string[], maxMessages = MAX_MESSAGES) {
	if (lines.length <= maxMessages) return lines;
	return [...lines.slice(0, maxMessages - 1), lines.slice(maxMessages - 1).join(' / ')];
}

// "Ctrl+Shift+T", "F8", "`"
export function macroKeyFromEvent(e: KeyboardEvent): MacroKey | null {
	if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
	const mods = (e.ctrlKey ? 1 : 0) | (e.shiftKey ? 2 : 0) | (e.altKey ? 4 : 0);
	const key = /^F\d+$/.test(e.code) ? e.code : e.key.length === 1 ? e.key.toUpperCase() : e.code;
	const label = [e.ctrlKey && 'Ctrl', e.shiftKey && 'Shift', e.altKey && 'Alt', key]
		.filter(Boolean)
		.join('+');
	return { vk: e.keyCode, mods, label };
}
