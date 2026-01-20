
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

    // We need to find govc.
    // User requested to just use 'govc' directly without path detection.
    const govcPath = 'govc';

    // Construct command with inline environment variables for reliability
    // We escape arguments to prevent shell injection and ensure proper parsing
    const safeUrl = escapeShell(url);
    const safeUsername = escapeShell(username);
    const safePassword = escapeShell(password); // This will be escaped but still raw password
    const safeDatacenter = datacenter; // Assuming safe or needs escaping? Datacenter names might have spaces.
    const safeNetwork = network;

    // Better to escape everything that goes into shell
    const cmdStr = `GOVC_INSECURE=1 GOVC_URL=${escapeShell(url)} GOVC_USERNAME=${escapeShell(username)} GOVC_PASSWORD=${escapeShell(password)} ${govcPath} ls -i "/${datacenter}/network/${network}"`;

    // Create a safe version for logging (masking password)
    const logCmd = `GOVC_INSECURE=1 GOVC_URL=${escapeShell(url)} GOVC_USERNAME=${escapeShell(username)} GOVC_PASSWORD=****** ${govcPath} ls -i "/${datacenter}/network/${network}"`;

    console.log(`Executing: ${logCmd}`);

    exec(cmdStr, (error, stdout, stderr) => {
        console.log(`Command stdout: ${stdout}`);
        if (stderr) console.error(`Command stderr: ${stderr}`);

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
