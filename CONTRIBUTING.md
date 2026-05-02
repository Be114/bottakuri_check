# Contributing

## Scope and guardrails

- Keep UI simple. Do not add history or login features; ranking features should stay limited to nearby restaurant discovery.
- Keep model fixed to `google/gemini-3.1-flash-lite-preview`.
- Never expose API keys to frontend code.

## Local setup

### Frontend

```bash
npm install
npm run dev
```

### Worker API

```bash
npm --prefix worker install
npm run dev:api
```

## Quality checks

Run all checks before opening a PR:

```bash
npm run build
npm --prefix worker run build
npm run lint
npm run format:check
npm run typecheck
npm run typecheck:worker
npm run test
```

## Testing policy

- Add tests for all Worker behavior changes.
- Add or update lint/format coverage when introducing new source files.
- Preserve API compatibility unless a breaking change is explicitly approved.
- Prefer unit tests for deterministic logic and route tests for API behavior.

## Commit policy

- Keep commits small and single-purpose.
- Use conventional-style messages, for example:
  - `refactor(worker): ...`
  - `test: ...`
  - `ci: ...`
  - `feat(worker): ...`
  - `docs: ...`

## Pull request checklist

- [ ] Frontend build passes.
- [ ] Worker build passes.
- [ ] Typecheck passes for root and worker.
- [ ] Tests pass.
- [ ] API behavior remains compatible.
- [ ] Documentation updated when behavior/contract changed.
- [ ] CodeRabbit review feedback was reviewed and reflected.

## Code review with CodeRabbit

- This repository uses [`.coderabbit.yaml`](.coderabbit.yaml).
- Automatic review is enabled for PRs targeting `main`.
- Optional manual commands in PR comments:
  - `@coderabbitai review`
  - `@coderabbitai full review`
