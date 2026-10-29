// Vercel Serverless Function entry point
require('dotenv').config();
const { handleApiRequest, sendJson } = require('../lib/api-handler');

module.exports = async (req, res) => {
  const host = req.headers.host || 'localhost';
  const urlObj = new URL(req.url, `https://${host}`);
  const pathname = urlObj.pathname;
  const query = Object.fromEntries(urlObj.searchParams.entries());

  try {
    const handled = await handleApiRequest(req, res, pathname, query);
    if (!handled) {
      sendJson(res, 404, { error: `Endpoint not found: ${pathname}` });
    }
  } catch (err) {
    console.error('Serverless execution error:', err);
    sendJson(res, 500, { error: 'Internal Server Error: ' + err.message });
  }
};

