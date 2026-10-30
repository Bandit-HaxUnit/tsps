# Experimental RuneLite gateway

Run genuine RuneLite 1.13.3 (native revision 241) against an isolated TSPS world. A local RSProt JVM gateway translates RuneLite's TCP protocol into TSPS's existing WebSocket protocol. TSPS remains authoritative for authentication, gameplay and persistence.

**117 HD is optional.** Normal preparation and launch do not require or download it. This is a developer setup for Windows, with one native connection at a time; it is not a packaged player launcher or complete content compatibility.

## Prerequisites

- A working TSPS checkout, Node 22+, PowerShell 7 and Git Bash for the repository's worktree script.
- JDK 21; set `JAVA_HOME` to its installation directory in each PowerShell terminal, or pass `-JavaHome` to the PowerShell scripts.
- The revision 241 cache `server/caches/osrs-241_2026-10-20`, including its map keys. The worktree helper copies the cache and dependencies from your existing checkout. Run normal repository setup if these are missing.
- Internet access on first preparation/build for pinned RuneLite, RSProx, Gradle and Maven artifacts. Downloaded/patched binaries are stored locally, not included in this PR.

## Create an isolated worktree

From your normal TSPS checkout in Git Bash:

```bash
git fetch https://github.com/UnhealthyKraken/tsps.git feat/runelite-gateway
gateway_commit=$(git rev-parse FETCH_HEAD)
scripts/wt new test/runelite-gateway "$gateway_commit"
cd ../tsps-test-runelite-gateway
```

The immutable commit is captured before the helper fetches upstream. Use a fresh test branch name if `test/runelite-gateway` already exists.

`scripts/wt` assigns a slot and private ports in `.env`. Its copied cache, dependencies and separate `server/data` keep this experiment away from your installed world. Use a new account here. Do not copy or link your live player database into it.

Open three PowerShell terminals in the new worktree. In the gateway and client terminals, calculate the assigned ports:

```powershell
$slot = [int](Select-String -Path .env -Pattern '^WT_SLOT=(\d+)$').Matches.Groups[1].Value
$wsPort = 43700 + $slot
$gamePort = 43800 + $slot
$httpPort = 43900 + $slot
```

## Start TSPS

First terminal:

```powershell
# Build once when server source changed or dist is absent:
node server/node_modules/typescript/bin/tsc --build server
node tools/runelite-gateway/serve-tsps.cjs
```

The launcher enables the opt-in snapshot plugin, forces worktree-local SQLite/legacy paths and disables legacy import. It refuses an installed main checkout, inconsistent slot, external save links or an occupied game port. It never stops an existing process. `--check` prints the resolved setup without starting the server.

## Start the gateway

Second terminal, with `JAVA_HOME` and the calculated ports:

```powershell
./tools/runelite-gateway/start.ps1 -Build -Port $gamePort -HttpPort $httpPort -Upstream "ws://127.0.0.1:$wsPort"
```

`-Build` is needed initially or after gateway source changes. Subsequent unchanged launches can omit it. TCP and HTTP bind loopback only. The gateway reads this worktree's copied cache and creates a disposable local RSA key; it never opens player saves. Default/live ports 43594/3000/49700 are rejected.

## Prepare and open RuneLite

Third terminal, with `JAVA_HOME` and the calculated ports:

```powershell
./tools/runelite-client/prepare.ps1
./tools/runelite-client/start.ps1 -RsaModulusFile tools/runelite-gateway/.runtime/rsa-modulus.txt -GamePort $gamePort -HttpPort $httpPort
```

Preparation verifies artifact sizes/hashes and the actual injected client revision. Launch patches only these local copies with the gateway's RSA/ports/host and uses a separate client home, cache, configuration and OS environment under `tools/runelite-client/.runtime`. It does not change an installed RuneLite profile. The launcher refuses another client using this private runtime.

Log in with a fresh disposable account. Select **All** or **Public** at the bottom to see public messages; a Game-only chat view can persist between sessions.

### Optional 117 HD

Close the client normally, then in the client terminal:

```powershell
./tools/runelite-client/prepare.ps1 -HD
./tools/runelite-client/start.ps1 -RsaModulusFile tools/runelite-gateway/.runtime/rsa-modulus.txt -GamePort $gamePort -HttpPort $httpPort -HD
```

Enable **117 HD** in RuneLite's configuration list on first use. Core GPU and 117 HD are mutually exclusive; RuneLite may require switching from GPU through this toggle. The renderer is pinned to 117 HD 1.6.0, verified against the signed RuneLite 1.13.3 Plugin Hub manifest. Omit `-HD` to use the standard client again.

## Stop

Log out normally and close RuneLite. Stop the gateway terminal, then stop TSPS and wait for `[shutdown] Player persistence completed.` Do not use an installed world's stop script.

## Verified behavior and limits

- Native cache/scene loading and normal TSPS account login; ground/minimap movement; inventory/equipment display and wielding; real NPC Talk-to and dialogue continuation; public chat with the crown before the name; normal logout and saved-position relog.
- These checks used a separate TSPS world and disposable account. Sword/coins and an NPC were controlled QA fixtures, not acquisition tests.
- Three actual keyboard-submitted public messages rendered once each. Native diagnostics also confirmed the chat entry and overhead text. Optional 117 HD rendered the same TSPS world on an RTX 5090; startup alone was not counted as scene verification.
- Focused checks cover observer-filtered snapshots, private-instance visibility/removal, unchanged normal binary packets, fail-closed oversize snapshots, real cache/JS5/Huffman, native inputs, UI/inventory/stat translation, serialized WebSocket writes, chat bursts/index reuse and launcher save isolation. See tool READMEs for commands and pins. No full repository suite was run.
- Compatibility remains incomplete for shops, trade, custom interfaces, dynamic objects/ground items, instances and Sailing. Actor forced movement/custom models and broader remote-chat scenarios need further work. One native connection is supported; login does not establish all-content or gameplay parity.
- Native cache bounds omit browser-only overlay varps 7995-7999 and absent legacy 317 widgets. They cannot be forwarded directly to the native client.

![Native public chat verification](images/runelite-gateway-chat.png)

![Optional 117 HD rendering](images/runelite-gateway-117hd.png)

## Implementation and troubleshooting

- [Gateway](../tools/runelite-gateway/README.md): RSProt version, cache/framing details, configuration and focused checks.
- [Client launcher](../tools/runelite-client/README.md): RuneLite/RSProx/renderer pins, signature verification and private runtime.
- `-TraceInput` on the gateway and `-Diagnostics` on the client enable opt-in debugging; public/game chat text can appear in local logs. Normal launches leave these off. Do not publish private runtime keys, account databases or logs.
