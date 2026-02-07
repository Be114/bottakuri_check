# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Added

- Worker internal module split into handlers/services/domain/utils for maintainability.
- Vitest test suites for frontend loading state, worker logic, and worker API routes.
- CI workflow (`.github/workflows/ci.yml`) with build, typecheck, and test gates.
- OpenAPI spec at `/Users/bentaku/bottakuri_check/docs/openapi.yaml`.
- Contributing guide at `/Users/bentaku/bottakuri_check/CONTRIBUTING.md`.

### Changed

- Worker now adds `requestId` in error responses and `X-Request-Id` response header.
- Worker now applies timeout control for Google Places and OpenRouter upstream calls.
- Worker health metrics now include `errorCount`.
- Worker request logs are structured JSON logs.
