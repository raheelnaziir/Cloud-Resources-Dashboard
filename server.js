const express = require('express');
const os = require('os');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// In-memory visitor counter (resets per pod — demonstrates Kubernetes pod isolation)
let visitorCount = 0;
const startTime = new Date();

// Track recent requests for live activity feed
const recentRequests = [];

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Helper: get system metrics
function getSystemInfo() {
    const uptime = Math.floor((Date.now() - startTime.getTime()) / 1000);
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;

    return {
        containerID: os.hostname(),
        platform: os.platform(),
        arch: os.arch(),
        cpus: os.cpus().length,
        cpuModel: os.cpus()[0]?.model || 'Unknown',
        totalMemMB: Math.round(totalMem / 1024 / 1024),
        usedMemMB: Math.round(usedMem / 1024 / 1024),
        freeMemMB: Math.round(freeMem / 1024 / 1024),
        memUsagePercent: Math.round((usedMem / totalMem) * 100),
        uptimeSeconds: uptime,
        uptimeFormatted: formatUptime(uptime),
        loadAvg: os.loadavg().map(v => v.toFixed(2)),
        nodeVersion: process.version,
        pid: process.pid,
    };
}

function formatUptime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}h ${m}m ${s}s`;
}

// Routes 

// Main page
app.get('/', (req, res) => {
    visitorCount++;
    const ts = new Date().toISOString();
    recentRequests.unshift({ time: ts, path: '/', ip: req.ip });
    if (recentRequests.length > 10) recentRequests.pop();
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API: Full dashboard data
app.get('/api/dashboard', (req, res) => {
    visitorCount++;
    const ts = new Date().toISOString();
    recentRequests.unshift({ time: ts, path: '/api/dashboard', ip: req.ip });
    if (recentRequests.length > 10) recentRequests.pop();

    res.json({
        status: 'running',
        timestamp: ts,
        visitorCount,
        system: getSystemInfo(),
        environment: {
            NODE_ENV: process.env.NODE_ENV || 'development',
            PORT: PORT,
            podNamespace: process.env.POD_NAMESPACE || 'default',
            podName: process.env.POD_NAME || os.hostname(),
            nodeName: process.env.NODE_NAME || 'local',
        },
        recentRequests,
    });
});

// Health check endpoint (used by Kubernetes liveness/readiness probes)
app.get('/health', (req, res) => {
    const uptime = Math.floor((Date.now() - startTime.getTime()) / 1000);
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: formatUptime(uptime),
        containerID: os.hostname(),
        memoryUsage: process.memoryUsage(),
    });
});

// Readiness probe
app.get('/ready', (req, res) => {
    res.json({ ready: true, timestamp: new Date().toISOString() });
});

// Simulate CPU load (for demo purposes)
app.get('/api/stress', (req, res) => {
    const duration = parseInt(req.query.ms) || 500;
    const end = Date.now() + Math.min(duration, 2000);
    let result = 0;
    while (Date.now() < end) {
        result += Math.random();
    }
    res.json({ message: 'CPU stress test complete', duration, result: result.toFixed(0) });
});

// Cloud info endpoint
app.get('/api/cloud', (req, res) => {
    res.json({
        provider: 'AWS',
        service: 'EC2 t2.micro (Free Tier)',
        region: process.env.AWS_REGION || 'us-east-1',
        orchestration: 'Kubernetes (Minikube)',
        registry: 'Amazon ECR',
        containerRuntime: 'Docker',
        k8sNamespace: process.env.POD_NAMESPACE || 'default',
        replicaCount: process.env.REPLICA_COUNT || '1',
    });
});

//  Start Server 
app.listen(PORT, '0.0.0.0', () => {
    console.log(` Cloud Dashboard running on port ${PORT}`);
    console.log(` Container ID: ${os.hostname()}`);
    console.log(` Started at: ${startTime.toISOString()}`);
});