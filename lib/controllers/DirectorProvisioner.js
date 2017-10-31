'use strict';

const assert = require('assert');
const _ = require('lodash');
const Promise = require('bluebird');
const errors = require('../errors');
const utils = require('../utils');
const catalog = require('../models/catalog');
const resourceManager = require('../resourcemanager');
const logger = require('../logger');
const fabrik = require('../fabrik');
const DefaultProvisioner = require('./DefaultProvisioner');


class DirectorProvisioner extends DefaultProvisioner{

  registerWatcher() {
    resourceManager.manager.registerWatcher('deployments/director', this.worker, true);
  }
}

module.exports = DirectorProvisioner;