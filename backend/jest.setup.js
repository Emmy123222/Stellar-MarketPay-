process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/marketpay_test";
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-jwt-secret-with-enough-length-for-ci";
// Bind to an OS-assigned random port so concurrent Jest workers never collide on 4000.
process.env.PORT = process.env.PORT || "0";
