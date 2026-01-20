
import express from 'express';
import bodyParser from 'body-parser';
import { exec } from 'child_process';
import cors from 'cors';


const app = express();
const port = 3001;

app.use(cors());
app.use(bodyParser.json());

// Helper to escape shell arguments basic (for wrapping values in quotes if needed)
const escapeShell = (cmd) => {
    return '"' + cmd.replace(/(["\s'$`\\])/g, '\\$1') + '"';
};

// Helper to escape spaces with backslash only (no quotes) - Desired for 'ls -i' paths
const escapeSpaces = (str) => {
    return str.replace(/ /g, '\\ ');
};

// Helper to mask password in logs
const maskPassword = (str) => {
    if (!str) return str;
    // Replace GOVC_PASSWORD="value" or GOVC_PASSWORD=value with GOVC_PASSWORD=******
    // Regex covers quoted and unquoted values
    return str.replace(/GOVC_PASSWORD=["']?([^"'\s]+)["']?/g, 'GOVC_PASSWORD=******');
};

app.post('/api/get-dpg-id', (req, res) => {
    const { url, username, password, datacenter, network } = req.body;

    if (!url || !username || !password || !datacenter || !network) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const govcPath = 'govc';

    // Strategy for ls -i: Backslash escape spaces, NO quotes around the path.
    // e.g. /CTRLS\ UAT/network/...
    const dcEscaped = escapeSpaces(datacenter);
    const netEscaped = escapeSpaces(network);
    const rawPath = `/${dcEscaped}/network/${netEscaped}`;

    // Command construction
    const cmdStr = `GOVC_INSECURE=1 GOVC_URL=${escapeShell(url)} GOVC_USERNAME=${escapeShell(username)} GOVC_PASSWORD=${escapeShell(password)} ${govcPath} ls -i ${rawPath}`;

    // Explicit masked log for tracking execution
    const logCmd = `GOVC_INSECURE=1 GOVC_URL=${escapeShell(url)} GOVC_USERNAME=${escapeShell(username)} GOVC_PASSWORD=****** ${govcPath} ls -i ${rawPath}`;

    console.log(`Executing: ${logCmd}`);

    exec(cmdStr, (error, stdout, stderr) => {
        console.log(`Command stdout: ${stdout}`);
        if (stderr) console.error(`Command stderr: ${stderr}`);

        if (error) {
            // Secure error logging
            console.error(`exec error: ${maskPassword(error.toString())}`);
            const safeStderr = stderr ? maskPassword(stderr) : '';
            const safeMsg = error.message ? maskPassword(error.message) : 'Failed to execute govc';
            return res.status(500).json({ error: safeStderr || safeMsg });
        }

        const output = stdout.trim();
        if (!output) {
            return res.status(404).json({ error: 'Network not found (Check if paths with spaces are correct)' });
        }

        const firstToken = output.split(/\s+/)[0];
        res.json({ dpgId: firstToken });
    });
});

app.post('/api/check-datastore', (req, res) => {
    const { url, username, password, datacenter, datastore } = req.body;

    if (!url || !username || !password || !datastore) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const govcPath = 'govc';

    // Strategy for datastore.info: Use -dc="Value With Spaces" (Double Quotes) as per user advice.
    let dcArg = '';
    if (datacenter) {
        // We assume datacenter name is clean enough to just wrap in quotes, 
        // but strictly we should probably escape double quotes inside it if any.
        // But for "CTRLS UAT" it's fine.
        // escapeShell does wrapping in quotes and escaping internal quotes.
        dcArg = `-dc=${escapeShell(datacenter)}`;
    }

    // Datastore name usually simple, but escapeShell handles it if it has spaces too.
    const dsArg = escapeShell(datastore);

    const cmdStr = `GOVC_INSECURE=1 GOVC_URL=${escapeShell(url)} GOVC_USERNAME=${escapeShell(username)} GOVC_PASSWORD=${escapeShell(password)} ${govcPath} datastore.info -json ${dcArg} ${dsArg}`;

    const logCmd = `GOVC_INSECURE=1 GOVC_URL=${escapeShell(url)} GOVC_USERNAME=${escapeShell(username)} GOVC_PASSWORD=****** ${govcPath} datastore.info -json ${dcArg} ${dsArg}`;

    console.log(`Checking Datastore: ${logCmd}`);

    exec(cmdStr, (error, stdout, stderr) => {
        if (error) {
            console.error(`Datastore check error: ${maskPassword(error.toString())}`);
            if (stderr) console.log(`Stderr: ${maskPassword(stderr)}`);
            return res.status(500).json({ error: 'Failed to fetch datastore info' });
        }

        try {
            const data = JSON.parse(stdout);

            let dsInfo = null;
            if (data.datastores && data.datastores.length > 0) {
                dsInfo = data.datastores[0];
            } else {
                dsInfo = data;
            }

            if (!dsInfo || typeof dsInfo.free === 'undefined') {
                if (data.info && data.info.free) {
                    dsInfo = data.info;
                } else {
                    return res.json({ error: 'Invalid datastore info format returned' });
                }
            }

            res.json({
                name: dsInfo.name,
                capacityBytes: dsInfo.capacity,
                freeBytes: dsInfo.free,
                capacityGB: (dsInfo.capacity / (1024 ** 3)).toFixed(2),
                freeGB: (dsInfo.free / (1024 ** 3)).toFixed(2)
            });

        } catch (e) {
            console.error('JSON Parse error', e);
            res.status(500).json({ error: 'Failed to parse datastore info' });
        }
    });
});

app.listen(port, () => {
    console.log(`Backend server running on http://localhost:${port}`);
});
