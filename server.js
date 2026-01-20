
import express from 'express';
import bodyParser from 'body-parser';
import { exec } from 'child_process';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3001;

app.use(cors());
app.use(bodyParser.json());
// Serve static frontend files (SPA)
app.use(express.static(path.join(__dirname, 'dist')));

// Helper to escape shell arguments using SINGLE QUOTES (Stronger escaping)
const escapeShell = (cmd) => {
    if (typeof cmd !== 'string') return "''";
    return "'" + cmd.replace(/'/g, "'\\''") + "'";
};

// Helper to mask password in logs
const maskPassword = (str) => {
    if (!str) return str;
    return str.replace(/GOVC_PASSWORD='([^']+)'/g, 'GOVC_PASSWORD=******');
};

const runGovc = (commandStr, envVars) => {
    return new Promise((resolve, reject) => {
        const { url, username, password } = envVars;
        const govcPath = 'govc';

        // Explicit EXPORT syntax with SINGLE QUOTES
        const cmdChain = `
export GOVC_INSECURE=1;
export GOVC_URL=${escapeShell(url)};
export GOVC_USERNAME=${escapeShell(username)};
export GOVC_PASSWORD=${escapeShell(password)};
${govcPath} ${commandStr}
`;
        const fullCmd = cmdChain.replace(/\n/g, ' ').trim();
        const logCmd = fullCmd.replace(/GOVC_PASSWORD='([^']+)'/g, 'GOVC_PASSWORD=******');

        console.log(`Executing: ${logCmd}`);

        exec(fullCmd, { maxBuffer: 1024 * 1024 * 10, timeout: 60000 }, (error, stdout, stderr) => {
            if (error) {
                const msg = error.toString();
                if (msg.includes('SSL_ERROR_SYSCALL') || msg.includes('EOF')) {
                    console.error("Network/SSL Error detected. Check VPN or Proxy.");
                }
                console.error(`Error: ${maskPassword(msg)}`);
                if (stderr) console.error(`Stderr: ${maskPassword(stderr)}`);
                return reject({ error, stderr });
            }
            resolve(stdout.trim());
        });
    });
};

app.post('/api/get-dpg-id', async (req, res) => {
    const { url, username, password, datacenter, network } = req.body;

    if (!url || !username || !password || !datacenter || !network) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        console.log(`Locating Datacenter '${datacenter}'...`);
        const dcFindCmd = `find / -type Datacenter -name ${escapeShell(datacenter)}`;
        const dcOutput = await runGovc(dcFindCmd, { url, username, password });

        if (!dcOutput) return res.status(404).json({ error: `Datacenter '${datacenter}' not found.` });
        const dcPath = dcOutput.split('\n')[0].trim();
        console.log(`Found DC Path: ${dcPath}`);

        console.log(`Locating Network '${network}' in ${dcPath}...`);
        const netFindCmd = `find ${escapeShell(dcPath)} -type n -name ${escapeShell(network)}`;
        const netOutput = await runGovc(netFindCmd, { url, username, password });

        if (!netOutput) return res.status(404).json({ error: `Network '${network}' not found in DC.` });
        const netPath = netOutput.split('\n')[0].trim();
        console.log(`Found Network Path: ${netPath}`);

        const lsCmd = `ls -i ${escapeShell(netPath)}`;
        const lsOutput = await runGovc(lsCmd, { url, username, password });

        const firstToken = lsOutput.split(/\s+/)[0];
        res.json({ dpgId: firstToken });

    } catch (err) {
        const msg = err.stderr || err.error?.message || 'Failed to fetch DPG ID';
        res.status(500).json({ error: maskPassword(msg) });
    }
});

app.post('/api/check-datastore', async (req, res) => {
    const { url, username, password, datacenter, datastore } = req.body;

    if (!url || !username || !password || !datastore) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    let dcArg = '';
    if (datacenter) {
        dcArg = `-dc=${escapeShell(datacenter)}`;
    }
    const dsArg = escapeShell(datastore);

    try {
        const jsonOutput = await runGovc(`datastore.info -json ${dcArg} ${dsArg}`, { url, username, password });
        const data = JSON.parse(jsonOutput);

        let dsEntry = null;
        if (data.datastores && data.datastores.length > 0) {
            dsEntry = data.datastores[0];
        } else {
            dsEntry = data;
        }

        let free = undefined;
        let capacity = undefined;
        let name = dsEntry.name || datastore;

        if (dsEntry.summary) {
            free = dsEntry.summary.freeSpace;
            capacity = dsEntry.summary.capacity;
            name = dsEntry.summary.name || name;
        }
        else if (dsEntry.info) {
            free = dsEntry.info.freeSpace || dsEntry.info.free;
            capacity = dsEntry.info.capacity;
        }
        else {
            free = dsEntry.free;
            capacity = dsEntry.capacity;
        }

        if (typeof free === 'undefined') {
            return res.status(500).json({ error: 'Could not find capacity/freeSpace fields in response' });
        }

        res.json({
            name: name,
            capacityBytes: capacity,
            freeBytes: free,
            capacityGB: (capacity / (1024 ** 3)).toFixed(2),
            freeGB: (free / (1024 ** 3)).toFixed(2)
        });

    } catch (err) {
        if (err instanceof SyntaxError) {
            return res.status(500).json({ error: 'Failed to parse JSON output' });
        }
        const msg = err.stderr || err.error?.message || 'Failed to check datastore';
        res.status(500).json({ error: maskPassword(msg) });
    }
});

// Fallback for SPA routing - use middleware instead of route
// Express 5's path-to-regexp is strict, so we use a middleware approach
app.use((req, res, next) => {
    // Only serve index.html for non-API GET requests
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    } else {
        next();
    }
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Backend server running on http://0.0.0.0:${port}`);
});
