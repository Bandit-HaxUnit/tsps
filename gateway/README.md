# Gateway

Lets the official OSRS client (revision 241, launched through [RSProx](https://github.com/blurite/rsprox))
play on tsps. The gateway speaks the OSRS protocol to the client with
[rsprot](https://github.com/blurite/rsprot) and opens one tsps WebSocket session per player, the
same way the browser client does, translating both ways.

```
official client ── RSProx ── TCP ──▶ gateway (GATEWAY_PORT) ── WebSocket ──▶ tsps (WEBSOCKET_PORT)
```

## Running

```bash
yarn start          # tsps, as usual
yarn gateway        # the gateway, in a second terminal
yarn gateway:test   # unit tests; integration tests need `yarn start` running in this checkout
```

The gateway reads its ports from the root `.env`, the same block `scripts/wt` writes
([docs/worktrees.md](../docs/worktrees.md)): `GATEWAY_PORT` (43595 in the main checkout, 43900 + N
in slot N) and `WEBSOCKET_PORT`. It serves JS5 from the cache in `server/target.txt`.

The login key is generated on first start into `gateway/keys/rsa.txt` (not committed). Startup
prints its modulus for the RSProx target.

Gradle runs on any JDK 11+ and builds with a JDK 17 toolchain.

## Layout

| Package | What |
| --- | --- |
| `config` | `.env` and `server/target.txt` |
| `crypto` | the login RSA key |
| `cache` | dat2/idx reader, containers, reference tables, the JS5 master index |
| `session` | per-player state; `EntityWorld` is one rsprot player/NPC/world-entity world per client |

## How it maps tsps to OSRS

[COVERAGE.md](COVERAGE.md) lists every tsps message and client opcode, the revision-241 packet it
becomes, and whether it is mapped, dropped (with a reason) or still to do.

Each official client gets its own rsprot entity world. tsps decides who a player sees, so the
gateway mirrors exactly that view rather than letting rsprot work out visibility.
