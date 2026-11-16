# AadOS architecture (implementation baseline)

AadOS is **not** Family OS, AJMCP, or AJ Core. The source of truth is `ssnanda/AadOS` on `main`.

| Layer | Agreed direction | Bootstrap status |
| --- | --- | --- |
| Web | SvelteKit 2, Svelte 5, TypeScript, Tailwind 4 | App scaffold, API-backed empty inbox |
| API | Elixir/Phoenix, JSON REST | Health, email overview and read-only stub APIs |
| Jobs/data | Ecto, PostgreSQL/CloudNativePG, Oban; future RLS/pgvector | Dependencies and opt-in Repo/Oban startup; no mail schema yet |
| iOS | SwiftUI, SwiftData, Keychain | Signing-safe build script; application later |
| Identity | WebAuthn, RBAC/ReBAC, encrypted tokens | Not implemented; no public exposure |
| AI | LiteLLM/Ollama/llama.cpp; LangGraph | Later; human approval for all state-changing actions |
| Files | RustFS; later documents | Later |
| Operations | OpenShift oc ImageStreams/BuildConfigs, GitHub Actions; later Argo CD | Binary builds, private-only services and CI (Helm chart retained as reference) |
| Observability | OpenTelemetry/Grafana LGTM | Later |

The initial email experience is provider-agnostic and read-only. Each connector will preserve the source mailbox and enforce account-specific access; token grants will be per-account and stored encrypted at rest. Provider sync and AI classification will run asynchronously once a secure database schema and identity foundation exist.

**Current trust model**: no user authentication or OAuth in v0.1.1. API returns only empty, static connection state. Keep within a trusted development network. Public routes, live connectors and AI handling of personal email are blocked until security gates land.
