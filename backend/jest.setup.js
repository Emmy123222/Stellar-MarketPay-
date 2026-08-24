process.env.DATABASE_URL =
  process.env.DATABASE_URL || "postgresql://test:test@localhost:5432/marketpay_test";
process.env.JWT_SECRET =
  process.env.JWT_SECRET || "test-jwt-secret-with-enough-length-for-ci";
// Stable CSRF signing secret so token/cookie pairs generated in one test can be
// verified by a later request in the same suite.
process.env.CSRF_SECRET =
  process.env.CSRF_SECRET || "test-csrf-secret-with-enough-length-for-ci";
// Bind to an OS-assigned random port so concurrent Jest workers never collide on 4000.
process.env.PORT = process.env.PORT || "0";

// Soroban contract id — required by src/config/env.js at module load. The value
// is never dialled in unit tests; it only has to be a well-formed C... address.
process.env.CONTRACT_ID =
  process.env.CONTRACT_ID || "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
process.env.STELLAR_NETWORK = process.env.STELLAR_NETWORK || "testnet";
