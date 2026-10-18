# Architecture Decision Records (ADRs)

This directory holds the Architecture Decision Records for the DS5 Dongle OLED Edition Configurator (web + desktop).

## What is an ADR?

An ADR records one important architectural decision: the context that forced it, what was decided, and what it costs.

## ADR Index

| ID                                         | Title                                                   | Status   | Date       |
| ------------------------------------------ | ------------------------------------------------------- | -------- | ---------- |
| [0001](0001-vendor-usb-transport.md)        | Vendor-class USB interface over WebUSB as the transport | Accepted | 2026-10-10 |
| [0002](0002-dual-browser-desktop-target.md) | One codebase, browser and Electron targets              | Superseded | 2026-10-10 |
| [0003](0003-update-manifest.md)             | Self-update from a repo-hosted `latest.json` manifest   | Accepted | 2026-10-10 |
| [0004](0004-linux-sandbox-and-gpu.md)       | Linux: Chromium sandbox under AppArmor, NVIDIA GPU      | Accepted | 2026-10-10 |
| [0005](0005-releases-on-the-firmware-repo.md) | Releases on the firmware repo; the app bundles the firmware | Accepted | 2026-10-10 |

## Creating a New ADR

1. Copy `template.md` to `NNNN-short-title.md`
2. Fill in the sections
3. Set status to "Proposed"
4. Update status to "Accepted" when approved, and add it to the index above

## ADR Lifecycle

```
Proposed → Accepted → [Deprecated | Superseded]
```

## References

- [ADR GitHub Organization](https://adr.github.io/)
- [Michael Nygard's original article](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)
