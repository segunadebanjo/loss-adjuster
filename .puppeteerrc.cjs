// Puppeteer downloads its browser during `npm ci`. Keep it inside the project so Render's build and runtime see the
// same copy (Render keeps the project folder, not ~/.cache, between build and start). Only the small headless shell
// is needed to print PDFs, so the full Chrome download is skipped.
const { join } = require("path");

module.exports = {
  cacheDirectory: join(__dirname, ".cache", "puppeteer"),
  chrome: { skipDownload: true },
  "chrome-headless-shell": { skipDownload: false },
};
