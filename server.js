
import express from 'express';
import bodyParser from 'body-parser';
import { exec } from 'child_process';
import cors from 'cors';

const app = express();
const port = 3001;

app.use(cors());
app.use(bodyParser.json());

// Helper to escape shell arguments basic (wraps in quotes)
const escapeShell = (cmd) => {
    return '"' + cmd.replace(/(["\s'$`\\])/g, '\\$1') + '"';
};

// Helper: Backslash escape spaces (NO quotes)
const escapeSpaces = (str) => {
    return str.replace(/ /g, '\\ ');
};

// Helper to mask password in logs
const maskPassword = (str) => {
    if (!str) return str;
    return str.replace(/GOVC_PASSWORD=["']?([^"'\s]+)["']?/g, 'GOVC_PASSWORD=******');
};

const runGovc = (commandStr, envVars) => {
    return new Promise((resolve, reject) => {
        const { url, username, password } = envVars;
        const govcPath = 'govc';

        // REVERT: Explicit inline export of all variables for every command
        const fullCmd = `GOVC_INSECURE=1 GOVC_URL=${escapeShell(url)} GOVC_USERNAME=${escapeShell(username)} GOVC_PASSWORD=${escapeShell(password)} ${govcPath} ${commandStr}`;
        const logCmd = `GOVC_INSECURE=1 GOVC_URL=${escapeShell(url)} GOVC_USERNAME=${escapeShell(username)} GOVC_PASSWORD=****** ${govcPath} ${commandStr}`;

        console.log(`Executing: ${logCmd}`);

        // Keep the increased timeout and buffer
        exec(fullCmd, { maxBuffer: 1024 * 1024 * 10, timeout: 60000 }, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error: ${maskPassword(error.toString())}`);
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
        // Strategy: Scoped Search (DC first, then Network in DC) to reduce load.
        // This logic is good, we just change HOW we run it (via explicit env vars).

        console.log(`Locating Datacenter '${datacenter}'...`);
        const dcFindCmd = `find / -type Datacenter -name "${datacenter}"`;
        const dcOutput = await runGovc(dcFindCmd, { url, username, password });

        if (!dcOutput) return res.status(404).json({ error: `Datacenter '${datacenter}' not found.` });
        const dcPath = dcOutput.split('\n')[0].trim();

        console.log(`Locating Network '${network}' in ${dcPath}...`);
        const netFindCmd = `find "${dcPath}" -type n -name "${network}"`;
        const netOutput = await runGovc(netFindCmd, { url, username, password });

        if (!netOutput) return res.status(404).json({ error: `Network '${network}' not found in DC.` });
        const netPath = netOutput.split('\n')[0].trim();

        // Get ID
        const lsCmd = `ls -i "${netPath}"`;
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

app.listen(port, () => {
    console.log(`Backend server running on http://localhost:${port}`);
});
