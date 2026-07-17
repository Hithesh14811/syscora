# SYSCORA

SYSCORA is a local-first AI operating layer for turning user intent into typed, policy-controlled system actions.

This repository currently contains the first secure MVP vertical slice:

- natural-language intent for project environment variables
- structured planning
- capability selection from a registry
- deterministic risk and policy evaluation
- approval gating
- typed execution through a Linux-oriented project environment adapter
- structured observation and verification
- append-only audit events
- rollback support for `.env` changes
- session persistence across daemon restarts
- local MVP desktop-style frontend served by daemon

## Run the MVP

```bash
node apps/cli/src/index.js set-env --workspace . --key OPENAI_API_KEY --value demo --approve
```

Inspect persisted sessions:

```bash
node apps/daemon/src/index.js sessions
```

Run tests:

```bash
node --test tests/unit/*.test.js
```

## Run the frontend MVP

Start the local daemon + frontend:

```bash
npm run mvp:ui
```

Then open:

```text
http://127.0.0.1:4317
```

Use the intent form to run the secure env-variable workflow and inspect session history.
