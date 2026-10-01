# LOL Chat Timer

Desktop overlay (Electron) to track opponent summoner spell and ultimate (R) cooldowns in League of Legends. No Overwolf required.

## Features

- Shows the enemy team's champions, summoner spells and R automatically, using the game's [Live Client Data API](https://developer.riotgames.com/docs/lol#game-client-api_live-client-data-api)
- Click to start a cooldown timer
- Summoner spell haste: Ionian Boots of Lucidity (and Crimson Lucidity) are detected from the enemy items, Cosmic Insight can be ticked by hand
- Overlay shows up on the loading screen (from the League Client) and hides when the match ends

## How to use

1. Run the app (see below). It sits in the system tray until a match starts. The packaged app starts with Windows (untick "Start with Windows" in the tray menu to stop it).
2. Set the game to **Borderless** or **Windowed** display mode. The overlay can't draw over exclusive Fullscreen.
3. When an enemy uses a spell, left click its icon on the overlay to start the timer.
4. Next to each enemy portrait, tick the boots and Cosmic Insight icons to reduce their summoner spell cooldowns. You can already do it on the loading screen, the ticks carry over to the match.
   - Boots are ticked automatically (gold border) once the enemy buys them.
   - Only the enemy rune trees are known, not the individual runes, so Cosmic Insight can't be detected. The icon is disabled when the enemy has no Inspiration tree.
5. On a running timer: left click to remove/reset, right click to reduce 5 seconds, middle click to increase 5 seconds.
6. Press the chat macro key (default `T`) in game to send the running timers to your team, one chat line per enemy lane, with the game clock time each spell is back up:
   ```
   top F 05:00 | R 05:00
   jg Smite 02:15 | F 04:40
   ```
   Lanes are `top`, `jg`, `mid`, `ad`, `sp`. They come from the game in role-based queues; otherwise the Smite user is `jg` and the others follow the scoreboard order.
   - The key is only caught while the game window is focused and the chat is closed, so you can still type it in chat.
   - Change it in the settings (gear button): click the key button, then press a key or combination. Backspace turns the macro off.
7. Drag the header to move the overlay (the position is remembered). The gear button opens the settings, the `x` hides the overlay; click the tray icon to show it again.

## Requirements

- Node version >=18

## Getting started

```sh
# install dependencies
npm i

# build the UI and start the overlay
npm start

# start the overlay with the existing build
npm run electron

# develop the UI in a browser with a sample match (http://localhost:5173)
npm run dev

# run the overlay against the dev server (run `npm run dev` first)
npm run electron:dev

# package the app into dist/win-unpacked ("LOL Chat Timer.exe")
npm run dist

# refresh the built-in patch data snapshot (src/data/gameConstants.json)
npm run update-data
```

The packaged `LOL Chat Timer.exe` is the unmodified, unsigned Electron binary (no custom exe icon, no asar) so Windows Smart App Control, which blocks unknown unsigned executables, still recognizes it.

## Cooldowns

Ultimate (R) and summoner spell cooldowns come from Riot's [Data Dragon](https://developer.riotgames.com/docs/lol#data-dragon) for the latest patch. The app checks for a new patch on startup and at the start of every match, and caches the data in `%APPDATA%\lol-chat-timer`. Without internet it uses the cache, or the snapshot built into the app.

The R rank is estimated from the enemy's level (6/11/16). Ability haste is not taken into account.

## Data

LOL Chat Timer is using [Community Dragon](https://www.communitydragon.org/) data.

### Champion Icons

https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champion-summary.json

### Champion Skills

https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/champions/

### Summoner Spells

https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/summoner-spells.json
