
import React, { useState } from 'react';

function DPGHelpModal({ onClose }) {
    const [inputs, setInputs] = useState({

        url: "https://vcenter.example.com",
        username: "user@example.com",
        datacenter: "",
        network: ""
    });

    const generateCommand = () => {
        return `export GOVC_INSECURE=1
export GOVC_URL="${inputs.url}"
export GOVC_USERNAME="${inputs.username}"
# export GOVC_PASSWORD="your_password"

govc ls -i /${inputs.datacenter || '<datacenter>'}/network/${inputs.network || '<network>'}`;
    };

    const copyToClipboard = () => {
        navigator.clipboard.writeText(generateCommand());
        alert("Command copied!");
    };

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000, backdropFilter: 'blur(5px)'
        }} >
            <div className="card" style={{ width: '500px', maxWidth: '90%' }}>
                <h2 className="mb-4">Get DPG ID Command</h2>
                <div className="space-y-4">
                    <div>
                        <label>Datacenter Name</label>
                        <input
                            value={inputs.datacenter}
                            onChange={e => setInputs({ ...inputs, datacenter: e.target.value })}
                            placeholder="e.g. CTRLS UAT"
                        />
                    </div>
                    <div>
                        <label>Network Name</label>
                        <input
                            value={inputs.network}
                            onChange={e => setInputs({ ...inputs, network: e.target.value })}
                            placeholder="e.g. dvportgroup-..."
                        />
                    </div>

                    <div className="code-preview" style={{ fontSize: '0.8rem', padding: '1rem' }}>
                        {generateCommand()}
                    </div>

                    <div className="flex justify-between mt-4">
                        <button className="secondary" onClick={onClose}>Close</button>
                        <button className="primary" onClick={copyToClipboard}>Copy Command</button>
                    </div>
                </div>
            </div>
        </div >
    );
}

export default DPGHelpModal;
