import { validateEnv } from '../src/common/config/env.validation.js';

validateEnv(process.env);
console.log('Environment configuration is valid');
