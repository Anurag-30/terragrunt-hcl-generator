
import React, { useState } from 'react';

function VMCard({ vm, index, updateVM, removeVM, isOnly, serverType, onDBSizeChange, fsCredentials }) {
    const [expanded, setExpanded] = useState(true);
    const [dpgLoading, setDpgLoading] = useState(false);
    const [dpgError, setDpgError] = useState('');

    const handleChange = (field, value) => {
        updateVM({ ...vm, [field]: value });
    };

    const handleNestedChange = (parent, field, value) => {
        updateVM({
            ...vm,
            [parent]: {
                ...vm[parent],
                [field]: value
            }
        });
    };

    const handleFetchDPG = async () => {
        if (!fsCredentials.password) {
            setDpgError("Password required above");
            return;
        }
        setDpgLoading(true);
        setDpgError('');

        try {
            const response = await fetch('/api/get-dpg-id', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: fsCredentials.url,
                    username: fsCredentials.username,
                    password: fsCredentials.password,
                    datacenter: vm.datacenter,
                    network: vm.dpg_id // Using the input as the network name to search? 
                    // User Request: "compute dpgid... execute command... get value"
                    // govc ls -i /<dc>/network/<networkname>
                    // So we need a "Network Name" input distinct from "DPG ID".
                    // But currently we only have one field `dpg_id`. 
                    // Assuming the user enters the NAME in `dpg_id` field, and we replace it with ID?
                    // Or we add a separate "Network Name" field?
                    // Let's assume the field currently holds the ID, but user wants to put Name -> Fetch -> Get ID.
                })
            });

            const data = await response.json();
            if (data.error) {
                setDpgError(data.error);
                // "if error just put it as error while computing in those fields"
                handleChange('dpg_id', "Error: " + data.error);
            } else {
                handleChange('dpg_id', data.dpgId);
            }
        } catch (e) {
            setDpgError("Network Error");
            handleChange('dpg_id', "Error: Network / Backend unreachable");
        } finally {
            setDpgLoading(false);
        }
    };

    const handleCheckDatastore = async (datastoreName) => {
        if (!fsCredentials.password) {
            alert("Please enter VCenter Credentials at the top first.");
            return;
        }
        if (!datastoreName) {
            alert("Enter a datastore name first.");
            return;
        }

        try {
            // Calculate Total Requested Size for this VM
            const rootSize = parseInt(vm.root_disk_size || 0);
            const additionalSize = (vm.additional_disks || []).reduce((acc, d) => acc + parseInt(d.size || 0), 0);
            const totalRequestedGB = rootSize + additionalSize;

            const response = await fetch('/api/check-datastore', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    url: fsCredentials.url,
                    username: fsCredentials.username,
                    password: fsCredentials.password,
                    datacenter: vm.datacenter,
                    datastore: datastoreName
                })
            });

            const data = await response.json();
            if (data.error) {
                alert("Error checking datastore: " + data.error);
            } else {
                const free = parseFloat(data.freeGB);
                const status = free > totalRequestedGB ? "✅ OK" : "❌ INSUFFICIENT";
                alert(
                    `Datastore: ${data.name}\n` +
                    `Free Space: ${data.freeGB} GB\n` +
                    `This VM Needs: ~${totalRequestedGB} GB\n` +
                    `Status: ${status}`
                );
            }
        } catch (e) {
            alert("Failed to check datastore: " + e.message);
        }
    };

    const addDisk = () => {
        const newDisk = {
            id: Date.now(),
            size: 100,
            tag: `disk${vm.additional_disks.length + 1}`,
            label: "/dev/sdx",
            mount_dir: "/data",
            datastore: vm.datastore,
            lve: true
        };
        updateVM({ ...vm, additional_disks: [...vm.additional_disks, newDisk] });
    };

    const updateDisk = (diskIndex, field, value) => {
        const newDisks = [...vm.additional_disks];
        // If value is number field, parse it
        const val = (field === 'size') ? parseInt(value) : value;
        newDisks[diskIndex] = { ...newDisks[diskIndex], [field]: val };
        updateVM({ ...vm, additional_disks: newDisks });
    };

    const removeDisk = (diskIndex) => {
        updateVM({
            ...vm,
            additional_disks: vm.additional_disks.filter((_, i) => i !== diskIndex)
        });
    };

    return (
        <div className="card">
            <div className="flex justify-between mb-4" onClick={() => setExpanded(!expanded)} style={{ cursor: 'pointer' }}>
                <h3>VM #{index + 1}: {vm.vm_hostname || 'New VM'} ({serverType.toUpperCase()})</h3>
                <div className="flex">
                    <button className="secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.8rem' }}>
                        {expanded ? 'Collapse' : 'Expand'}
                    </button>
                    {!isOnly && <button className="danger" onClick={(e) => { e.stopPropagation(); removeVM(); }}>Remove</button>}
                </div>
            </div>

            {expanded && (
                <div className="space-y-8">

                    <div className="grid">
                        <div><label>Cluster</label><input value={vm.cluster} onChange={e => handleChange('cluster', e.target.value)} /></div>
                        <div><label>Datacenter</label><input value={vm.datacenter} onChange={e => handleChange('datacenter', e.target.value)} /></div>
                        <div>
                            <label>Network Name / DPG ID</label>
                            <div className="flex" style={{ gap: '0.5rem' }}>
                                <input
                                    value={vm.dpg_id}
                                    onChange={e => handleChange('dpg_id', e.target.value)}
                                    placeholder="Enter Network Name to Fetch ID"
                                    style={dpgError ? { borderColor: 'red' } : {}}
                                />
                                <button
                                    className="primary"
                                    onClick={handleFetchDPG}
                                    disabled={dpgLoading}
                                    style={{ minWidth: '80px' }}
                                >
                                    {dpgLoading ? '...' : 'Fetch'}
                                </button>
                            </div>
                            {dpgError && <span style={{ color: 'red', fontSize: '0.8rem' }}>{dpgError}</span>}
                        </div>
                        <div>
                            <label>Datastore</label>
                            <div className="flex" style={{ gap: '0.5rem' }}>
                                <input value={vm.datastore} onChange={e => handleChange('datastore', e.target.value)} />
                                <button className="secondary" style={{ whiteSpace: 'nowrap', fontSize: '0.8rem' }} onClick={() => handleCheckDatastore(vm.datastore)}>Check Cap</button>
                            </div>
                        </div>
                    </div>

                    <div className="grid">
                        <div><label>Content Library</label><input value={vm.content_library} onChange={e => handleChange('content_library', e.target.value)} /></div>
                        <div><label>Base Template</label><input value={vm.base_template} onChange={e => handleChange('base_template', e.target.value)} /></div>
                        <div><label>Hostname</label><input value={vm.vm_hostname} onChange={e => handleChange('vm_hostname', e.target.value)} /></div>
                        <div><label>CPUs</label><input type="number" value={vm.vm_cpus} onChange={e => handleChange('vm_cpus', e.target.value)} /></div>
                    </div>

                    <div className="grid">
                        <div><label>Memory (MB)</label><input type="number" value={vm.vm_memory} onChange={e => handleChange('vm_memory', e.target.value)} /></div>
                        <div><label>Root Disk (GB)</label><input type="number" value={vm.root_disk_size} onChange={e => handleChange('root_disk_size', e.target.value)} /></div>
                        <div><label>Guest ID</label><input value={vm.guest_id} onChange={e => handleChange('guest_id', e.target.value)} /></div>
                        <div><label>IPv4 CIDR</label><input value={vm.ipv4_cidr} onChange={e => handleChange('ipv4_cidr', e.target.value)} /></div>
                    </div>

                    <div className="grid">
                        <div><label>IPv4 Addr</label><input value={vm.ipv4_addr} onChange={e => handleChange('ipv4_addr', e.target.value)} /></div>
                        <div><label>Gateway</label><input value={vm.vm_gateway_ip} onChange={e => handleChange('vm_gateway_ip', e.target.value)} /></div>
                        <div><label>IP CIDR</label><input value={vm.ip_cidr} onChange={e => handleChange('ip_cidr', e.target.value)} /></div>
                    </div>

                    {serverType === 'db' && (
                        <div className="card" style={{ border: '1px solid var(--primary-color)' }}>
                            <h4 className="mb-4" style={{ color: 'var(--primary-color)' }}>DB Dynamic Configuration</h4>
                            <div className="grid">
                                <div>
                                    <label>Dump Size (Adjusts Disk 5)</label>
                                    <input type="number" value={vm.db_dump_size} onChange={e => onDBSizeChange('dump', e.target.value)} />
                                </div>
                                <div>
                                    <label>Data DG Total (Regenerates Data Disks)</label>
                                    <input type="number" value={vm.db_data_size} onChange={e => onDBSizeChange('data', e.target.value)} />
                                </div>
                                <div>
                                    <label>Arch DG Total (Regenerates Arch Disks)</label>
                                    <input type="number" value={vm.db_arch_size} onChange={e => onDBSizeChange('arch', e.target.value)} />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Disks Section - Now Editable for ALL modes */}
                    <div className="list-item">
                        <div className="flex justify-between mb-4">
                            <h4>Disks ({vm.additional_disks.length})</h4>
                            <button className="secondary" onClick={addDisk} style={{ fontSize: '0.8rem' }}>+ Add Custom Disk</button>
                        </div>

                        {(vm.additional_disks || []).map((disk, i) => (
                            <div key={i} className="grid mb-2 pb-2 border-b border-gray-700" style={{ position: 'relative' }}>
                                <button
                                    onClick={() => removeDisk(i)}
                                    style={{ position: 'absolute', right: -10, top: 0, background: 'none', color: 'var(--danger-color)', fontSize: '1.2rem', padding: 0 }}
                                    title="Remove Disk"
                                >&times;</button>

                                {/* Compact Row for Editable Disks */}
                                <div style={{ display: 'contents' }}>
                                    <div style={{ flex: '0 0 50px' }}><label>Tag</label><input value={disk.tag} onChange={e => updateDisk(i, 'tag', e.target.value)} style={{ width: '60px' }} /></div>
                                    <div style={{ flex: '0 0 80px' }}><label>Size</label><input type="number" value={disk.size} onChange={e => updateDisk(i, 'size', e.target.value)} style={{ width: '80px' }} /></div>
                                    <div style={{ flex: '1' }}><label>Mount</label><input value={disk.mount_dir} onChange={e => updateDisk(i, 'mount_dir', e.target.value)} /></div>
                                    <div style={{ flex: '1' }}><label>Label</label><input value={disk.label} onChange={e => updateDisk(i, 'label', e.target.value)} /></div>
                                    <div style={{ flex: '1' }}><label>Datastore</label><input value={disk.datastore} onChange={e => updateDisk(i, 'datastore', e.target.value)} /></div>

                                    {/* Extra fields shown only if present or expanded? To keep UI clean, maybe show a "Details" toggle or just list them if they exist? */}
                                    {/* For DB, show oracle/vg names if they exist */}
                                    {(disk.oracle_disk_name || disk.vg_name) && (
                                        <div style={{ flex: '1' }}>
                                            <label>Role/VG</label>
                                            <input
                                                value={disk.oracle_disk_name || disk.vg_name || ''}
                                                onChange={e => updateDisk(i, disk.oracle_disk_name ? 'oracle_disk_name' : 'vg_name', e.target.value)}
                                                placeholder="Role"
                                            />
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>

                    <div>
                        <h4>Request Metadata</h4>
                        <div className="grid">
                            <div><label>RITM</label><input value={vm.vm_request_metadata.PROVISION_RITM} onChange={e => handleNestedChange('vm_request_metadata', 'PROVISION_RITM', e.target.value)} /></div>
                            <div><label>App Env</label><input value={vm.vm_request_metadata.APP_ENV} onChange={e => handleNestedChange('vm_request_metadata', 'APP_ENV', e.target.value)} /></div>
                            <div><label>Env Group</label><input value={vm.vm_request_metadata.ENV_GROUP} onChange={e => handleNestedChange('vm_request_metadata', 'ENV_GROUP', e.target.value)} /></div>
                            <div><label>App Owner</label><input value={vm.vm_request_metadata.APP_OWNER} onChange={e => handleNestedChange('vm_request_metadata', 'APP_OWNER', e.target.value)} /></div>
                            <div><label>Tower Head</label><input value={vm.vm_request_metadata.TOWER_HEAD} onChange={e => handleNestedChange('vm_request_metadata', 'TOWER_HEAD', e.target.value)} /></div>

                            {serverType === 'db' ? (
                                <div><label>Support Team</label><input value={vm.vm_request_metadata.SUPPORT_TEAM || 'middleware'} onChange={e => handleNestedChange('vm_request_metadata', 'SUPPORT_TEAM', e.target.value)} /></div>
                            ) : (
                                <>
                                    <div><label>App Name</label><input value={vm.vm_request_metadata.APPLICATION_NAME} onChange={e => handleNestedChange('vm_request_metadata', 'APPLICATION_NAME', e.target.value)} /></div>
                                    <div><label>Middleware</label><input value={vm.vm_request_metadata.MIDDLEWARE} onChange={e => handleNestedChange('vm_request_metadata', 'MIDDLEWARE', e.target.value)} /></div>
                                </>
                            )}
                        </div>
                    </div>

                </div>
            )}
        </div>
    );
}

export default VMCard;
