# Codex project instructions

This repository contains an open-source, offline-first cross-platform PDF viewer and annotation editor. Read docs/REQUIREMENTS.md, docs/ARCHITECTURE.md, and docs/CODEX_TASK_001.md before implementing changes.

## Non-negotiable product rules
- PDF contents must be processed locally on the user's device; no upload, analytics, telemetry, accounts, external conversion APIs, or hidden server dependency.
- Preserve existing PDF content and unsupported annotations; never flatten editable annotations as a substitute for native PDF objects.
- Existing annotations from third-party tools should be editable for supported types; unsupported types should stay intact.
- The user must not need a local development environment. Provide browser preview and downloadable CI build artifacts.
- Optimize mouse-wheel zoom at pointer position and reliable middle-button pan. Distinguish physical mouse-wheel from trackpad gestures where feasible; user-configurable fallbacks.
- No misleading or nonfunctional controls. Unimplemented capabilities should be absent, disabled, or explicitly labelled.
- Use German for user-facing interface initially; internationalization-ready code is desirable.

## Development workflow
- Work in feature branches and submit focused pull requests; never merge directly into main without review.
- Keep work small and independently testable; prioritize proof of native annotation round-trip before implementing a large editor.
- Record assumptions and relevant version/API limitations in the PR.
- Use TypeScript strict mode, linting, unit tests and end-to-end browser tests where possible.
- Add automated tests for coordinate conversions, pointer-anchored zoom, annotation read/write and undo/redo.
- Do not claim a feature works merely because it compiles. Verify actual PDFs and document the limitations.
- Document how GitHub Actions builds work; do not require local compilation or terminal use by the owner.
- If a library choice fails licensing or functional requirements, stop and document alternatives rather than silently switching.
- Treat PDFs as untrusted inputs; respect sandboxing, resource limits, malformed PDFs and encrypted documents.
- No credentials or secrets in source control. GitHub Actions permissions: least privilege. Pin critical CI actions to stable immutable versions where practical.
- Do not accidentally commit personal PDFs, generated PDFs containing confidential data, build outputs, or dependency folders.

## Definition of done
Every PR includes: scope, runnable automated checks, test evidence, limitations, and instructions for non-developer review through GitHub or a browser preview. If requirements cannot be met, mark them open explicitly.
