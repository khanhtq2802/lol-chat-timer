<script lang="ts">
	import { onDestroy } from 'svelte';
	import { persistentAtom } from '@nanostores/persistent';
	import { computed } from 'nanostores';
	import type { GameConstants, SpellTimer } from '../types';
	import {
		applyHaste,
		gameConstantsAtom,
		getEnemies,
		matchDataAtom,
		type EnemyChampion,
		type OverlaySpell,
		currentGameTime
	} from './gameData';
	import { buildChatLines, macroKeyAtom, macroKeyFromEvent, packChatMessages } from './chatMacro';

	const encoder = { encode: JSON.stringify, decode: JSON.parse };
	// seconds already passed when the spell is clicked (reaction time)
	const cooldownOffsetAtom = persistentAtom<number>('cooldownOffsetAtom', 2, encoder);
	const clickStepAtom = persistentAtom<number>('clickStepAtom', 5, encoder);

	let enemies: readonly EnemyChampion[] = [];
	let rosterKey = '';
	// keyed by `${champion id}:${spell key}`
	let timers: { [key: string]: SpellTimer } = {};
	// summoner spell haste the player ticked for each enemy, keyed by champion id
	let modifiers: { [enemyId: string]: { boots?: boolean; cosmicInsight?: boolean } } = {};
	let now = Date.now();
	let isSetting = false;
	let minimize = false;

	const enemiesAtom = computed([matchDataAtom, gameConstantsAtom], (data, constants) =>
		data ? getEnemies(data, constants) : []
	);

	const unsubscribe = enemiesAtom.subscribe((value) => {
		enemies = value;
		// new match: drop the old timers and ticks. The roster stays the same from the loading
		// screen to the match, and is empty in between, so the ticks carry over.
		const key = enemies.map((e) => e.id).join('|');
		if (enemies.length > 0 && key !== rosterKey) {
			rosterKey = key;
			timers = {};
			modifiers = {};
		}
	});

	interface Row {
		enemy: EnemyChampion;
		boots: boolean;
		bootsTitle: string;
		cosmicInsight: boolean;
		cosmicInsightTitle: string;
		spells: { spell: OverlaySpell; cooldown: number; hasteTitle: string }[];
	}

	function toRow(
		enemy: EnemyChampion,
		ticked: { boots?: boolean; cosmicInsight?: boolean },
		constants: GameConstants
	): Row {
		// ticking boots by hand assumes the basic Ionian Boots of Lucidity
		const manualBoots = constants.summonerHasteItems['3158'] ?? {
			name: 'Ionian Boots of Lucidity',
			haste: 10
		};
		const cosmic = constants.cosmicInsight;
		const boots = enemy.boots ?? (ticked.boots ? manualBoots : null);
		const cosmicInsight = enemy.canHaveCosmicInsight !== false && !!ticked.cosmicInsight;
		const haste = (boots?.haste ?? 0) + (cosmicInsight ? cosmic.haste : 0);
		// from the items in game; boots ticked by hand also give their ability haste
		const ultimateHaste =
			enemy.ultimateHaste?.haste ??
			(ticked.boots ? constants.ultimateHasteItems?.['3158']?.haste ?? 0 : 0);
		const ultimateHasteFrom =
			enemy.ultimateHaste?.items ?? (ticked.boots ? [manualBoots.name] : []);

		return {
			enemy,
			boots: !!boots,
			bootsTitle: enemy.boots
				? `${enemy.boots.name}: +${enemy.boots.haste} summoner spell haste (from items)`
				: `${manualBoots.name}: +${manualBoots.haste} summoner spell haste (click to toggle)`,
			cosmicInsight,
			cosmicInsightTitle:
				enemy.canHaveCosmicInsight === false
					? `${cosmic.name}: not possible, no Inspiration rune tree`
					: `${cosmic.name}: +${cosmic.haste} summoner spell haste (click to toggle)`,
			spells: enemy.spells.map((spell) => ({
				spell,
				cooldown: applyHaste(spell.cooldown, spell.isSummonerSpell ? haste : ultimateHaste),
				hasteTitle: spell.isSummonerSpell
					? haste
						? `, ${haste} summoner spell haste`
						: ''
					: ultimateHaste
					? `, ${ultimateHaste} ability haste: ${ultimateHasteFrom.join(', ')}`
					: ''
			}))
		};
	}

	$: isLoadingScreen = $matchDataAtom?.source === 'loading';
	$: rows = enemies.map((enemy) => toRow(enemy, modifiers[enemy.id] ?? {}, $gameConstantsAtom));

	function toggleModifier(enemy: EnemyChampion, modifier: 'boots' | 'cosmicInsight') {
		// auto-detected from the items, or impossible with these rune trees
		if (modifier === 'boots' && enemy.boots) return;
		if (modifier === 'cosmicInsight' && enemy.canHaveCosmicInsight === false) return;
		const current = modifiers[enemy.id] ?? {};
		modifiers[enemy.id] = { ...current, [modifier]: !current[modifier] };
	}

	const interval = setInterval(() => {
		now = Date.now();
		for (const [key, timer] of Object.entries(timers)) {
			if (timer.endAt <= now) {
				delete timers[key];
				timers = timers;
			}
		}
	}, 100);

	// chat macro key pressed in the game: share the running timers with the team
	const stopMacro = window.overlay?.onMacroTrigger(() => {
		const gameTime = currentGameTime();
		if (gameTime === null) return;
		const lines = buildChatLines(
			rows.map(({ enemy, spells }) => ({
				champion: enemy.name,
				position: enemy.position,
				spells: spells
					.filter(({ spell }) => timers[`${enemy.id}:${spell.key}`])
					.map(({ spell }) => ({
						key: spell.key,
						title: spell.title,
						endAt: timers[`${enemy.id}:${spell.key}`].endAt
					}))
			})),
			gameTime
		);
		// one message per line, at most 4 (the game drops the 5th)
		for (const message of packChatMessages(lines)) window.overlay?.sendChat(message);
	});

	const stopMacroKey = macroKeyAtom.subscribe(({ vk, mods }) =>
		window.overlay?.setMacroKey(vk, mods)
	);
	let capturingMacroKey = false;

	function onKeyDown(e: KeyboardEvent) {
		if (!capturingMacroKey) return;
		e.preventDefault();
		if (e.key === 'Escape') {
			capturingMacroKey = false;
		} else if (e.key === 'Backspace' || e.key === 'Delete') {
			macroKeyAtom.set({ vk: 0, mods: 0, label: 'Off' });
			capturingMacroKey = false;
		} else if (e.key !== 'Enter') {
			// Enter opens the chat, it can't be the macro key
			const key = macroKeyFromEvent(e);
			if (!key) return;
			macroKeyAtom.set(key);
			capturingMacroKey = false;
		}
	}

	onDestroy(() => {
		unsubscribe();
		clearInterval(interval);
		stopMacro?.();
		stopMacroKey();
	});

	function onSpellMouseDown(
		e: MouseEvent,
		enemy: EnemyChampion,
		spell: OverlaySpell,
		seconds: number
	) {
		const key = `${enemy.id}:${spell.key}`;
		const timer = timers[key];

		if (!timer) {
			if (e.button !== 0) return;
			const offset = cooldownOffsetAtom.get();
			// very short cooldowns (e.g. Kog'Maw R) would end before they start
			const cooldown = (seconds > offset ? seconds - offset : seconds) * 1000;
			timers[key] = { cooldown, endAt: Date.now() + cooldown };
			return;
		}

		switch (e.button) {
			case 1:
				timer.endAt += clickStepAtom.get() * 1000;
				break;
			case 2:
				timer.endAt -= clickStepAtom.get() * 1000;
				break;
			default:
				delete timers[key];
		}
		timers = timers;
	}

	function toggleSetting() {
		isSetting = !isSetting;
		capturingMacroKey = false;
		window.overlay?.setFocusable(isSetting);
	}

	function formatCountdown(ms: number) {
		const seconds = Math.ceil(ms / 1000);
		if (seconds < 60) return `${seconds}`;
		return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
	}
</script>

<svelte:window on:contextmenu|preventDefault on:keydown={onKeyDown} />

<div class="in-game flex flex-col h-screen max-h-screen">
	<div class="header drag bg-base-100">
		<span class="mt-1 ml-1" style="font-size: 0.5rem">
			{isLoadingScreen ? 'Spell Timer - Loading' : 'Spell Timer'}
			{import.meta.env.MODE === 'selftest' ? '(Selftest)' : ''}
		</span>
		<div class="window-controls-group no-drag">
			<button class="icon window-control" title="Settings" on:click={toggleSetting}>
				<svg viewBox="0 0 30 30">
					<path
						d="M22,16.3V13.7H19.81a4.94,4.94,0,0,0-.49-1.18L20.87,11,19,9.13l-1.55,1.55a5,5,0,0,0-1.18-.49V8H13.7v2.19a5,5,0,0,0-1.18.49L11,9.13,9.13,11l1.55,1.55a5,5,0,0,0-.49,1.18H8v2.6h2.19a5,5,0,0,0,.49,1.18L9.13,19,11,20.87l1.55-1.55a4.94,4.94,0,0,0,1.18.49V22h2.6V19.81a4.94,4.94,0,0,0,1.18-.49L19,20.87,20.87,19l-1.55-1.55a4.94,4.94,0,0,0,.49-1.18Zm-7,1.45A2.75,2.75,0,1,1,17.75,15,2.75,2.75,0,0,1,15,17.75Z"
						fill="currentcolor"
					/>
				</svg>
			</button>
			<button
				class="icon window-control"
				title={minimize ? 'Expand' : 'Collapse'}
				on:click={() => (minimize = !minimize)}
			>
				<svg viewBox="0 0 30 30">
					<line x1={10} y1="15" x2={20} y2="15" fill="none" stroke="currentcolor" />
					{#if minimize}
						<line x1={15} y1="10" x2={15} y2="20" fill="none" stroke="currentcolor" />
					{/if}
				</svg>
			</button>
			<button
				class="icon window-control window-control-close"
				title="Hide (reopen from the tray icon)"
				on:click={() => window.overlay?.hide()}
			>
				<svg viewBox="0 0 30 30">
					<line x1="19.5" y1="10.5" x2="10.5" y2="19.5" fill="none" stroke="currentcolor" />
					<line x1="10.5" y1="10.5" x2="19.5" y2="19.5" fill="none" stroke="currentcolor" />
				</svg>
			</button>
		</div>
	</div>
	<div class={`flex flex-col gap-1 p-1 overflow-y-hidden ${minimize ? 'hidden' : ''}`}>
		{#if isSetting}
			<div class="form-control w-full bg-base-100 p-1 rounded">
				<!-- svelte-ignore a11y-label-has-associated-control -->
				<label class="label py-1">
					<span class="label-text" style="font-size: 0.6rem">Cooldown Offset (Seconds)</span>
				</label>
				<input
					type="number"
					class="input input-bordered input-xs w-full"
					min="0"
					value={cooldownOffsetAtom.get()}
					on:change={(e) => {
						const n = parseInt(e.currentTarget.value);
						if (n >= 0) cooldownOffsetAtom.set(n);
					}}
				/>
				<!-- svelte-ignore a11y-label-has-associated-control -->
				<label class="label py-1">
					<span class="label-text" style="font-size: 0.6rem">Click Step (Seconds)</span>
				</label>
				<input
					type="number"
					class="input input-bordered input-xs w-full"
					min="0"
					value={clickStepAtom.get()}
					on:change={(e) => {
						const n = parseInt(e.currentTarget.value);
						if (n >= 0) clickStepAtom.set(n);
					}}
				/>
				<!-- svelte-ignore a11y-label-has-associated-control -->
				<label class="label py-1">
					<span class="label-text" style="font-size: 0.6rem">Chat Macro Key</span>
				</label>
				<button
					class="btn btn-xs w-full normal-case"
					title="Click, then press a key. Backspace turns the macro off, Esc cancels."
					on:click={() => (capturingMacroKey = !capturingMacroKey)}
				>
					{capturingMacroKey ? 'Press a key...' : $macroKeyAtom.label}
				</button>
			</div>
		{:else if enemies.length === 0}
			<div class="bg-base-100 rounded p-1 text-center" style="font-size: 0.6rem">
				Waiting for a match...
			</div>
		{:else}
			{#each rows as { enemy, boots, bootsTitle, cosmicInsight, cosmicInsightTitle, spells } (enemy.id)}
				<div class="flex gap-1">
					<img class="icon-cell rounded" alt={enemy.name} title={enemy.name} src={enemy.icon} />
					<div class="flex flex-col justify-between flex-none">
						<button
							class="modifier"
							class:on={boots}
							class:auto={!!enemy.boots}
							title={bootsTitle}
							on:click={() => toggleModifier(enemy, 'boots')}
						>
							<img src="/icons/ionian-boots.png" alt="Ionian Boots of Lucidity" />
						</button>
						<button
							class="modifier"
							class:on={cosmicInsight}
							class:unavailable={enemy.canHaveCosmicInsight === false}
							title={cosmicInsightTitle}
							on:click={() => toggleModifier(enemy, 'cosmicInsight')}
						>
							<img src="/icons/cosmic-insight.png" alt={$gameConstantsAtom.cosmicInsight.name} />
						</button>
					</div>
					{#each spells as { spell, cooldown, hasteTitle } (spell.key)}
						{@const timer = timers[`${enemy.id}:${spell.key}`]}
						<!-- svelte-ignore a11y-no-static-element-interactions -->
						<div
							class="skill icon-cell"
							class:active={!!timer}
							title={`${spell.title} (${Math.round(cooldown)}s${hasteTitle})`}
							style={timer
								? `--time-left:${Math.round(((timer.endAt - now) / timer.cooldown) * 10000) / 100}%`
								: ''}
							on:mousedown={(e) => onSpellMouseDown(e, enemy, spell, cooldown)}
						>
							<img class="absolute w-full h-full" alt={spell.title} src={spell.icon} />
							{#if timer}
								<div class="absolute flex w-full h-full z-20">
									<div class="countdown-text m-auto">{formatCountdown(timer.endAt - now)}</div>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/each}
		{/if}
	</div>
</div>

<style lang="scss">
	.drag {
		-webkit-app-region: drag;
	}
	.no-drag {
		-webkit-app-region: no-drag;
	}

	.icon-cell {
		width: 32px;
		height: 32px;
		flex: none;
	}

	.skill {
		position: relative;
		border: 1px solid #36393e;
		border-radius: 5%;
		overflow: hidden;
		cursor: pointer;
	}

	.skill.active::before {
		content: '';
		background: conic-gradient(
			rgba(0, 0, 0, 0.75) var(--time-left),
			rgba(0, 0, 0, 0.1) var(--time-left)
		);
		position: absolute;
		inset: 0;
		z-index: 1;
	}

	.modifier {
		width: 15px;
		height: 15px;
		padding: 0;
		border: 1px solid transparent;
		border-radius: 3px;
		overflow: hidden;
		cursor: pointer;
		opacity: 0.35;
		filter: grayscale(1);
	}
	.modifier img {
		width: 100%;
		height: 100%;
	}
	.modifier.on {
		opacity: 1;
		filter: none;
		border-color: #4ade80;
	}
	.modifier.auto {
		border-color: #c8aa6e;
		cursor: default;
	}
	.modifier.unavailable {
		opacity: 0.12;
		cursor: not-allowed;
	}

	.countdown-text {
		font-size: 0.7rem;
		font-weight: 700;
		color: #fff;
		text-shadow: 0 0 2px #000, 0 0 2px #000;
	}
</style>
