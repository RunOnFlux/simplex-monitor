import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { appConfig } from './config';

let transporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (transporter) return transporter;
  const { host, port, secure, user, pass } = appConfig.smtp;
  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });
  return transporter;
}

export async function sendMail(to: string[], subject: string, text: string): Promise<void> {
  if (to.length === 0) return;
  await getTransporter().sendMail({
    from: appConfig.smtp.from,
    to: to.join(', '),
    subject,
    text,
  });
}

export async function sendOtpEmail(email: string, code: string): Promise<void> {
  await sendMail(
    [email],
    `${code} is your SimpleX Monitor login code`,
    `Your SimpleX Monitor login code is: ${code}\n\nIt expires in 10 minutes. If you did not request this, ignore this email.`,
  );
}

export async function sendAlertEmail(subject: string, text: string): Promise<void> {
  await sendMail(appConfig.alertEmails, subject, text);
}
