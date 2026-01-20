
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

app.post('/api/get-dpg-id', (req, res) => {
    const { url, username, password, datacenter, network } = req.body;

    if (!url || !username || !password || !datacenter || !network) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const govcPath = 'govc';

    // Quote the path robustly to handle spaces in Datacenter names.
    // e.g., "/CTRLS UAT/network/Net1" -> quoted as "/CTRLS UAT/network/Net1"
    const rawPath = `/${datacenter}/network/${network}`;

    // Explicitly using inline env variables
    const cmdStr = `GOVC_INSECURE=1 GOVC_URL=${escapeShell(url)} GOVC_USERNAME=${escapeShell(username)} GOVC_PASSWORD=${escapeShell(password)} ${govcPath} ls -i "${rawPath}"`;

    // Masked log
    const logCmd = `GOVC_INSECURE=1 GOVC_URL=${escapeShell(url)} GOVC_USERNAME=${escapeShell(username)} GOVC_PASSWORD=****** ${govcPath} ls -i "${rawPath}"`;

    console.log(`Executing: ${logCmd}`);

    exec(cmdStr, (error, stdout, stderr) => {
        console.log(`Command stdout: ${stdout}`);
        if (stderr) console.error(`Command stderr: ${stderr}`);

        if (error) {
            console.error(`exec error: ${error}`);
            return res.status(500).json({ error: stderr || error.message || 'Failed to execute govc' });
        }

        const output = stdout.trim();
        if (!output) {
            return res.status(404).json({ error: 'Network not found' });
        }

        const firstToken = output.split(/\s+/)[0];
        res.json({ dpgId: firstToken });
    });
});

app.post('/api/check-datastore', (req, res) => {
    const { url, username, password, datastore } = req.body;

    if (!url || !username || !password || !datastore) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    const govcPath = 'govc';

    // Check datastore info using -json flag
    const cmdStr = `GOVC_INSECURE=1 GOVC_URL=${escapeShell(url)} GOVC_USERNAME=${escapeShell(username)} GOVC_PASSWORD=${escapeShell(password)} ${govcPath} datastore.info -json "${datastore}"`;

    // Masked log
    const logCmd = `GOVC_INSECURE=1 GOVC_URL=${escapeShell(url)} GOVC_USERNAME=${escapeShell(username)} GOVC_PASSWORD=****** ${govcPath} datastore.info -json "${datastore}"`;

    console.log(`Checking Datastore: ${logCmd}`);

    exec(cmdStr, (error, stdout, stderr) => {
        if (error) {
            console.error(`Datastore check error: ${error}`);
            console.error(stderr);
            return res.status(500).json({ error: 'Failed to fetch datastore info' });
        }

        try {
            const data = JSON.parse(stdout);

            // Handle govc output format (sometimes array "datastores", sometimes direct object)
            let dsInfo = null;
            if (data.datastores && data.datastores.length > 0) {
                dsInfo = data.datastores[0];
            } else {
                dsInfo = data;
            }

            if (!dsInfo || typeof dsInfo.free === 'undefined') {
                // Try looking deeper if structure is different
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
