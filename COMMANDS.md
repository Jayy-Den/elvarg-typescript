# Command Reference

Every chat command available in this fork, grouped by what it's for. Type commands
in chat with the `::` prefix (`::item 995 1000`). A single `/` also works (`/kit`).

## Getting cheat access

Cheat/admin commands check your **rights** (OWNER or DEVELOPER). The server grants
DEVELOPER automatically at login to any username listed in `DEV_USERNAME`
(git-ignored `.env` at the repo root — currently `Jayden`). Edit that file and
restart the server to promote other accounts.

Not sure what you have? Type `::commands` in game — it lists only what your
account is allowed to use.

## Cheats & fun

| Command | Effect |
|---|---|
| `::max` | All 23 skills to max level (alias for `::master`) |
| `::master` | All 23 skills to max level |
| `::reset` | Reset all skills to level 1 (10 HP) |
| `::kit` | Starter kit: iron gear, 20 lobsters, potions, teleports, 100k coins |
| `::item <id> [amount]` | Spawn an item into your inventory — `::item 995 1000` |
| `::runes` | 1,000 of every rune type |
| `::bank` | Open your bank anywhere |
| `::copybank <player>` | Copy an online player's bank |
| `::spec` | Restore special attack energy |
| `::infhp` | Toggle invulnerability (also blocks poison). **Off by default** |
| `::noclip` | Toggle walking through walls/objects |
| `::unlockprayers` | Unlock all prayers |
| `::gfx <id>` | Play a graphic on your character |
| `::anim <id>` | Play an animation |
| `::sound <id>` | Play a sound effect |
| `::pnpc <npcId>` | Appear as an NPC (`::pnpc -1` to reset) |
| `::glow <preset> [intensity]` | Character glow effect (blood, gold, toxic, ice, royal, infernal, off) |
| `::poisonme [type]` | Poison yourself (testing: super, mild, weak, venom…) |

## NPCs & world

| Command | Effect |
|---|---|
| `::npc <id> [amount]` | Spawn NPC(s) at your position (max 20) — `::npc 9 3` |
| `::npcperm` | Make spawned NPCs permanent (saved to spawns file) |
| `::object <id> [face]` | Spawn a game object |
| `::reloadnpcspawns` | Reload NPC spawn definitions |
| `::reloadnpcdefs` | Reload NPC combat definitions |
| `::reloaddrops` | Reload NPC drop tables |
| `::reloaditems` | Reload item definitions |
| `::reloadshops` | Reload shop definitions |
| `::shop <id>` | Open a shop by id (no id lists available ids) |
| `::npcanim*` | NPC animation scanning tools (`::npcanims`, `::npcanimscan`, …) |

## Teleportation

| Command | Effect |
|---|---|
| `::tele <x> <y> [z]` | Teleport to coordinates |
| `::teleto <player>` | Teleport to an online player |
| `::teletome <player>` | Bring an online player to you |
| `::mypos` | Print your current coordinates |
| `::coords` | Print your current coordinates |

## Account & character

| Command | Effect |
|---|---|
| `::changepassword <new>` | Change your own password |
| `::lockxp` / `::unlockxp` | Toggle experience lock (check current with `::lockxp`) |
| `::title <id>` | Change your loyalty title |
| `::skull` / `::redskull` | Skull yourself (PK timer) |
| `::kdr` | Show your kill/death ratio |
| `::timeplayed` | Show your play time |
| `::presets` | Open the equipment presets interface |

## Moderation (OWNER/DEVELOPER)

| Command | Effect |
|---|---|
| `::kick <player>` | Disconnect a player |
| `::ban <player>` | Ban an account |
| `::unban <player>` | Lift an account ban |
| `::ipban <player>` | Ban an IP address |
| `::ipmute <player>` / `::unipmute <player>` | Mute / unmute an IP |
| `::mute <player>` / `::unmute <player>` | Mute / unmute an account |
| `::yell <message>` | Broadcast to the whole server |
| `::players` / `::online` | List online players |
| `::who <player>` | Look up a player |

## Developer utilities

| Command | Effect |
|---|---|
| `::config <id> <value>` | Set a client config/varp (testing UI states) |
| `::interface <id>` | Force-open an interface |
| `::chatboxinterface <id>` | Show an interface in the chatbox area |
| `::area` | Show which area/zone you're standing in |
| `::atkrange` / `::attackrange` | Show your attack range and debug visuals |
| `::saveall` | Force-save every online player |
| `::update` | Scheduled server update/restart countdown |
| `::up` / `::down` | Move up/down a plane (testing) |
| `::exit` | Shut the server down |
| `::cwar` | Castle Wars debug state |
| `::gesell` | Grand Exchange offer debugging |
| `::flood` | Spawn bot connections (load testing) |
| `::loglevels` / `::logstatus` / `::logtype…` | Adjust server log verbosity live |
| `::taskdebug` | Dump running task diagnostics |
| `::pluginperf` / `::serverperf` | Performance diagnostics |
| `::thread` / `::time` | Server thread/time info |

## Player basics (no rights needed)

| Command | Effect |
|---|---|
| `::commands` | List commands your account can use |
| `::players` | See who's online |
| `::yell <message>` | Server-wide chat |
| `::changepassword <new>` | Change your password |
| `::kdr`, `::timeplayed`, `::title`, `::presets`, `::teleports`, `::store` | Account/character views |

## Notes

- **Health not dropping?** DEVELOPER rights alone no longer make you invulnerable
  — invulnerability is strictly `::infhp` opt-in. Run `::infhp` twice to clear it.
- **`::max` vs `::master`**: both work; they're the same command.
- The kit/gear spawns respect inventory space; stackables (arrows, coins, runes)
  stack, worn gear comes as single items.
- Spawns from `::npc` are temporary until you mark them permanent with `::npcperm`.
