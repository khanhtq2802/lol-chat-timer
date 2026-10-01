import type { GameConstants, MatchData } from './types';

// See https://kit.svelte.dev/docs/types#app
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface Platform {}
	}

	interface Window {
		// exposed by electron/preload.cjs, undefined in a plain browser
		overlay?: {
			onGameData(callback: (data: MatchData | null) => void): () => void;
			onGameConstants(callback: (data: GameConstants) => void): () => void;
			// the chat macro key was pressed in the game
			onMacroTrigger(callback: () => void): () => void;
			// types the text in the team chat
			sendChat(text: string): void;
			// Windows virtual-key code (0 disables the macro), mods: 1 ctrl, 2 shift, 4 alt
			setMacroKey(vk: number, mods: number): void;
			hide(): void;
			setFocusable(focusable: boolean): void;
		};
	}
}

export {};
