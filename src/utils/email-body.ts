function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'");
}

function htmlToText(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(div|p|li|tr|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, '')
  );
}

function stripQuotedText(value: string): string {
  return value
    .replace(/\nOn .+ wrote:\s*[\s\S]*$/i, '')
    .replace(/\nFrom:\s*[\s\S]*$/i, '')
    .replace(/\n-{2,}\s*Original Message\s*-{2,}[\s\S]*$/i, '')
    .replace(/\n_{5,}[\s\S]*$/i, '')
    .replace(/\n>[\s\S]*$/i, '');
}

function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractLatestEmailBody(body: string): string {
  const withoutQuotedHtml = body
    .replace(/<div[^>]*class=["'][^"']*gmail_quote[\s\S]*$/i, '')
    .replace(/<blockquote[\s\S]*$/i, '')
    .replace(/<hr[^>]*>[\s\S]*$/i, '');

  return normalizeWhitespace(stripQuotedText(htmlToText(withoutQuotedHtml)));
}
