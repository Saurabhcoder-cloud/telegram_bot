import puppeteer from 'puppeteer';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { bucket, s3 } from './storage';

function buildHtml(data: Record<string, unknown>) {
  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <title>Draft Tax Summary</title>
      <style>
        body { font-family: 'Inter', system-ui, sans-serif; margin: 48px; color: #0f172a; }
        h1 { font-size: 28px; margin-bottom: 16px; }
        h2 { font-size: 20px; margin-top: 32px; }
        table { width: 100%; border-collapse: collapse; margin-top: 16px; }
        th, td { border: 1px solid #cbd5f5; padding: 12px; text-align: left; }
        th { background: #e2e8f0; }
      </style>
    </head>
    <body>
      <h1>TaxHelp Assistant — Draft Summary</h1>
      <p>This draft is for review only. Verify all values before filing.</p>
      <h2>Return snapshot</h2>
      <table>
        <tbody>
          ${Object.entries(data)
            .map(([key, value]) => `<tr><th>${key}</th><td>${JSON.stringify(value)}</td></tr>`)
            .join('')}
        </tbody>
      </table>
    </body>
  </html>`;
}

export async function renderReturnPdf(userId: string, normalizedReturn: Record<string, unknown>) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH
  });
  try {
    const page = await browser.newPage();
    await page.setContent(buildHtml(normalizedReturn), { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({ format: 'Letter', printBackground: true });

    const key = `${userId}/drafts/${crypto.randomUUID()}.pdf`;
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: pdf,
        ContentType: 'application/pdf'
      })
    );

    const expiresIn = 60 * 60 * 24 * 7;
    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn }
    );

    return { url, expiresIn, key };
  } finally {
    await browser.close();
  }
}
