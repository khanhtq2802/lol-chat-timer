const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
	onGameData(callback) {
		const listener = (_event, data) => callback(data);
		ipcRenderer.on('game-data', listener);
		return () => ipcRenderer.removeListener('game-data', listener);
	},
	onGameConstants(callback) {
		const listener = (_event, data) => callback(data);
		ipcRenderer.on('game-constants', listener);
		return () => ipcRenderer.removeListener('game-constants', listener);
	},
	onMacroTrigger(callback) {
		const listener = () => callback();
		ipcRenderer.on('macro:trigger', listener);
		return () => ipcRenderer.removeListener('macro:trigger', listener);
	},
	sendChat(text) {
		ipcRenderer.send('macro:send', text);
	},
	setMacroKey(vk, mods) {
		ipcRenderer.send('overlay:set-macro-key', vk, mods);
	},
	hide() {
		ipcRenderer.send('overlay:hide');
	},
	setSize(width, height) {
		ipcRenderer.send('overlay:set-size', width, height);
	},
	setFocusable(focusable) {
		ipcRenderer.send('overlay:set-focusable', focusable);
	}
});
