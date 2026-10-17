const express = require('express');
const autocannon = require('autocannon');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Optional HTTP Basic Authentication if configured on Render
const AUTH_USER = process.env.AUTH_USER;
const AUTH_PASS = process.env.AUTH_PASS;

if (AUTH_USER && AUTH_PASS) {
  app.use((req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      res.setHeader('WWW-Authenticate', 'Basic realm="Elite Web"');
      return res.status(401).send('Authentication required');
    }

    const auth = Buffer.from(authHeader.split(' ')[1] || '', 'base64').toString().split(':');
    const user = auth[0];
    const pass = auth[1];

    if (user === AUTH_USER && pass === AUTH_PASS) {
      return next();
    }

    res.setHeader('WWW-Authenticate', 'Basic realm="Elite Web"');
    return res.status(401).send('Invalid credentials');
  });
}

// Serve static frontend files
app.use(express.static(path.join(__dirname, 'public')));

// State management for ongoing test
let currentTest = {
  running: false,
  instance: null,
  progress: null,
  result: null,
  error: null,
  config: null,
  startTime: null
};

// Listeners for SSE (Server-Sent Events) live streaming
let sseClients = [];

function broadcast(data) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(client => client.res.write(payload));
}

// SSE stream for real-time progress
app.get('/api/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const clientId = Date.now();
  const newClient = { id: clientId, res };
  sseClients.push(newClient);

  // Send current state immediately on connect
  res.write(`data: ${JSON.stringify({ type: 'state', currentTest })}\n\n`);

  req.on('close', () => {
    sseClients = sseClients.filter(c => c.id !== clientId);
  });
});

// Start load test endpoint
app.post('/api/start', (req, res) => {
  if (currentTest.running) {
    return res.status(400).json({ error: 'A test is already running. Please stop it or wait for it to finish.' });
  }

  let { url, connections, duration, amount, pipelining } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'Target URL is required.' });
  }

  // Ensure valid URL format
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }

  const cVal = parseInt(connections) || 100;
  const dVal = parseInt(duration) || 20;
  const aVal = amount ? parseInt(amount) : undefined;
  const pVal = parseInt(pipelining) || 1;

  currentTest = {
    running: true,
    instance: null,
    progress: { percent: 0, elapsed: 0, duration: dVal },
    result: null,
    error: null,
    config: { url, connections: cVal, duration: dVal, amount: aVal, pipelining: pVal },
    startTime: Date.now()
  };

  broadcast({ type: 'start', config: currentTest.config });

  // Autocannon options
  const opts = {
    url,
    connections: cVal,
    duration: dVal,
    pipelining: pVal,
    realloc: true,
    // Ignore SSL certificate mismatch for raw IP targets
    tlsOptions: { rejectUnauthorized: false }
  };

  if (aVal && aVal > 0) {
    opts.amount = aVal;
  }

  try {
    const instance = autocannon(opts, (err, result) => {
      currentTest.running = false;
      currentTest.instance = null;

      if (err) {
        currentTest.error = err.message || 'Benchmark failed';
        broadcast({ type: 'error', error: currentTest.error });
      } else {
        currentTest.result = sanitizeResult(result);
        broadcast({ type: 'complete', result: currentTest.result });
      }
    });

    currentTest.instance = instance;

    // Track live progress
    autocannon.track(instance, { renderProgressBar: false });

    instance.on('tick', () => {
      if (currentTest.running) {
        const elapsed = Math.floor((Date.now() - currentTest.startTime) / 1000);
        const percent = Math.min(100, Math.round((elapsed / dVal) * 100));
        currentTest.progress = { elapsed, percent, duration: dVal };
        broadcast({ type: 'tick', progress: currentTest.progress });
      }
    });

    instance.on('error', (err) => {
      currentTest.error = err.message;
      broadcast({ type: 'error', error: err.message });
    });

    return res.json({ message: 'Benchmark started successfully.', config: currentTest.config });
  } catch (err) {
    currentTest.running = false;
    currentTest.error = err.message;
    return res.status(500).json({ error: err.message });
  }
});

// Stop ongoing test
app.post('/api/stop', (req, res) => {
  if (!currentTest.running || !currentTest.instance) {
    return res.status(400).json({ error: 'No test is currently running.' });
  }

  try {
    currentTest.instance.stop();
    currentTest.running = false;
    broadcast({ type: 'stopped' });
    return res.json({ message: 'Benchmark stopped.' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Helper to format autocannon metrics for clean frontend presentation
function sanitizeResult(res) {
  if (!res) return null;
  return {
    url: res.url,
    connections: res.connections,
    pipelining: res.pipelining,
    duration: res.duration,
    start: res.start,
    finish: res.finish,
    errors: res.errors || 0,
    timeouts: res.timeouts || 0,
    mismatches: res.mismatches || 0,
    non2xx: res.non2xx || 0,
    requests: {
      average: res.requests?.average || 0,
      mean: res.requests?.mean || 0,
      stddev: res.requests?.stddev || 0,
      min: res.requests?.min || 0,
      max: res.requests?.max || 0,
      total: res.requests?.total || 0,
      sent: res.requests?.sent || 0
    },
    latency: {
      average: res.latency?.average || 0,
      mean: res.latency?.mean || 0,
      stddev: res.latency?.stddev || 0,
      min: res.latency?.min || 0,
      max: res.latency?.max || 0,
      p50: res.latency?.p50 || 0,
      p90: res.latency?.p90 || 0,
      p99: res.latency?.p99 || 0
    },
    throughput: {
      average: res.throughput?.average || 0,
      mean: res.throughput?.mean || 0,
      total: res.throughput?.total || 0
    },
    statusCodeStats: res.statusCodeStats || {}
  };
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Elite Web server running on http://0.0.0.0:${PORT}`);
});
