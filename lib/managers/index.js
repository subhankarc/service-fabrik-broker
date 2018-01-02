'use strict';

const DirectorProvisioner = require('./DirectorProvisioner');
const DockerProvisioner = require('./DockerProvisioner');
const DefaultBindExecutor = require('./DefaultBindExecutor');
const DefaultBackupExecutor = require('./DefaultBackupExecutor');
const DefaultPostprocessingManager = require('./DefaultPostprocessingManager');


/* Controller instances */
exports.directorProvisioner = new DirectorProvisioner();
exports.dockerProvisioner = new DockerProvisioner();
exports.defaultBindExecutor = new DefaultBindExecutor();
exports.defaultBindExecutor = new DefaultBindExecutor();
exports.defaultBackupExecutor = new DefaultBackupExecutor();
exports.defaultPostprocessingManager = new DefaultPostprocessingManager();