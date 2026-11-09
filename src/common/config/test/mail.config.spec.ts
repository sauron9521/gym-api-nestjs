import { describe, expect, it } from 'vitest';
import { LogMailTransport, SmtpTransport } from '@nestjs/mail';
import { createMailOptions } from '../mail.config.js';

const sender = 'Gym API <no-reply@example.test>';

describe('createMailOptions', () => {
  it.each(['development', 'test'] as const)(
    '%s without SMTP uses the log transport',
    (NODE_ENV) => {
      const options = createMailOptions(
        { NODE_ENV, SMTP_URL: undefined, MAIL_FROM: undefined },
        '/tmp/mail/templates',
      );
      expect(options.transport).toBeInstanceOf(LogMailTransport);
      expect(options.from).toBe('Gym Dev <dev@example.test>');
    },
  );

  it('uses encrypted SMTP and configured sender in production', () => {
    const options = createMailOptions(
      {
        NODE_ENV: 'production',
        SMTP_URL: 'smtps://mailer.example.test:465',
        MAIL_FROM: sender,
      },
      '/tmp/mail/templates',
    );
    expect(options.transport).toBeInstanceOf(SmtpTransport);
    expect(options.from).toBe(sender);
  });

  it('refuses a production log fallback', () => {
    expect(() => createMailOptions(
      { NODE_ENV: 'production', SMTP_URL: undefined, MAIL_FROM: sender },
      '/tmp/mail/templates',
    )).toThrow('Production email requires');
  });

  it('refuses unencrypted SMTP even if validation was bypassed', () => {
    expect(() => createMailOptions(
      {
        NODE_ENV: 'production',
        SMTP_URL: 'smtp://mailer.example.test:587',
        MAIL_FROM: sender,
      },
      '/tmp/mail/templates',
    )).toThrow('encrypted SMTPS');
  });

  it('uses configured SMTP in development when provided', () => {
    const options = createMailOptions(
      {
        NODE_ENV: 'development',
        SMTP_URL: 'smtp://localhost:1025',
        MAIL_FROM: sender,
      },
      '/tmp/mail/templates',
    );
    expect(options.transport).toBeInstanceOf(SmtpTransport);
  });
});
