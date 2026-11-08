import { validateEnv } from '../src/config/env.validation.js';

validateEnv(process.env);
console.log('Environment configuration is valid');
