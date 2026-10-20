import convict from 'convict';
const schema = convict({
  security: {
    secret: {
      doc: 'The JWT secret key',
      format: String,
      default: 'secret',
      env: 'JWT_SECRET',
    },
    expiresIn: {
      doc: 'JWT token expiration time',
      format: String,
      default: '15m',
      env: 'JWT_EXPIRES_IN',
    },
    refreshSecret: {
      doc: 'The secret for JWT refresh',
      format: String,
      default: 'refresh',
      env: 'JWT_REFRESH_SECRET',
    },
    refreshExpiresIn: {
      doc: 'JWT refresh token expiration time',
      format: String,
      default: '7d',
      env: 'JWT_REFRESH_EXPIRES_IN',
    },
    saltRounds: {
      doc: 'The number of salt rounds for bcrypt',
      format: Number,
      default: 10,
      env: 'BCRYPT_SALT_ROUNDS',
    },
  },
});

schema.validate({ allowed: 'strict' });

export const config = schema.getProperties();
