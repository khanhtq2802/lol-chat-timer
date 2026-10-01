// Reads the players of the match being loaded from the League Client API (LCU).
// The Live Client Data API only starts once the match does, the LCU already knows the teams on the loading screen.
const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');

const DEFAULT_INSTALL_DIR = 'C:/Riot Games/League of Legends';
const PRODUCT_SETTINGS =
	'C:/ProgramData/Riot Games/Metadata/league_of_legends.live/league_of_legends.live.product_settings.yaml';
// gameflow phases where the match exists but the game has not started yet
const LOADING_PHASES = ['GameStart', 'InProgress'];

// the LCU serves a self-signed Riot certificate on localhost
const agent = new https.Agent({ rejectUnauthorized: false });

let installDir;
// the logged in account, per client session (the password changes when the client restarts)
let currentSummoner = { password: null, puuid: null };

function getInstallDir() {
	if (installDir) return installDir;
	try {
		const settings = fs.readFileSync(PRODUCT_SETTINGS, 'utf8');
		installDir = settings.match(/product_install_full_path:\s*"?([^"\r\n]+)"?/)?.[1];
	} catch {
		// Riot metadata not found
	}
	installDir ??= DEFAULT_INSTALL_DIR;
	return installDir;
}

// The lockfile only exists while the client is running: "LeagueClient:<pid>:<port>:<password>:https"
function readLockfile() {
	try {
		const [, , port, password] = fs
			.readFileSync(path.join(getInstallDir(), 'lockfile'), 'utf8')
			.split(':');
		return { port, password };
	} catch {
		return null;
	}
}

function request(credentials, endpoint) {
	return new Promise((resolve) => {
		const req = https.get(
			{
				host: '127.0.0.1',
				port: credentials.port,
				path: endpoint,
				agent,
				timeout: 1500,
				auth: `riot:${credentials.password}`
			},
			(res) => {
				let body = '';
				res.setEncoding('utf8');
				res.on('data', (chunk) => (body += chunk));
				res.on('end', () => {
					try {
						resolve(res.statusCode === 200 ? JSON.parse(body) : null);
					} catch {
						resolve(null);
					}
				});
			}
		);
		req.on('timeout', () => req.destroy());
		req.on('error', () => resolve(null));
	});
}

/**
 * Returns the teams of the match on the loading screen, or null when there is none.
 * @returns {Promise<{ source: 'loading', myTeam: 'ORDER' | 'CHAOS' | null, players: { team: 'ORDER' | 'CHAOS', championId: number, position?: string, spell1Id?: number, spell2Id?: number }[] } | null>}
 */
async function fetchLoadingData() {
	const credentials = readLockfile();
	if (!credentials) return null;

	const session = await request(credentials, '/lol-gameflow/v1/session');
	if (!session || !LOADING_PHASES.includes(session.phase)) return null;

	const { teamOne = [], teamTwo = [], playerChampionSelections = [] } = session.gameData ?? {};
	if (teamOne.length === 0 && teamTwo.length === 0) return null;

	if (currentSummoner.password !== credentials.password || !currentSummoner.puuid) {
		const summoner = await request(credentials, '/lol-summoner/v1/current-summoner');
		currentSummoner = { password: credentials.password, puuid: summoner?.puuid };
	}
	const currentPuuid = currentSummoner.puuid;

	const toPlayer = (team) => (p) => {
		const selection = playerChampionSelections.find(
			(s) => (s.puuid && s.puuid === p.puuid) || s.championId === p.championId
		);
		return {
			team,
			championId: p.championId,
			// TOP, JUNGLE, MIDDLE, BOTTOM, UTILITY, or NONE outside role-based queues
			position: p.selectedPosition,
			spell1Id: selection?.spell1Id,
			spell2Id: selection?.spell2Id
		};
	};

	let myTeam = null;
	if (teamOne.some((p) => p.puuid && p.puuid === currentPuuid)) myTeam = 'ORDER';
	if (teamTwo.some((p) => p.puuid && p.puuid === currentPuuid)) myTeam = 'CHAOS';

	return {
		source: 'loading',
		myTeam,
		players: [...teamOne.map(toPlayer('ORDER')), ...teamTwo.map(toPlayer('CHAOS'))].filter(
			(p) => p.championId > 0
		)
	};
}

module.exports = { fetchLoadingData };
