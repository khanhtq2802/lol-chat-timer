const { app, BrowserWindow, Menu, Tray, ipcMain, net, protocol, screen } = require('electron');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { loadGameConstants } = require('./gameConstants.cjs');
const { fetchLoadingData } = require('./leagueClient.cjs');
const { startInputHelper } = require('./inputHelper.cjs');

// Set OVERLAY_DEV_URL (e.g. http://localhost:5173) to load the Vite dev server instead of the build
const DEV_URL = process.env.OVERLAY_DEV_URL;
const BUILD_DIR = path.join(__dirname, '..', 'build');
const TRAY_ICON = path.join(__dirname, '..', 'static', 'desktop-icon.ico');

// Riot Live Client Data API, served by the game client while a match is running
// @see https://developer.riotgames.com/docs/lol#game-client-api_live-client-data-api
const LIVE_CLIENT_URL = 'https://127.0.0.1:2999/liveclientdata/allgamedata';
const POLL_INTERVAL = 2000;

// self-test build (`npm run dist:selftest`): shows your own champion as a 6th row. Keeps its own
// settings and single-instance lock, so it can run next to the normal app.
const SELF_TEST = /selftest/i.test(path.basename(process.execPath));
if (SELF_TEST) app.setPath('userData', `${app.getPath('userData')}-selftest`);

// size until the overlay reports its own (see 'overlay:set-size')
const WINDOW_WIDTH = 300;
const WINDOW_HEIGHT = 230;
const MAX_WINDOW_SIZE = 1000;

// The game serves the API on localhost with a self-signed Riot certificate
const liveClientAgent = new https.Agent({ rejectUnauthorized: false });

protocol.registerSchemesAsPrivileged([
	{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

/** @type {BrowserWindow | null} */
let win = null;
/** @type {Tray | null} */
let tray = null;
let inGame = false;
let gameConstants = null;
/** @type {ReturnType<typeof startInputHelper> | null} */
let inputHelper = null;

// self-test build: files to find out what the game sent when the overlay breaks
const debugFile = (name) => path.join(app.getPath('userData'), name);
function writeDebugFile(name, text) {
	try {
		fs.writeFileSync(debugFile(name), text);
	} catch {
		// best effort
	}
}
function logDebug(message) {
	try {
		fs.appendFileSync(
			debugFile('overlay-errors.log'),
			`${new Date().toISOString()} ${message}
`
		);
	} catch {
		// best effort
	}
}

const EPIC_MONSTER_EVENTS = ['DragonKill', 'HeraldKill', 'BaronKill', 'HordeKill', 'AtakhanKill'];

/**
 * Takedowns of each player from the game events, by the name the events use (the Riot ID without
 * its tag): the different champions taken down (Ultimate Hunter stacks) and the epic monsters
 * (Legend stacks). The game does not report the stacks of the other players.
 * @returns {Map<string, { champions: Set<string>, epicMonsters: number }>}
 */
function countTakedowns(events) {
	const takedowns = new Map();
	const of = (name) => {
		if (!takedowns.has(name)) takedowns.set(name, { champions: new Set(), epicMonsters: 0 });
		return takedowns.get(name);
	};
	for (const event of Array.isArray(events) ? events : []) {
		const names = [event.KillerName, ...(Array.isArray(event.Assisters) ? event.Assisters : [])];
		for (const name of names.filter((n) => typeof n === 'string' && n)) {
			if (event.EventName === 'ChampionKill' && event.VictimName) {
				of(name).champions.add(event.VictimName);
			} else if (EPIC_MONSTER_EVENTS.includes(event.EventName)) {
				of(name).epicMonsters++;
			}
		}
	}
	return takedowns;
}

function fetchGameData() {
	return new Promise((resolve) => {
		const req = https.get(LIVE_CLIENT_URL, { agent: liveClientAgent, timeout: 1500 }, (res) => {
			if (res.statusCode !== 200) {
				res.resume();
				resolve(null);
				return;
			}
			let body = '';
			res.setEncoding('utf8');
			res.on('data', (chunk) => (body += chunk));
			res.on('end', () => {
				try {
					const data = JSON.parse(body);
					if (SELF_TEST) writeDebugFile('last-live-data.json', body);
					if (!Array.isArray(data.allPlayers) || data.allPlayers.length === 0) {
						resolve(null);
						return;
					}
					const takedowns = countTakedowns(data.events?.Events);
					const takedownsOf = (p) =>
						takedowns.get(p.riotIdGameName) ??
						takedowns.get(p.summonerName) ??
						takedowns.get(p.riotId);
					// only send what the overlay needs
					resolve({
						source: 'live',
						gameTime: data.gameData?.gameTime,
						activePlayer: {
							riotId: data.activePlayer?.riotId,
							summonerName: data.activePlayer?.summonerName
						},
						allPlayers: data.allPlayers.map((p) => ({
							championName: p.championName,
							rawChampionName: p.rawChampionName,
							team: p.team,
							// TOP, JUNGLE, MIDDLE, BOTTOM, UTILITY, or empty when unknown (e.g. blind pick)
							position: p.position,
							level: p.level,
							riotId: p.riotId,
							summonerName: p.summonerName,
							// Practice Tool target dummies get { error: 'Unable to find player' } instead
							summonerSpells: p.summonerSpells?.error ? undefined : p.summonerSpells,
							items: Array.isArray(p.items) ? p.items.map((item) => ({ itemID: item.itemID })) : [],
							// other players only expose their keystone and rune trees, not the other runes
							runes: p.runes &&
								!p.runes.error && {
									keystone: { id: p.runes.keystone?.id },
									primaryRuneTree: { id: p.runes.primaryRuneTree?.id },
									secondaryRuneTree: { id: p.runes.secondaryRuneTree?.id }
								},
							scores: p.scores &&
								!p.scores.error && {
									kills: p.scores.kills,
									assists: p.scores.assists,
									creepScore: p.scores.creepScore
								},
							takedowns: {
								champions: takedownsOf(p)?.champions.size ?? 0,
								epicMonsters: takedownsOf(p)?.epicMonsters ?? 0
							}
						}))
					});
				} catch {
					resolve(null);
				}
			});
		});
		req.on('timeout', () => req.destroy());
		req.on('error', () => resolve(null));
	});
}

async function refreshGameConstants() {
	const data = await loadGameConstants();
	if (!data) return;
	gameConstants = data;
	if (win && !win.isDestroyed()) win.webContents.send('game-constants', data);
	updateTrayMenu();
}

async function poll() {
	// in a match, or else on its loading screen
	const data = (await fetchGameData()) ?? (await fetchLoadingData());
	const nowInGame = data !== null;

	if (win && !win.isDestroyed()) {
		if (nowInGame !== inGame) {
			if (nowInGame) {
				win.showInactive();
				// a new patch may have been released since the app started
				refreshGameConstants();
			} else {
				win.hide();
			}
		}
		win.webContents.send('game-data', data);
	}
	if (nowInGame !== inGame) {
		inGame = nowInGame;
		updateTrayMenu();
	}

	setTimeout(poll, POLL_INTERVAL);
}

const boundsFile = () => path.join(app.getPath('userData'), 'window-position.json');

function loadPosition() {
	try {
		const { x, y } = JSON.parse(fs.readFileSync(boundsFile(), 'utf8'));
		// ignore saved positions that are off every screen (e.g. monitor unplugged)
		const visible = screen
			.getAllDisplays()
			.some(({ workArea: a }) => x >= a.x && y >= a.y && x < a.x + a.width && y < a.y + a.height);
		return visible ? { x, y } : null;
	} catch {
		return null;
	}
}

function savePosition() {
	if (!win) return;
	const [x, y] = win.getPosition();
	fs.writeFileSync(boundsFile(), JSON.stringify({ x, y }));
}

function createWindow() {
	const { workArea } = screen.getPrimaryDisplay();
	const position = loadPosition() ?? {
		x: workArea.x + workArea.width - WINDOW_WIDTH - 8,
		y: workArea.y + Math.round(workArea.height / 3)
	};

	win = new BrowserWindow({
		...position,
		width: WINDOW_WIDTH,
		height: WINDOW_HEIGHT,
		frame: false,
		transparent: true,
		resizable: false,
		maximizable: false,
		hasShadow: false,
		skipTaskbar: true,
		alwaysOnTop: true,
		// don't steal keyboard focus from the game when the overlay is clicked
		focusable: false,
		show: false,
		webPreferences: {
			preload: path.join(__dirname, 'preload.cjs')
		}
	});
	win.setAlwaysOnTop(true, 'screen-saver');
	win.on('moved', savePosition);
	if (SELF_TEST) {
		// renderer errors and warnings, e.g. a crash while drawing the overlay
		win.webContents.on('console-message', (event, legacyLevel, legacyMessage) => {
			const level = event.level ?? legacyLevel;
			const message = event.message ?? legacyMessage;
			if (level === 'warning' || level === 'error' || level >= 2) logDebug(`[${level}] ${message}`);
		});
		win.webContents.on('render-process-gone', (_event, details) =>
			logDebug(`[renderer gone] ${details.reason}`)
		);
	}
	win.webContents.on('did-finish-load', () => {
		if (gameConstants) win?.webContents.send('game-constants', gameConstants);
	});

	win.loadURL(DEV_URL ?? 'app://overlay/');
}

function toggleOverlay() {
	if (!win) return;
	if (win.isVisible()) {
		win.hide();
	} else {
		win.showInactive();
	}
	updateTrayMenu();
}

// Start with Windows, only for the packaged app (a dev run would register the bare electron.exe)
const startupMarker = () => path.join(app.getPath('userData'), 'startup-initialized');
// the exe is the stock electron.exe, so name the startup entry explicitly (else "electron.app.Electron")
// the self-test build has its own entry, else it would take over the one of the normal app
const LOGIN_ITEM = {
	path: process.execPath,
	name: SELF_TEST ? 'LOL Chat Timer Selftest' : 'LOL Chat Timer'
};

// Reads the startup entry from the registry: app.getLoginItemSettings() never finds it, it looks up
// the default entry name and fails to match an exe path with spaces ("LOL Chat Timer.exe").
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
function opensAtLogin() {
	try {
		const entry = execFileSync('reg', ['query', RUN_KEY, '/v', LOGIN_ITEM.name], {
			encoding: 'utf8',
			windowsHide: true,
			stdio: ['ignore', 'pipe', 'ignore']
		});
		return entry.toLowerCase().includes(process.execPath.toLowerCase());
	} catch {
		// no entry
		return false;
	}
}

function setOpenAtLogin(openAtLogin) {
	app.setLoginItemSettings({ ...LOGIN_ITEM, openAtLogin });
	updateTrayMenu();
}

// turned on the first time the app runs, the tray menu turns it off
function initOpenAtLogin() {
	// the self-test build only starts by hand
	if (!app.isPackaged || SELF_TEST || fs.existsSync(startupMarker())) return;
	setOpenAtLogin(true);
	fs.writeFileSync(startupMarker(), '');
}

function updateTrayMenu() {
	if (!tray) return;
	tray.setToolTip(inGame ? 'LOL Chat Timer - in game' : 'LOL Chat Timer - waiting for a match');
	tray.setContextMenu(
		Menu.buildFromTemplate([
			{ label: inGame ? 'In game' : 'Waiting for a match...', enabled: false },
			{
				label: gameConstants ? `Patch data: ${gameConstants.version}` : 'Patch data: built-in',
				enabled: false
			},
			{ type: 'separator' },
			{ label: win?.isVisible() ? 'Hide overlay' : 'Show overlay', click: toggleOverlay },
			{
				label: 'Start with Windows',
				type: 'checkbox',
				enabled: app.isPackaged && !SELF_TEST,
				checked: !SELF_TEST && opensAtLogin(),
				click: (item) => setOpenAtLogin(item.checked)
			},
			{ label: 'Quit', click: () => app.quit() }
		])
	);
}

if (!app.requestSingleInstanceLock()) {
	app.quit();
} else {
	app.whenReady().then(() => {
		protocol.handle('app', (request) => {
			const { pathname } = new URL(request.url);
			let file = path.join(BUILD_DIR, decodeURIComponent(pathname));
			if (!file.startsWith(BUILD_DIR + path.sep)) {
				return new Response('Forbidden', { status: 403 });
			}
			if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
				file = path.join(BUILD_DIR, 'index.html');
			}
			return net.fetch(pathToFileURL(file).toString());
		});

		createWindow();

		tray = new Tray(TRAY_ICON);
		tray.on('click', toggleOverlay);
		initOpenAtLogin();
		updateTrayMenu();

		ipcMain.on('overlay:hide', () => {
			win?.hide();
			updateTrayMenu();
		});
		// chat macro: the overlay builds the message from its timers
		inputHelper = startInputHelper(() => win?.webContents.send('macro:trigger'));
		ipcMain.on('macro:send', (_event, text) => {
			if (typeof text === 'string' && text) inputHelper?.typeChat(text);
		});
		ipcMain.on('overlay:set-macro-key', (_event, vk, mods) => inputHelper?.setHotkey(vk, mods));
		app.on('before-quit', () => inputHelper?.stop());

		// the window is as large as the overlay content, so it never covers the game around it
		ipcMain.on('overlay:set-size', (_event, width, height) => {
			if (!win || win.isDestroyed()) return;
			const clamp = (n) => Math.min(Math.max(Math.round(Number(n)) || 0, 20), MAX_WINDOW_SIZE);
			const [w, h] = [clamp(width), clamp(height)];
			const [currentWidth, currentHeight] = win.getContentSize();
			if (w !== currentWidth || h !== currentHeight) win.setContentSize(w, h);
		});

		// the settings inputs need keyboard focus, the timers don't
		ipcMain.on('overlay:set-focusable', (_event, focusable) => {
			if (!win) return;
			win.setFocusable(focusable);
			if (focusable) win.focus();
		});

		refreshGameConstants();
		poll();
	});

	// keep running in the tray when the overlay is hidden
	app.on('window-all-closed', () => {});
}
