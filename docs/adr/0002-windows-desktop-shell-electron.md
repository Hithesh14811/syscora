# ADR 0002: Windows Desktop Shell via Electron

## Status
Accepted

## Context
SYSCORA MVP requires a real Windows desktop shell. The repository currently uses a daemon-served local web UI for fast iteration.
We need a Windows-only desktop application that can be installed and launched reliably, while preserving the existing Node.js daemon/runtime.

## Decision
Use **Electron** for the Windows desktop shell for the MVP.

## Rationale
- Fastest path to a coherent, demoable Windows desktop app without destabilizing the runtime.
- Allows embedding the existing authenticated local UI while the frontend matures to a full React/TypeScript client.
- Keeps OS control and policy enforcement in the daemon; the desktop shell is a client only.

## Consequences
- Adds Electron dependency and build packaging work.
- A later migration to Tauri remains possible after the MVP, once daemon/API and UI stabilize.
