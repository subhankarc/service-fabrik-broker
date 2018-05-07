'use strict';

const DefaultBackupManager = require('./operation/DefaultBackupManager');
exports.catalog = require('./catalog');
exports.Plan = require('./Plan');
exports.Service = require('./Service');
exports.defaultBackupManager = new DefaultBackupManager();