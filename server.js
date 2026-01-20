
import express from 'express';
import bodyParser from 'body-parser';
import { exec } from 'child_process';
import cors from 'cors';


const app = express();
const port = 3001;

app.use(cors());
app.use(bodyParser.json());

// Helper to escape shell arguments basic
const escapeShell = (cmd) => {
    return '"' + cmd.replace(/(["\s'$`\\])/g, '\\$1') + '"';
};

// Helper to mask password in logs
const maskPassword = (str) => {
    if (!str) return str;
    return str.replace(/GOVC_PASSWORD=["']?([^"'\s]+)["']?/g, 'GOVC_PASSWORD=******');
};

// Generic helper to execute command with env vars
const runGovc = (commandStr, envVars) => {
    return new Promise((resolve, reject) => {
        const { url, username, password } = envVars;
        const govcPath = 'govc';

        const fullCmd = `GOVC_INSECURE=1 GOVC_URL=${escapeShell(url)} GOVC_USERNAME=${escapeShell(username)} GOVC_PASSWORD=${escapeShell(password)} ${govcPath} ${commandStr}`;
        const logCmd = `GOVC_INSECURE=1 GOVC_URL=${escapeShell(url)} GOVC_USERNAME=${escapeShell(username)} GOVC_PASSWORD=****** ${govcPath} ${commandStr}`;

        console.log(`Executing: ${logCmd}`);

        exec(fullCmd, (error, stdout, stderr) => {
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

    // Step 1: Find the network path dynamically using `govc find`
    // This handles nested folders/datacenters and spacing issues by discovering the real path.
    // We search for type 'n' (Network) with the specified name.

    // Note: We search from root '/' to capture any hierarchy.
    // If multiple are found, we can attempt to filter by the datacenter name provided by user.

    try {
        const findCmd = `find / -type n -name "${network}"`;
        const findOutput = await runGovc(findCmd, { url, username, password });

        if (!findOutput) {
            return res.status(404).json({ error: `Network '${network}' not found.` });
        }

        const paths = findOutput.split('\n').filter(p => p.trim() !== '');

        // Strategy: Filter paths that contain the datacenter name (if provided).
        // User's DC might be "CTRLS UAT", and path might be "/CtrlS-BANk UAT/CTRLS UAT/..."
        let targetPath = '';

        if (paths.length === 1) {
            targetPath = paths[0];
        } else {
            // Fuzzy match: Look for path containing the Datacenter string
            const matched = paths.filter(p => p.includes(datacenter));
            if (matched.length > 0) {
                // If still multiple, take the first one or logic to pick shorter/longer? 
                targetPath = matched[0];
            } else {
                // Fallback: Just take the first valid network found if strict matching fails?
                // Or error out? Let's take first for now but warn.
                console.log("Multiple networks found, none matched DC hint. Using first.");
                targetPath = paths[0];
            }
        }

        console.log(`Found Network Path: ${targetPath}`);

        // Step 2: Get ID using the found path
        // We quote the targetPath to handle spaces safely.
        const lsCmd = `ls -i "${targetPath}"`;
        const lsOutput = await runGovc(lsCmd, { url, username, password });

        const firstToken = lsOutput.split(/\s+/)[0];
        res.json({ dpgId: firstToken });

    } catch (err) {
        res.status(500).json({ error: maskPassword(err.stderr || err.error?.message || 'Failed') });
    }
});

app.post('/api/check-datastore', async (req, res) => {
    const { url, username, password, datacenter, datastore } = req.body;

    if (!url || !username || !password || !datastore) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    try {
        // Step 1: Find datastore path dynamically
        // -type d (Datastore)
        const findCmd = `find / -type d -name "${datastore}"`;
        const findOutput = await runGovc(findCmd, { url, username, password });

        if (!findOutput) {
            return res.status(404).json({ error: `Datastore '${datastore}' not found.` });
        }

        const paths = findOutput.split('\n').filter(p => p.trim() !== '');
        let targetPath = '';

        if (paths.length === 1) {
            targetPath = paths[0];
        } else {
            const matched = paths.filter(p => p.includes(datacenter));
            targetPath = matched.length > 0 ? matched[0] : paths[0];
        }

        console.log(`Found Datastore Path: ${targetPath}`);

        // Step 2: Get Info using full path (no -dc needed if full path used)
        const infoCmd = `datastore.info -json "${targetPath}"`;
        const jsonOutput = await runGovc(infoCmd, { url, username, password });

        const data = JSON.parse(jsonOutput);

        // Step 3: Parse properly based on User's provided JSON structure
        // structure: { datastores: [ { summary: { freeSpace: ..., capacity: ... } } ] }

        let dsEntry = null;
        if (data.datastores && data.datastores.length > 0) {
            dsEntry = data.datastores[0];
        } else {
            dsEntry = data; // Fallback
        }

        // Check 'summary' first (User's case)
        let free = undefined;
        let capacity = undefined;
        let name = dsEntry.name || datastore;

        if (dsEntry.summary) {
            free = dsEntry.summary.freeSpace;
            capacity = dsEntry.summary.capacity;
            name = dsEntry.summary.name || name;
        }
        // Fallback to previous logic 'info' or direct fields just in case
        else if (dsEntry.info) {
            free = dsEntry.info.freeSpace;
            capacity = dsEntry.info.capacity; // warning: check field names for 'info'
        }
        else {
            free = dsEntry.free;
            capacity = dsEntry.capacity;
        }

        if (typeof free === 'undefined') {
            return res.status(500).json({ error: 'Could not find freeSpace/capacity in response' });
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
        res.status(500).json({ error: maskPassword(err.stderr || err.error?.message || 'Failed') });
    }
});

app.listen(port, () => {
    console.log(`Backend server running on http://localhost:${port}`);
});
