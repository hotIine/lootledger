# Loot Ledger

Desktop app for checking Albion Online ZvZ loot against the guild chest. It logs who picked up what during a fight, then compares that with the chest log to show what each player still owes.

- Live loot logging (or import StatisticsAnalysis loot log exports)
- Merges logs from several loggers, with clock drift handled
- Tracks deaths, items taken from bodies, and hand-offs to officers
- Silver values from the game, with market prices as a fallback
- Copy a player's card as an image to paste into Discord

## Requirements

- Windows 10 or 11
- [Npcap](https://npcap.com/#download) for live logging. The default install options are fine. Without Npcap you can still import loot log files.

The capture program only listens to game traffic on UDP port 5056. It doesn't send anything or touch the game client.

## Usage

1. Download `LootLedger.exe` from [Releases](../../releases/latest) and run it. It's a portable exe, so there's nothing to install.
2. Click **Start logging** before you zone into the fight map. Players are only tagged with their guild when they come into view, so starting mid-map leaves some of them untagged.
3. After the fight, copy the chest log in game and paste it into **Paste chest log here**, then click **Add chest log**. Paste more pages or tabs if needed.

Live logs are saved to `Documents\Loot Ledger`. Loot log CSVs from other loggers (Loot Ledger or StatisticsAnalysis) can be added with **Add loot log files**.

## Building from source

Requires:

- Node.js 20+
- Go 1.23+
- A bash shell (Linux, WSL, macOS or Git Bash). The build script uses POSIX syntax.

```sh
npm install
npm run package
```

This cross-compiles the capture program for Windows and writes `dist/build/LootLedger.exe`.

## After a game patch

- **Item names wrong or missing:** the app downloads the latest item list on startup. To update the bundled copy, run `npm run update-items`.
- **Logging stops picking up loot or deaths:** the patch probably shifted event codes. Update `capture/events.json` and rebuild. To find the new numbers, build a console version (`cd capture && GOOS=windows go build -o capture.exe .`) and run `capture.exe -probe` on Windows. It records every event to `capture-test.jsonl`.

## Credits

- `capture/photon` is from [albiondata-client](https://github.com/ao-data/albiondata-client) (MIT).
- Item and map data come from [ao-bin-dumps](https://github.com/ao-data/ao-bin-dumps).
- Event layouts are based on [StatisticsAnalysis](https://github.com/Triky313/AlbionOnline-StatisticsAnalysis).
