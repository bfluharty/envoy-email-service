# Docker Workflows

Email Service has two Dockerfiles:

- `Dockerfile` builds the production AWS Lambda container image.
- `Dockerfile.dev` builds a local development container that runs the HTTP
  wrapper.

## Production Lambda Image

Build the image:

```bash
docker build -t envoy-email-service .
```

The production Dockerfile:

1. Uses Node 22 to install dependencies and build TypeScript.
2. Installs production dependencies separately.
3. Uses `public.ecr.aws/lambda/nodejs:22` for the final runtime image.
4. Copies `dist/` and production `node_modules`.
5. Sets Lambda handler command to `dist/index.handler`.

This image is intended for AWS Lambda, not ordinary `docker run` local serving.

## Development Image

Build:

```bash
docker build -f Dockerfile.dev -t envoy-email-service-dev .
```

Run:

```bash
docker run --rm -p 8083:8083 --env-file .env envoy-email-service-dev
```

`Dockerfile.dev` installs dependencies, exposes port `8083`, and runs
`npm run start`.

## Full Envoy Stack

Project Management's Compose workflow starts Email Service alongside Project
Management, Reasoning Engine, and PostgreSQL:

```bash
cd ../envoy-project-management
./run-docker.sh
```

Expected sibling layout:

```text
envoy/
  envoy-project-management/
  reasoning-engine/
  envoy-email-service/
```

The Compose service:

- Builds from `../envoy-email-service/Dockerfile.dev`.
- Loads environment from `../envoy-email-service/.env`.
- Maps port `8083:8083`.

## Ports

| Context                  | Port                          |
| ------------------------ | ----------------------------- |
| Native local wrapper     | `8083`                        |
| Development Docker       | `8083`                        |
| Full Envoy Compose stack | `8083`                        |
| AWS Lambda/API Gateway   | Managed by API Gateway/Lambda |

## Rebuilding

Rebuild after dependency changes:

```bash
docker build -f Dockerfile.dev -t envoy-email-service-dev .
```

When using Project Management Compose:

```bash
cd ../envoy-project-management
docker compose build email-service
./run-docker.sh
```

## Troubleshooting

If internal routes unexpectedly return `401`, check whether
`EMAIL_SERVICE_API_KEY` is set and whether the caller sends the matching bearer
token from SSM.

If webhook calls return `500`, check `EMAIL_SYNC_QUEUE_URL`, AWS credentials, and
SQS permissions.

If Gmail watch setup fails, check `GMAIL_PUBSUB_TOPIC` and Gmail API
permissions.

If Microsoft watch setup or webhook verification fails, check
`MICROSOFT_GRAPH_NOTIFICATION_URL`, `MICROSOFT_GRAPH_LIFECYCLE_URL`, and
`MICROSOFT_GRAPH_CLIENT_STATE_SECRET`.
