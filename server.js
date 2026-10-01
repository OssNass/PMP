import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { createProxyMiddleware } from 'http-proxy-middleware';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const SLIDEV_PORT = 3030;

let currentSlidevProcess = null;
let activeLecture = null;

app.use(express.json());

app.get('/api/slides', (req, res) => {
    const slidesDir = path.join(__dirname, 'slides');
    if (!fs.existsSync(slidesDir)) fs.mkdirSync(slidesDir);

    const files = fs.readdirSync(slidesDir).filter(f => f.endsWith('.md'));
    res.json({ files, activeLecture });
});

app.post('/api/start', (req, res) => {
    const { filename } = req.body;
    const filePath = path.join(__dirname, 'slides', filename);

    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'File not found' });
    }

    if (currentSlidevProcess) {
        currentSlidevProcess.kill('SIGTERM');
        currentSlidevProcess = null;
    }

    activeLecture = filename;

    // IMPORTANT: Pass --base /slidev/ so Vite rewrites internal asset routes
    currentSlidevProcess = spawn('npx', [
        'slidev', filePath,
        '--port', SLIDEV_PORT,
        '--base', '/slidev/',
        '--remote'
    ], { stdio: 'inherit', shell: true });

    setTimeout(() => {
        res.json({ status: 'started', file: filename });
    }, 3500);
});

app.get('/', (req, res) => {
    const slidesDir = path.join(__dirname, 'slides');
    const files = fs.existsSync(slidesDir)
        ? fs.readdirSync(slidesDir).filter(f => f.endsWith('.md'))
        : [];

    const listHtml = files.map(file => `
    <li style="margin: 12px 0;">
      <strong>${file}</strong> 
      <button onclick="startLecture('${file}')" style="padding: 6px 12px; cursor: pointer;">
        Launch Presentation
      </button>
    </li>
  `).join('');

    res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Slidev Lecture Hub</title>
      <style>
        body { font-family: system-ui, sans-serif; padding: 2rem; background: #0f172a; color: #f8fafc; }
        button { background: #3b82f6; color: white; border: none; border-radius: 4px; }
        .container { max-width: 600px; margin: 0 auto; }
        a { color: #38bdf8; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>📚 Slidev Lecture Hub</h1>
        <p>Status: ${activeLecture ? `Active - <b>${activeLecture}</b> (<a href="/slidev/">Open Slidev</a>)` : 'No active lecture'}</p>
        <hr/>
        <ul>${listHtml}</ul>
      </div>
      <script>
        async function startLecture(filename) {
          alert('Starting ' + filename + '... Please wait 3 to 4 seconds.');
          await fetch('/api/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ filename })
          });
          window.location.href = '/slidev/';
        }
      </script>
    </body>
    </html>
  `);
});

// Setup Proxy Middleware targeting local Slidev instance
const slidevProxy = createProxyMiddleware({
    target: `http://127.0.0.1:${SLIDEV_PORT}`,
    changeOrigin: true,
    ws: true,
    // DO NOT use pathRewrite to strip /slidev because Slidev now expects /slidev/ in its base path
});

app.use('/slidev', slidevProxy);

// Catch Vite dev server sub-requests (HMR, @vite/client, @fs)
app.use('/@vite', slidevProxy);
app.use('/@fs', slidevProxy);
app.use('/@id', slidevProxy);

const server = app.listen(PORT, () => {
    console.log(`Lecture Manager running at http://localhost:${PORT}`);
});

server.on('upgrade', (req, socket, head) => {
    if (req.url.startsWith('/slidev') || req.url.startsWith('/@vite')) {
        slidevProxy.upgrade(req, socket, head);
    }
});