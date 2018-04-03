'use strict';

const BoshManager = require('./deployment/BoshManager');
const DockerManager = require('./deployment/DockerManager');
const VirtualHostManager = require('./deployment/VirtualHostManager');
const DefaultBindManager = require('./operation/DefaultBindManager');
const DefaultBackupManager = require('./operation/DefaultBackupManager');


exports.defaultBackupManager = new DefaultBackupManager();
exports.boshManager = new BoshManager();
exports.dockerManager = new DockerManager();
exports.virtualHostManager = new VirtualHostManager();
exports.defaultBindManager = new DefaultBindManager();
exports.defaultBackupManager = new DefaultBackupManager();