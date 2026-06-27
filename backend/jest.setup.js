process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/marketpay_test";
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-jwt-secret-with-enough-length-for-ci";
process.env.DATABASE_ENCRYPTION_KEY =
  process.env.DATABASE_ENCRYPTION_KEY || "super-secret-key-of-at-least-16-characters";
