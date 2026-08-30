const REQUIRED = [
  'MONGODB_URI',
  'JWT_SECRET',
  'REDIS_HOST',
  'REDIS_PORT'
];

const MIN_LENGTHS = {
  JWT_SECRET: 32
};

const requireEnv = () => {
  const missing = REQUIRED.filter((key) => !process.env[key] || !String(process.env[key]).trim());
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
  const weak = Object.entries(MIN_LENGTHS).filter(
    ([key, min]) => String(process.env[key]).length < min
  );
  if (weak.length) {
    const detail = weak.map(([k, min]) => `${k} must be at least ${min} chars`).join('; ');
    throw new Error(`Weak env vars: ${detail}`);
  }
};

module.exports = requireEnv;
