import type { NextRequest } from 'next/server';
import { clientIp, err, ok } from '@/lib/api';
import { prepareOtp } from '@/lib/auth';
import { appConfig } from '@/lib/config';
import { sendOtpEmail } from '@/lib/mailer';

export async function POST(request: NextRequest) {
  let email: unknown;
  try {
    ({ email } = (await request.json()) as { email?: unknown });
  } catch {
    return err(400, 'BadRequest', 'Invalid JSON body');
  }
  if (typeof email !== 'string' || !email.includes('@') || email.length > 254) {
    return err(400, 'BadRequest', 'A valid email is required');
  }
  if (!appConfig.smtpConfigured) {
    // No SMTP: codes are minted server-side with `yarn issue-code`. Do not
    // generate one here or it would overwrite a CLI-issued code. Response is
    // identical to the configured case so nothing about the setup leaks.
    return ok({ message: 'If this email has access, a code was sent.' });
  }
  const { result, code } = prepareOtp(email, clientIp(request));
  if (result === 'rate_limited') {
    return err(429, 'TooManyRequests', 'Too many code requests. Try again later.');
  }
  if (result === 'sent' && code) {
    try {
      await sendOtpEmail(email.trim().toLowerCase(), code);
    } catch {
      return err(500, 'MailError', 'Could not send the code email. Try again.');
    }
  }
  // Identical response whether or not the email is allowlisted.
  return ok({ message: 'If this email has access, a code was sent.' });
}
