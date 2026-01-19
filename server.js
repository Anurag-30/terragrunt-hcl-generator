
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

    // Construct command
    // We use environment variables for passing credentials to avoid them showing in ps list easily (though handled by child_process env)

    const env = {
        ...process.env,
        GOVC_INSECURE: '1',
        GOVC_URL: url,
        GOVC_USERNAME: username,
        GOVC_PASSWORD: password
    };

    // We need to find govc. We assume it's in PATH or standard locations.
    // Using absolute path checked earlier: /opt/homebrew/bin/govc
    // Or fallback to just 'govc' if in path.
    const govcPath = '/opt/homebrew/bin/govc'; // defaulting to what we found

    const command = `${govcPath} ls -i "/${datacenter}/network/${network}"`;

    console.log(`Executing: ${govcPath} ls -i "/${datacenter}/network/${network}"`);

    exec(command, { env }, (error, stdout, stderr) => {
        if (error) {
            console.error(`exec error: ${error}`);
            return res.status(500).json({ error: stderr || error.message || 'Failed to execute govc' });
        }

        // Output format of `govc ls -i` usually:
        // Network:dvportgroup-115485 /Datacenter/network/NetworkName
        // We just want the ID usually "dvportgroup-..." or whatever the output structure is.
        // The user example shows `dpg_id = "dvportgroup-115485"`.
        // `govc ls -i` output is typically: `ID  Path` (columns) or just the ID?
        // Actually `govc ls -i` output:
        // format: <id> <path>
        // e.g. "network-123 /dc/network/vlan1"

        // Let's parse the first token.
        const output = stdout.trim();
        if (!output) {
            return res.status(404).json({ error: 'Network not found' });
        }

        const firstToken = output.split(/\s+/)[0];
        res.json({ dpgId: firstToken });
    });
});

app.listen(port, () => {
    console.log(`Backend server running on http://localhost:${port}`);
});
