// Refreshes the built-in game constants (src/data/gameConstants.json) from the latest patch.
// The app also updates them at runtime; this snapshot is used until the first download succeeds.
const fs = require('node:fs');
const path = require('node:path');
const { download, fetchJson, DDRAGON } = require('./gameConstants.cjs');

(async () => {
	const [latest] = await fetchJson(`${DDRAGON}/api/versions.json`);
	const data = await download(latest);
	const file = path.join(__dirname, '..', 'src', 'data', 'gameConstants.json');
	fs.writeFileSync(file, JSON.stringify(data));
	console.log(
		`wrote ${Object.keys(data.champions).length} champions for patch ${latest} to ${file}`
	);
})();
