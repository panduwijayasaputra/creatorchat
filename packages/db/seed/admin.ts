// The helpers live in the package source so the API can use them; the seed keeps its old import path.
export {
  ARGON2_OPTIONS,
  generatePassword,
  hashPassword,
  normalizeAdminUsername,
  verifyPassword,
} from '../src/admin-password.js';
