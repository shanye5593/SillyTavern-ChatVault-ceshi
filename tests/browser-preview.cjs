// Local-only visual fixture: serves the real plugin files with synthetic chat data.
// No SillyTavern installation, external requests, or write APIs are used.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const routes = new Map([
    ['/', ['tests/browser-preview.html', 'text/html']],
    ['/fixture.js', ['tests/browser-fixture.js', 'text/javascript']],
    ['/index.js', ['index.js', 'text/javascript']],
    ['/style.css', ['style.css', 'text/css']],
]);

function cover(landscape) {
    const w = landscape ? 600 : 300, h = landscape ? 300 : 600;
    const cx = w / 2, cy = h / 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
      <rect width="100%" height="100%" fill="#a85544"/>
      <rect x="${cx - 150}" y="${cy - 150}" width="300" height="300" fill="#ded9c3"/>
      <circle cx="${cx}" cy="${cy}" r="90" fill="#78816c"/>
      <path d="M${cx - 115} ${cy}h230 M${cx} ${cy - 115}v230" stroke="#272d27" stroke-width="3"/>
      <text x="${cx}" y="${cy + 130}" text-anchor="middle" font-size="18">${landscape ? 'LANDSCAPE' : 'PORTRAIT'} · CENTER</text>
    </svg>`;
}

const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const send = (status, type, body) => {
        res.writeHead(status, { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'" });
        res.end(body);
    };
    if (req.method !== 'GET') return send(405, 'text/plain', 'Fixture is read-only');
    if (url.pathname === '/favicon.ico') return send(204, 'text/plain', '');
    if (url.pathname === '/script.js') return send(200, 'text/javascript', 'export const getRequestHeaders = () => ({});');
    if (url.pathname === '/thumbnail') {
        const file = url.searchParams.get('file');
        if (file === 'portrait.svg' || file === 'landscape.svg') return send(200, 'image/svg+xml', cover(file === 'landscape.svg'));
        // Intentionally invalid image exercises the real onerror fallback without a network error.
        return send(200, 'image/svg+xml', 'fixture: unavailable cover');
    }
    const entry = routes.get(url.pathname);
    if (!entry) return send(404, 'text/plain', 'Not found');
    try { send(200, entry[1], fs.readFileSync(path.join(root, entry[0]))); }
    catch { send(500, 'text/plain', 'Cannot read fixture file'); }
});
server.listen(4178, '127.0.0.1', () => console.log('ChatVault browser fixture: http://127.0.0.1:4178 (Ctrl+C to stop)'));
