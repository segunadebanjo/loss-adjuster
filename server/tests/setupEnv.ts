// Settings for the app under test (DATABASE_URL comes from globalSetup).
process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = "test-access-secret-0123456789-abcdefghijklmnop";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-0123456789-abcdefghijklmnop";
process.env.BCRYPT_COST = "4";
process.env.CORS_ORIGINS = "http://localhost:5174";
