
import express from 'express';
import bodyParser from 'body-parser';
import { exec } from 'child_process';
import cors from 'cors';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';


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

// --- Session Management ---
// We will store the session file in a temp directory specific to this process/user
const HOME_DIR = os.homedir();
// govc uses ~/.govmomi/sessions by default or GOVC_GOVMOMI_SESSION_DIR
// To avoid conflicts, let's just use standard env vars, BUT we need `session.login` to persist.
// Actually, `govc` commands look at `GOVC_URL` etc.
// If we run `govc session.login`, it saves a session. 
// Use `-u` flag for URL in login.
// Subsequent commands need `GOVC_URL` but maybe not user/pass if session is valid?
// Correct `govc` behavior:
// 1. `govc session.login -u URL -kB` (insecure mode). It prompts for password or takes from env.
// 2. It saves a session file.
// 3. Subsequent `govc ls` with just `GOVC_URL` should work.

// Better Strategy to ensure isolation:
// Provide ALL env vars (User/Pass) to `session.login` ONLY.
// Then for subsequent commands, provide ONLY `GOVC_URL` and `GOVC_INSECURE` and rely on cached session?
// Or does Providing User/Pass every time FORCE a new login? YES, usually.
// So:
// Login Command: Has User/Pass.
// Action Commands: Have URL, Insecure. NO User/Pass.

const runGovcCommand = (commandStr, envVars, useSession = true) => {
    return new Promise((resolve, reject) => {
        const { url, username, password } = envVars;
        const govcPath = 'govc';

        let envString = `GOVC_INSECURE=1 GOVC_URL=${escapeShell(url)}`;
        let logEnvString = `GOVC_INSECURE=1 GOVC_URL=${escapeShell(url)}`;

        if (!useSession) {
            // If NOT using session (e.g. the login command itself, or fallback), we pass credentials
            envString += ` GOVC_USERNAME=${escapeShell(username)} GOVC_PASSWORD=${escapeShell(password)}`;
            logEnvString += ` GOVC_USERNAME=${escapeShell(username)} GOVC_PASSWORD=******`;
        }

        const fullCmd = `${envString} ${govcPath} ${commandStr}`;
        const logCmd = `${logEnvString} ${govcPath} ${commandStr}`;

        console.log(`Executing: ${logCmd}`);

        exec(fullCmd, { maxBuffer: 1024 * 1024 * 10, timeout: 60000 }, (error, stdout, stderr) => {
            if (error) {
                const msg = error.message || '';
                // If using session and we get 401/Unauthorized, it means session expired.
                if (useSession && (msg.includes('401') || stderr.includes('401') || msg.includes('session') || stderr.includes('session'))) {
                    return reject({ error, stderr, isSessionError: true });
                }

                console.error(`Error: ${maskPassword(msg)}`);
                if (stderr) console.error(`Stderr: ${maskPassword(stderr)}`);
                return reject({ error, stderr });
            }
            resolve(stdout.trim());
        });
    });
};

const ensureSession = async (envVars) => {
    // Try to check if session is valid? Or just always login if it's cheap?
    // login is cheaper than a full heavy query.
    // Try `session.login` with credentials.
    // Ensure we are using a persistent session.
    try {
        console.log("Refreshing/Creating GOVC Session...");
        // Pass credentials explicitly here
        await runGovcCommand(`session.login`, envVars, false);
        console.log("Session Validated.");
    } catch (e) {
        console.error("Session Login Failed:", e);
        throw e;
    }
};

app.post('/api/get-dpg-id', async (req, res) => {
    const { url, username, password, datacenter, network } = req.body;

    if (!url || !username || !password || !datacenter || !network) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const envVars = { url, username, password };

    try {
        // 1. Establish Session
        await ensureSession(envVars);

        // 2. Execute Logic using SESSION (no credentials in env)

        // Find DC
        console.log(`Locating Datacenter '${datacenter}'...`);
        const dcFindCmd = `find / -type Datacenter -name "${datacenter}"`;
        const dcOutput = await runGovcCommand(dcFindCmd, envVars, true);

        if (!dcOutput) return res.status(404).json({ error: `Datacenter '${datacenter}' not found.` });
        const dcPath = dcOutput.split('\n')[0].trim();

        // Find Network in DC
        console.log(`Locating Network '${network}' in ${dcPath}...`);
        const netFindCmd = `find "${dcPath}" -type n -name "${network}"`;
        const netOutput = await runGovcCommand(netFindCmd, envVars, true);

        if (!netOutput) return res.status(404).json({ error: `Network '${network}' not found in DC.` });
        const netPath = netOutput.split('\n')[0].trim();

        // Get ID
        const lsCmd = `ls -i "${netPath}"`;
        const lsOutput = await runGovcCommand(lsCmd, envVars, true);

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

    const envVars = { url, username, password };

    try {
        await ensureSession(envVars);

        let dcArg = '';
        if (datacenter) {
            dcArg = `-dc=${escapeShell(datacenter)}`;
        }
        const dsArg = escapeShell(datastore);

        const jsonOutput = await runGovcCommand(`datastore.info -json ${dcArg} ${dsArg}`, envVars, true);
        const data = JSON.parse(jsonOutput);

        // Parse Logic (same as verified)
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
