/**
 * SMTP smoke test: verifies the connection + login, then sends a test email.
 *
 *   yarn test:mail                # sends to ALERT_EMAILS (or SMTP_USER if unset)
 *   yarn test:mail you@example.com  # sends to an explicit recipient
 *
 * Reads .env from the repo root if present (systemd injects the environment in
 * production, but this script is meant to be run by hand).
 */
import fs from 'node:fs';
import path from 'node:path';
import nodemailer from 'nodemailer';

function loadDotEnv(): void {
  const file = path.join(process.cwd(), '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && m[1] && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2];
    }
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const { appConfig } = await import('../lib/config');

  const smtp = appConfig.smtp;
  const recipient =
    process.argv[2] ??
    (appConfig.alertEmails.length > 0 ? appConfig.alertEmails.join(', ') : smtp.user);

  console.log(`SMTP     ${smtp.host}:${smtp.port} (secure=${smtp.secure})`);
  console.log(`User     ${smtp.user}`);
  console.log(`From     ${smtp.from}`);
  console.log(`To       ${recipient}`);

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: { user: smtp.user, pass: smtp.pass },
    // Fail fast instead of hanging when the port is firewalled (e.g. Hetzner
    // blocks outbound 465 by default - use 587 with SMTP_SECURE=false there).
    connectionTimeout: 15000,
    greetingTimeout: 10000,
  });

  process.stdout.write('\n1/2 Verifying connection + login... ');
  await transporter.verify();
  console.log('OK');

  process.stdout.write('2/2 Sending test email... ');
  const info = await transporter.sendMail({
    from: smtp.from,
    to: recipient,
    subject: '[simplex-monitor] SMTP test',
    text: `This is a test email from simplex-monitor.\n\nHost: ${smtp.host}\nSent: ${new Date().toISOString()}\n\nIf you received this, alert and login-code emails are working.`,
  });
  console.log('OK');
  console.log(`\nServer response: ${info.response}`);
  console.log(`Message id:      ${info.messageId}`);
  console.log('\nSMTP is working. Check the inbox (and spam folder) to confirm delivery.');
}

main().catch((err) => {
  console.error('\nFAILED:', (err as Error).message);
  console.error(
    '\nCommon causes: wrong SMTP_PASS (Gmail/Zoho need an app password when 2FA is on),\nwrong SMTP_PORT/SMTP_SECURE combo (465=true, 587=false), outbound port blocked by\nthe hoster (Hetzner blocks 465 by default - use 587 + SMTP_SECURE=false), or the\nprovider blocking the VPS IP.',
  );
  process.exit(1);
});
