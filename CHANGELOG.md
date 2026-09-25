# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Semantic Theme Engine:** 8 theme families (Ember, Obsidian, Crimson, Cyberpunk, Forest, Lavender, Midnight, Paper) with light and dark mode palettes, WCAG AA contrast compliance, and pre-hydration theme bootstrap.
- **7 Vessel Orb Forms:** Interactive animated lamps (Sphere, Torus, Prism, Wave, Morph, Flame, Crystal) with WebGL Signed Distance Field (SDF) shaders, audio reactivity, and spring physics.
- **Voice Activity Detection (VAD):** Timestamp-driven state hysteresis, ambient noise microphone calibration, and sentence-boundary text-to-speech streaming.
- **Voice Changer Pipeline:** Dedicated Venice speech-to-speech audio converter with quote calculation, single-job queueing, polling, and media playback.
- **Reusable Profiles:** Create, save, and switch named configuration profiles with inline chat badges.
- **Workspace Portability:** Full chat history and settings export/import with JSON schema validation and atomic writes.
- **System Diagnostics:** In-app telemetry modal for Web Audio context state, microphone latency, and Venice API catalog connectivity.
- **Message Branching:** Fork and replay alternative conversation branches at any prompt turn.
- **CI/CD & Security Hardening:** GitHub Actions workflows for CI, Docs, CodeQL static analysis, OpenSSF Scorecard, and automated releases.
- **License & Governance:** Apache License 2.0, CODEOWNERS, Code of Conduct, security policy, and contributing guidelines.
