'use strict';

const DirectorProvisioner = require('./DirectorProvisioner');
const DockerProvisioner = require('./DockerProvisioner');
const DefaultBindExecutor = require('./DefaultBindExecutor');


/* Controller instances */
exports.directorProvisioner = new DirectorProvisioner();
exports.dockerProvisioner = new DockerProvisioner();
exports.defaultBindExecutor = new DefaultBindExecutor();