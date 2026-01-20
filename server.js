
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

// Helper to run govc command with promise
const runGovc = (commandStr, envVars) => {
    return new Promise((resolve, reject) => {
        const { url, username, password } = envVars;
        const govcPath = 'govc';

        const fullCmd = `GOVC_INSECURE=1 GOVC_URL=${escapeShell(url)} GOVC_USERNAME=${escapeShell(username)} GOVC_PASSWORD=${escapeShell(password)} ${govcPath} ${commandStr}`;
        const logCmd = `GOVC_INSECURE=1 GOVC_URL=${escapeShell(url)} GOVC_USERNAME=${escapeShell(username)} GOVC_PASSWORD=****** ${govcPath} ${commandStr}`;

        console.log(`Executing: ${logCmd}`);

        // Increase maxBuffer to 10MB to handle large find outputs
        exec(fullCmd, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
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
        // Strategy: 
        // 1. Try to find the network path by listing ALL networks and filtering in JS.
        //    (User reported `govc find / -type n -name` failed, so we grab all and filter).

        console.log(`Searching for network '${network}' in datacenter '${datacenter}'...`);
        const allNetworksRaw = await runGovc(`find / -type n`, { url, username, password });

        if (!allNetworksRaw) {
            throw new Error("No networks found in vCenter (govc find returned empty)");
        }

        const allPaths = allNetworksRaw.split('\n').filter(p => p.trim() !== '');

        // Filter: Path must end with /NetworkName
        // Normalize checking by trimming slashes?
        // Path matches if specific segment is network name.
        const matches = allPaths.filter(path => {
            const parts = path.split('/');
            const last = parts[parts.length - 1];
            return last === network;
        });

        let targetPath = '';
        if (matches.length === 0) {
            return res.status(404).json({ error: `Network '${network}' not found in any datacenter.` });
        } else if (matches.length === 1) {
            targetPath = matches[0];
        } else {
            // Multiple matches (same network name in different DCs)
            // Filter by Datacenter name in path
            // e.g. path: /Folder/DC/network/NET
            const dcMatches = matches.filter(path => path.includes(datacenter));
            if (dcMatches.length > 0) {
                targetPath = dcMatches[0];
                if (dcMatches.length > 1) {
                    console.log("Warning: Multiple networks matched both name and DC. Using first.");
                }
            } else {
                // Return first if no DC match found? Or error?
                console.log("Network found but Datacenter part didn't match. Using first found.");
                targetPath = matches[0];
            }
        }

        console.log(`Resolved Network Path: ${targetPath}`);

        // Step 2: ls -i on the resolved path
        // We need to escape spaces in the path for the shell command
        // Since we got the path from govc find, it might contain spaces like "CTRLS UAT".
        // Use proper escaping.
        const finalPathEscaped = escapeSpaces(targetPath);

        // Using "ls -i" with backslash escaped path (no quotes) as user prefers
        const lsOutput = await runGovc(`ls -i ${finalPathEscaped}`, { url, username, password });

        const firstToken = lsOutput.split(/\s+/)[0];
        res.json({ dpgId: firstToken });

    } catch (err) {
        const msg = err.error?.message || err.stderr || 'Failed to fetch DPG ID';
        res.status(500).json({ error: maskPassword(msg) });
    }
});

app.post('/api/check-datastore', async (req, res) => {
    const { url, username, password, datacenter, datastore } = req.body;

    if (!url || !username || !password || !datastore) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    // Method: User verified `govc datastore.info -json -dc="DC" "DS"` works.
    let dcArg = '';
    if (datacenter) {
        dcArg = `-dc=${escapeShell(datacenter)}`;
    }
    const dsArg = escapeShell(datastore);

    try {
        const jsonOutput = await runGovc(`datastore.info -json ${dcArg} ${dsArg}`, { url, username, password });

        const data = JSON.parse(jsonOutput);

        // Parse Logic matching User's provided JSON
        let dsEntry = null;
        if (data.datastores && data.datastores.length > 0) {
            dsEntry = data.datastores[0];
        } else {
            dsEntry = data;
        }

        // Access via summary (Preferred per user log) -> info -> root
        let free = undefined;
        let capacity = undefined;
        let name = dsEntry.name || datastore;

        // Check summary.freeSpace (User example has this)
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
            // Debug log if parsing fails
            console.log("JSON Response keys:", Object.keys(dsEntry));
            if (dsEntry.summary) console.log("Summary keys:", Object.keys(dsEntry.summary));
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
        const msg = err.error?.message || err.stderr || 'Failed to check datastore';
        res.status(500).json({ error: maskPassword(msg) });
    }
});

app.listen(port, () => {
    console.log(`Backend server running on http://localhost:${port}`);
});
