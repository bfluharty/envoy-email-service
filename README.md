# envoy-email-service

Lambda + HTTP API for **inbox and send-on-behalf only**: send email as the customer (Gmail/Outlook), list inbox messages, and fetch a single message. Transactional email (e.g. password reset) is sent by envoy-project-management via Resend, not this service.

**No OpenAI or other AI integration.** This service only processes emails (Gmail API, Microsoft Graph). All AI lives in **envoy-project-management**.

## Endpoints

- `POST /send-on-behalf` – send email as the customer (Gmail/Outlook)
- `POST /inbox/list` – list messages in connected inbox
- `POST /inbox/message` – get one message body

## Local (AWS SAM)

**Option A – install at repo root, then copy (recommended; avoids npm hanging in EmailFunction):**

```bash
npm install && npm run prepare-lambda && sam build && sam local start-api --port 3000
```

- **npm install** (at repo root) – Installs Lambda deps here so `EmailFunction/` doesn’t need to run npm (which can hang on large deps).
- **npm run prepare-lambda** – Copies `node_modules` into `EmailFunction/`.
- **sam build** – Copies the function (no npm install).
- **sam local start-api** – Runs the HTTP API on port 3000.

**Option B – install inside EmailFunction:**  
If you prefer to install in the function dir, run `cd EmailFunction && npm install` once. `EmailFunction/.npmrc` is set to reduce timeouts and prompts. If it still hangs, use Option A.

Set `EMAIL_SERVICE_URL` (and optionally `EMAIL_SERVICE_API_KEY`) in envoy-project-management `.env`.

## Layout (AWS guidelines)

- **EmailFunction/** – Single Lambda: handler and dependencies live here.
  - `index.js` – Lambda entry (`Handler: index.handler`), routes to send-on-behalf and inbox.
  - `sendOnBehalf.js`, `inbox.js` – Gmail/Microsoft logic.
  - `package.json` – `"type": "module"`, dependencies only. SAM runs `npm install` during build.
- **template.yaml** – SAM template; `CodeUri: EmailFunction`, `Runtime: nodejs20.x`.
