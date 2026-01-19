
export const generateHCL = (data, pServerType) => {
  const isDB = pServerType === 'db';

  const formatDiskSize = (val) => parseInt(val);

  const vmsString = data.vms.map(vm => {

    // Disks are now managed in state for both DB and Web
    const disks = vm.additional_disks || [];

    const disksString = disks.map(disk => {

      let parts = [];
      if (disk.size !== undefined) parts.push(`size = ${formatDiskSize(disk.size)}`);
      if (disk.tag) parts.push(`tag = "${disk.tag}"`);
      if (disk.label) parts.push(`label = "${disk.label}"`);
      if (disk.mount_dir) parts.push(`mount_dir = "${disk.mount_dir}"`);
      if (disk.datastore) parts.push(`datastore = "${disk.datastore}"`);

      // DB specific fields
      if (disk.oracle_disk_name) parts.push(`oracle_disk_name = "${disk.oracle_disk_name}"`);
      if (disk.oracle_disk_group) parts.push(`oracle_disk_group = "${disk.oracle_disk_group}"`);

      // Web/LVM specific fields (DB also has some lvm fields for first few disks)
      if (disk.vg_name) parts.push(`vg_name = "${disk.vg_name}"`);
      if (disk.lvm_name) parts.push(`lvm_name = "${disk.lvm_name}"`);
      if (disk.lvm) parts.push(`lvm = "${disk.lvm}"`);

      return `    { ${parts.join(', ')} }`;
    }).join(',\n    ');

    const metadata = { ...vm.vm_request_metadata, SERVER_TYPE: pServerType };

    // DB metadata specific overrides
    if (isDB) {
      if (!metadata.SUPPORT_TEAM) metadata.SUPPORT_TEAM = "middleware";
      delete metadata.MIDDLEWARE;
    } else {
      delete metadata.SUPPORT_TEAM;
    }

    // Build Metadata String
    const metaParts = Object.entries(metadata).map(([k, v]) => {
      return `        ${k.padEnd(16)} = "${v}"`;
    }).join('\n');

    return `    {
      ipv4_cidr                  = "${vm.ipv4_cidr}"
      ipv4_addr                  = "${vm.ipv4_addr}"
      cluster                    = "${vm.cluster}"
      datacenter                 = "${vm.datacenter}"
      content_library            = "${vm.content_library}"
      datastore                  = "${vm.datastore}"
      base_template              = "${vm.base_template}"
      dpg_id                     = "${vm.dpg_id}"
      vm_cpus                    = "${vm.vm_cpus}"
      vm_memory                  = "${vm.vm_memory}"
      vm_hostname                = "${vm.vm_hostname}"
      vm_gateway_ip              = "${vm.vm_gateway_ip}"
      ip_cidr                    = "${vm.ip_cidr}"
      guest_id                   = "${vm.guest_id}"
      ${!isDB ? `node_role                  = "${vm.node_role}"` : ''}
      ${!isDB ? `node_name                  = "${vm.node_name}"` : ''}
      ${!isDB ? `master_nodes               = "${vm.master_nodes}"` : ''}
      ${!isDB ? `elasticsearch_cluster_name = "${vm.elasticsearch_cluster_name}"` : ''}
      root_disk = {
        size = "${vm.root_disk_size}"
      }
      additional_disks = [
    ${disksString}
      ]
      vm_request_metadata = {
${metaParts}
      }
    }`;
  }).join(',\n');

  let configBlock = '';
  if (isDB) {
    configBlock = `  immutable_status = false
  //  config_server = {
  //    setup    = ""
  //    project  = ""
  //    service  = ""
  //    env      = ""
  //    platform = ""
  //  }`;
  } else {
    configBlock = `  config_server = {
    ivertex = {
      project  = "${data.config_server_project}"
      service  = "${data.config_server_service}"
      env      = "${data.config_server_env}"
      platform = "${data.config_server_platform}"
    }
  }`;
  }

  return `inputs = {
  infoblox_server = "${data.infoblox_server}"
  vcenter_server  = "${data.vcenter_server}"
${configBlock}
  vms = [
${vmsString}
  ]
}`;
};
