/**
 * Mints a dashboard login code on the server, bypassing email delivery.
 * For running the monitor without SMTP configured, or when email is down.
 *
 *   yarn issue-code you@example.com
 *
 * The code follows the normal OTP rules: allowlisted emails only, valid for
 * 10 minutes, single use, 5 verify attempts. Run as the app user so the
 * database is writable, e.g.:
 *
 *   sudo -u simplexmonitor yarn issue-code you@example.com
 */
import fs from 'node:fs';
import path from 'node:path';

function loadDotEnv(): void {
  const file = path.join(process.cwd(), '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && m[1] && m[2] !== undefined && process.env[m[1]] === undefined) {
      let value = m[2].trim();
      // Strip matching surrounding quotes, like dotenv/systemd do.
      if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.endsWith(value[0])) {
        value = value.slice(1, -1);
      }
      process.env[m[1]] = value;
    }
  }
}

async function main(): Promise<void> {
  loadDotEnv();
  const email = process.argv[2];
  if (!email || !email.includes('@')) {
    console.error('Usage: yarn issue-code <allowlisted-email>');
    process.exit(1);
  }
  const { issueOtpDirect } = await import('../lib/auth');
  const code = issueOtpDirect(email);
  if (code === null) {
    console.error(`${email} is not in ALLOWED_EMAILS - no code issued.`);
    process.exit(1);
  }
  console.log(`Login code for ${email.trim().toLowerCase()}: ${code}`);
  console.log('Valid 10 minutes, single use. Enter it on the login page (any email step first).');
}

main().catch((err) => {
  console.error('FAILED:', (err as Error).message);
  process.exit(1);
});
