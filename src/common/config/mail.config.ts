import {
  FileTemplateEngine,
  LogMailTransport,
  SmtpTransport,
} from '@nestjs/mail';
import type { AppEnv } from './env.schema.js';

type MailEnv = Pick<AppEnv, 'NODE_ENV' | 'SMTP_URL' | 'MAIL_FROM'>;

/** Keep the template path in app.module.ts so dist/mail/templates is preserved. */
export function createMailOptions(env: MailEnv, templateDirectory: string) {
  if (env.NODE_ENV === 'production' &&
      (!env.SMTP_URL || !env.MAIL_FROM)) {
    throw new Error('Production email requires SMTP_URL and MAIL_FROM');
  }
  if (env.NODE_ENV === 'production' &&
      env.SMTP_URL &&
      new URL(env.SMTP_URL).protocol !== 'smtps:') {
    throw new Error('Production email requires encrypted SMTPS transport');
  }

  return {
    transport: env.SMTP_URL
      ? new SmtpTransport({ url: env.SMTP_URL })
      : new LogMailTransport(),
    templates: new FileTemplateEngine({ dir: templateDirectory }),
    from: env.MAIL_FROM ?? 'Gym Dev <dev@example.test>',
  };
}
