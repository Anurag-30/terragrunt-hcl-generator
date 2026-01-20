
import React, { useState, useEffect } from 'react';
import './index.css';
import { generateHCL } from './utils/hclGenerator';
import { generateInitialDBDisks, getDumpDisk, getDataDisks, getArchDisks } from './utils/dbLogic';
import VMCard from './components/VMCard';

const INITIAL_STATE = {
  infoblox_server: "10.x.x.x",
  vcenter_server: "vcenter.example.com",
  config_server_project: "project",
  config_server_service: "service",
  config_server_env: "env",
  config_server_platform: "vmware",
  vms: [
    {
      id: Date.now(),
      ipv4_cidr: "10.x.x.0/24",
      ipv4_addr: "10.x.x.x",
      cluster: "Cluster",
      datacenter: "Datacenter",
      content_library: "Content_Library",
      datastore: "Datastore1",
      base_template: "template-v1",
      dpg_id: "dvportgroup-xxxxxx",
      vm_cpus: "4",
      vm_memory: "8192",
      vm_hostname: "HOSTNAME01",
      vm_gateway_ip: "10.x.x.1",
      ip_cidr: "/24",
      guest_id: "rhel9_64Guest",

      // Web specific defaults
      node_role: "role",
      node_name: "node1",
      master_nodes: "10.x.x.1,10.x.x.2",
      elasticsearch_cluster_name: "cluster-name",

      root_disk_size: "100",

      // Default Web disks
      additional_disks: [
        { id: 'web-1', size: 100, tag: "disk1", label: "/dev/sdb", mount_dir: "/mnt/data", datastore: "Datastore1", vg_name: "vg_data", lvm_name: "lv_data", lvm: "true" }
      ],

      // DB specific fields
      db_dump_size: 100,
      db_data_size: 500,
      db_arch_size: 500,

      vm_request_metadata: {
        PROVISION_RITM: "RITMxxxxxxx",
        APP_ENV: "ENV",
        ENV_GROUP: "GROUP",
        APP_OWNER: "User Name  user@example.com",
        TOWER_HEAD: "Manager Name manager@example.com",
        SERVER_TYPE: "db",
        MIDDLEWARE: "false",
        APPLICATION_NAME: "App Name",
        // DB metadata
        SUPPORT_TEAM: "middleware"
      }
    }
  ]
};

function App() {
  // Load initial state from localStorage if available
  const [formData, setFormData] = useState(() => {
    const saved = localStorage.getItem('hcl_form_data');
    return saved ? JSON.parse(saved) : INITIAL_STATE;
  });

  const [serverType, setServerType] = useState(() => {
    return localStorage.getItem('hcl_server_type') || 'db';
  });

  const [generatedCode, setGeneratedCode] = useState('');

  // Credentials for Backend (Load from local storage too?)
  const [vcenterUsername, setVcenterUsername] = useState(() => localStorage.getItem('hcl_vc_user') || 'user@example.com');
  // Password usually shouldn't be auto-saved, but for convenience in this specific tool context:
  const [vcenterPassword, setVcenterPassword] = useState(() => localStorage.getItem('hcl_vc_pass') || '');

  // Persist Data
  useEffect(() => {
    localStorage.setItem('hcl_form_data', JSON.stringify(formData));
  }, [formData]);

  useEffect(() => {
    localStorage.setItem('hcl_server_type', serverType);
  }, [serverType]);

  useEffect(() => {
    localStorage.setItem('hcl_vc_user', vcenterUsername);
    localStorage.setItem('hcl_vc_pass', vcenterPassword);
  }, [vcenterUsername, vcenterPassword]);

  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // Switching Logic
  const handleServerTypeChange = (newType) => {
    setServerType(newType);
    if (newType === 'db') {
      setFormData(prev => ({
        ...prev,
        vms: prev.vms.map(vm => ({
          ...vm,
          additional_disks: generateInitialDBDisks(vm.db_dump_size, vm.db_data_size, vm.db_arch_size)
        }))
      }));
    } else {
      setFormData(prev => ({
        ...prev,
        vms: prev.vms.map(vm => ({
          ...vm,
          additional_disks: [
            { id: 'web-1', size: 4000, tag: "disk1", label: "/dev/sdb", mount_dir: "/mnt/elasticsearch-data", datastore: "RHEL_UAT_2_DCNETUNIAFFA90_ELK_DS10", vg_name: "elasticsearch", lvm_name: "elasticsearch", lvm: "true" }
          ]
        }))
      }));
    }
  };

  useEffect(() => {
    if (serverType === 'db') {
      handleServerTypeChange('db');
    }
  }, []);

  // VM Management
  const addVM = () => {
    const newVM = { ...INITIAL_STATE.vms[0], id: Date.now() };
    if (serverType === 'db') {
      newVM.additional_disks = generateInitialDBDisks(100, 500, 500);
    } else {
      newVM.additional_disks = [];
    }
    setFormData(prev => ({ ...prev, vms: [...prev.vms, newVM] }));
  };

  const updateVM = (index, updatedVM) => {
    const newVMs = [...formData.vms];
    newVMs[index] = updatedVM;
    setFormData(prev => ({ ...prev, vms: newVMs }));
  };

  const removeVM = (index) => {
    if (formData.vms.length > 1) {
      setFormData(prev => ({ ...prev, vms: prev.vms.filter((_, i) => i !== index) }));
    }
  };

  // DB Specific Handlers passed to VMCard
  const handleDBSizeChange = (vmIndex, type, newSize) => {
    const vm = formData.vms[vmIndex];
    let disks = [...vm.additional_disks];

    if (type === 'dump') {
      const idx = disks.findIndex(d => d.tag === 'disk5');
      if (idx !== -1) {
        disks[idx] = { ...disks[idx], size: parseInt(newSize) };
      }
      updateVM(vmIndex, { ...vm, db_dump_size: newSize, additional_disks: disks });
    }
    else if (type === 'data') {
      const nonDataDisks = disks.filter(d => d.oracle_disk_group !== 'DATADG');
      const newDataDisks = getDataDisks(newSize, null, 14);
      const archSize = vm.db_arch_size;
      const newArchDisks = getArchDisks(archSize, null, 14 + newDataDisks.length);
      const coreDisks = disks.filter(d => d.oracle_disk_group !== 'DATADG' && d.oracle_disk_group !== 'ARCHDG');
      const finalDisks = [...coreDisks, ...newDataDisks, ...newArchDisks];

      updateVM(vmIndex, { ...vm, db_data_size: newSize, additional_disks: finalDisks });
    }
    else if (type === 'arch') {
      const dataDisksCount = disks.filter(d => d.oracle_disk_group === 'DATADG').length;
      const startIndex = 14 + dataDisksCount;
      const nonArchDisks = disks.filter(d => d.oracle_disk_group !== 'ARCHDG');
      const newArchDisks = getArchDisks(newSize, null, startIndex);

      updateVM(vmIndex, { ...vm, db_arch_size: newSize, additional_disks: [...nonArchDisks, ...newArchDisks] });
    }
  };

  useEffect(() => {
    const code = generateHCL(formData, serverType);
    setGeneratedCode(code);
  }, [formData, serverType]);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generatedCode);
    alert("Copied to clipboard!");
  };

  return (
    <div className="container">
      <header className="mb-8 flex justify-between align-center">
        <div>
          <h1>Infrastructure Configurator</h1>
        </div>
        <div style={{ textAlign: 'right', display: 'flex', gap: '2rem', alignItems: 'center' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.8rem', textAlign: 'left' }}>VCenter Credentials (for API)</label>
            <div className="flex" style={{ gap: '0.5rem' }}>
              <input
                type="text"
                value={vcenterUsername}
                onChange={e => setVcenterUsername(e.target.value)}
                placeholder="Username"
                style={{ padding: '0.5rem', width: '200px' }}
              />
              <input
                type="password"
                value={vcenterPassword}
                onChange={e => setVcenterPassword(e.target.value)}
                placeholder="Password"
                style={{ padding: '0.5rem', width: '150px' }}
              />
            </div>
          </div>

          <label style={{ fontSize: '1.5rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
            Mode:
            <select
              value={serverType}
              onChange={(e) => handleServerTypeChange(e.target.value)}
              style={{ fontSize: '1.2rem', padding: '0.5rem', width: '150px' }}
            >
              <option value="db">DB Server</option>
              <option value="web">Web Server</option>
            </select>
          </label>
        </div>
      </header>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(500px, 2fr) 1fr', gap: '2rem' }}>
        <div className="space-y-8">

          <section className="card">
            <h2>Global Configuration</h2>
            <div className="grid">
              <div><label>Infoblox Server</label><input value={formData.infoblox_server} onChange={e => handleInputChange('infoblox_server', e.target.value)} /></div>
              <div><label>VCenter Server</label><input value={formData.vcenter_server} onChange={e => handleInputChange('vcenter_server', e.target.value)} /></div>
            </div>
            {serverType === 'web' && (
              <div className="grid mt-4">
                <div><label>Config Project</label><input value={formData.config_server_project} onChange={e => handleInputChange('config_server_project', e.target.value)} /></div>
                <div><label>Service</label><input value={formData.config_server_service} onChange={e => handleInputChange('config_server_service', e.target.value)} /></div>
                <div><label>Env</label><input value={formData.config_server_env} onChange={e => handleInputChange('config_server_env', e.target.value)} /></div>
                <div><label>Platform</label><input value={formData.config_server_platform} onChange={e => handleInputChange('config_server_platform', e.target.value)} /></div>
              </div>
            )}
          </section>

          <section>
            <div className="flex justify-between mb-4">
              <h2>Virtual Machines</h2>
              <button className="primary" onClick={addVM}>+ Add VM</button>
            </div>
            {formData.vms.map((vm, index) => (
              <VMCard
                key={vm.id}
                vm={vm}
                index={index}
                updateVM={(updated) => updateVM(index, updated)}
                removeVM={() => removeVM(index)}
                isOnly={formData.vms.length === 1}
                serverType={serverType}
                onDBSizeChange={(type, val) => handleDBSizeChange(index, type, val)}
                fsCredentials={{
                  url: `https://${formData.vcenter_server}`,
                  username: vcenterUsername,
                  password: vcenterPassword
                }}
              />
            ))}
          </section>

        </div>

        <div>
          <div className="card sticky-top" style={{ position: 'sticky', top: '2rem' }}>
            <div className="flex justify-between mb-4">
              <h2>Preview</h2>
              <button className="secondary" onClick={copyToClipboard}>Copy</button>
            </div>
            <div className="code-preview" style={{ maxHeight: '80vh', overflowY: 'auto' }}>
              {generatedCode}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
