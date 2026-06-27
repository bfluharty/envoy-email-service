import { describe, expect, it } from 'vitest';
import { extractLatestEmailBody } from '../src/utils/email-body.js';

describe('extractLatestEmailBody', () => {
  it('extracts the latest Gmail HTML reply and removes quoted history', () => {
    const body =
      '<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"></head><body><div dir="ltr">thanks for your message</div><br><div class="gmail_quote gmail_quote_container"><div dir="ltr" class="gmail_attr">On Sat, Jun 27, 2026 at 3:22 PM Benjamin Fluharty &lt;<a href="mailto:benjaminfluharty@outlook.com">benjaminfluharty@outlook.com</a>&gt; wrote:<br></div><blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex; border-left:1px solid rgb(204,204,204); padding-left:1ex">test</blockquote></div></body></html>';

    expect(extractLatestEmailBody(body)).toBe('thanks for your message');
  });

  it('strips common plain-text quoted reply sections', () => {
    const body = 'Sounds good.\n\nOn Sat, Jun 27, 2026 at 3:22 PM Sender <sender@example.com> wrote:\n> test';

    expect(extractLatestEmailBody(body)).toBe('Sounds good.');
  });
});
