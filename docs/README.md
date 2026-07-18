# Envoy Email Service Documentation

This directory contains detailed documentation for Envoy Email Service. The root
README is the quick-start and orientation document; these docs hold longer
implementation, contract, and operations notes.

## Development Docs

- [Architecture overview](architecture.md): runtime shape, service boundaries,
  request flow, provider adapters, webhooks, SQS publishing, and deployment.
- [API reference](api.md): HTTP routes, authentication, request payloads,
  response envelopes, webhook challenges, and status codes.
- [Contracts and provider behavior](contracts.md): TypeScript DTOs, provider
  differences, normalized message shapes, watch results, and sync events.
- [Local development](development/local-development.md): prerequisites,
  environment variables, local startup, provider token notes, and full-stack
  usage.
- [Docker workflows](development/docker.md): Lambda image, development image,
  local ports, and Project Management Compose integration.
- [Testing guide](development/testing.md): Vitest suites, CI behavior, and what
  to test for provider/webhook changes.
- [Contributing guide](development/contributing.md): expectations for tests,
  provider adapters, webhook handling, security, and PRs.

## Documentation Rules

Update documentation in the same PR as code when any of these change:

- HTTP routes, request contracts, response envelopes, status codes, or auth
  behavior.
- Gmail or Microsoft adapter behavior.
- Webhook validation, Microsoft `clientState`, or SQS event payloads.
- Environment variables, SSM parameters, IAM requirements, Docker behavior, or
  deployment flow.
- Test commands, provider fixtures, or full-stack setup.
