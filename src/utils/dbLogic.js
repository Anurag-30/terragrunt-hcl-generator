
/**
 * DB Disk Logic Helper
 */

export const getStandardDisks = (ds1Data, ds2Data) => {
    const ds1 = ds1Data || "Datastore1";
    const ds2 = ds2Data || "Datastore2";

    return [
        { id: 'db-1', size: 100, tag: "disk1", label: "/dev/sdb", mount_dir: "/ORACLE/19.0.0.0", datastore: ds2, oracle_disk_name: "ORACLE", vg_name: "odata", lvm_name: "odata", lvm: "true" },
        { id: 'db-2', size: 150, tag: "disk2", label: "/dev/sdc", mount_dir: "/ORACLE/19.0.0.0/product", datastore: ds2, oracle_disk_name: "ORACLE_PRODUCT", vg_name: "oproduct", lvm_name: "oproduct", lvm: "true" },
        { id: 'db-3', size: 100, tag: "disk3", label: "/dev/sdd", mount_dir: "/grid_home/19.0.0.0", datastore: ds2, oracle_disk_name: "GRID_DATA", vg_name: "gdata", lvm_name: "gdata", lvm: "true" },
        { id: 'db-4', size: 150, tag: "disk4", label: "/dev/sde", mount_dir: "/grid_home/19.0.0.0/product", datastore: ds1, oracle_disk_name: "GRID_DATA_PRODUCT", vg_name: "gproduct", lvm_name: "gproduct", lvm: "true" },
        // disk5 is Dump, inserted separately
        { id: 'db-6', size: 50, tag: "disk6", label: "/dev/sdg", mount_dir: "/application/oem", datastore: ds1, oracle_disk_name: "OEM", vg_name: "oem", lvm_name: "oem", lvm: "true" },
        { id: 'db-7', size: 100, tag: "disk7", label: "/dev/sdh", mount_dir: "/BinariesBackup", datastore: ds1, oracle_disk_name: "BinariesBackup", vg_name: "binaries", lvm_name: "binaries", lvm: "true" },
        { id: 'db-8', size: 5, tag: "disk8", label: "/dev/sdi", mount_dir: "/data", datastore: ds1, oracle_disk_group: "CONTDG1", oracle_disk_name: "CONTDISK1" },
        { id: 'db-9', size: 5, tag: "disk9", label: "/dev/sdj", mount_dir: "/data", datastore: ds1, oracle_disk_group: "CONTDG2", oracle_disk_name: "CONTDISK2" },
        { id: 'db-10', size: 5, tag: "disk10", label: "/dev/sdk", mount_dir: "/data", datastore: ds2, oracle_disk_group: "CONTDG3", oracle_disk_name: "CONTDISK3" },
        { id: 'db-11', size: 30, tag: "disk11", label: "/dev/sdl", mount_dir: "/data", datastore: ds2, oracle_disk_group: "REDODG1", oracle_disk_name: "REDODISK1" },
        { id: 'db-12', size: 30, tag: "disk12", label: "/dev/sdm", mount_dir: "/data", datastore: ds2, oracle_disk_group: "REDODG2", oracle_disk_name: "REDODISK2" },
        { id: 'db-13', size: 30, tag: "disk13", label: "/dev/sdn", mount_dir: "/data", datastore: ds2, oracle_disk_group: "REDODG3", oracle_disk_name: "REDODISK3" },
    ];
};

export const getDumpDisk = (size, ds2Data) => {
    const ds2 = ds2Data || "Datastore2";
    return {
        id: 'db-5',
        size: parseInt(size) || 100,
        tag: "disk5",
        label: "/dev/sdf",
        mount_dir: "/ORACLE/dump",
        datastore: ds2,
        oracle_disk_name: "DUMP",
        vg_name: "dump",
        lvm_name: "dump",
        lvm: "true"
    };
};

export const getDataDisks = (totalSize, dsLargeData, startIndex = 14) => {
    const dsLarge = dsLargeData || "Datastore3";
    const disks = [];
    let remaining = parseInt(totalSize) || 500;
    let count = 1;
    let currentDiskIndex = startIndex;

    // Helper for alpha labels beyond 'n'
    // disk14 = sdo
    // 'o' char code is 111
    // We need to base it on index.
    // disk1 = sdb. disk14 maps to sdo.
    // 1 -> b (98). 14 -> o (111). Diff 13.

    while (remaining > 0) {
        const chunkSize = Math.min(remaining, 1000);
        const labelChar = String.fromCharCode(97 + currentDiskIndex); // simplified, not robust for > z

        disks.push({
            id: `db-data-${count}`,
            size: chunkSize,
            tag: `disk${currentDiskIndex}`,
            label: `/dev/sd${labelChar}`,
            mount_dir: "/data",
            datastore: dsLarge,
            oracle_disk_group: "DATADG",
            oracle_disk_name: `DATADISK${count}`
        });

        remaining -= chunkSize;
        currentDiskIndex++;
        count++;
    }
    return disks;
};

export const getArchDisks = (totalSize, ds2Data, startIndex) => {
    const ds2 = ds2Data || "Datastore2";
    const disks = [];
    let remaining = parseInt(totalSize) || 500;
    let count = 1;
    let currentDiskIndex = startIndex;

    while (remaining > 0) {
        const chunkSize = Math.min(remaining, 500);
        const labelChar = String.fromCharCode(97 + currentDiskIndex);

        disks.push({
            id: `db-arch-${count}`,
            size: chunkSize,
            tag: `disk${currentDiskIndex}`,
            label: `/dev/sd${labelChar}`, // simplified
            mount_dir: "/data",
            datastore: ds2,
            oracle_disk_group: "ARCHDG",
            oracle_disk_name: `ARCHDISK${count}`
        });

        remaining -= chunkSize;
        currentDiskIndex++;
        count++;
    }
    return disks;
};

// Initial full generation helper
export const generateInitialDBDisks = (dumpSize, dataSize, archSize) => {
    const standards = getStandardDisks();
    const dump = getDumpDisk(dumpSize);

    // Insert dump at correct position (disk5 - index 4)
    // standards has disk1-4 (0-3), then disk6-13 (4-11)

    const disks = [
        ...standards.slice(0, 4),
        dump,
        ...standards.slice(4)
    ];

    // Now append Data and Arch
    const dataDisks = getDataDisks(dataSize, null, 14);
    const nextIndex = 14 + dataDisks.length;
    const archDisks = getArchDisks(archSize, null, nextIndex);

    return [...disks, ...dataDisks, ...archDisks];
};
