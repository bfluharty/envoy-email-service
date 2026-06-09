/**
 * Thin HTTP wrapper around the Lambda handler for local Docker development.
 * Converts incoming HTTP requests into Lambda-style events and returns the response.
 */
import { createServer } from 'node:http'
import { handler } from './index.js'

const PORT = process.env.PORT ?? 3000

const server = createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const rawBody = Buffer.concat(chunks).toString('utf8')

  const event = {
    requestContext: {
      http: {
        method: req.method,
        path: req.url,
      },
    },
    rawPath: req.url,
    headers: req.headers,
    body: rawBody || null,
    isBase64Encoded: false,
  }

  const result = await handler(event)

  res.writeHead(result.statusCode, result.headers ?? {})
  res.end(result.body ?? '')
})

server.listen(PORT, () => {
  console.log(`envoy-email-service listening on port ${PORT}`)
})
