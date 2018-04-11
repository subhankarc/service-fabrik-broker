'use strict';

const assert = require('assert');
const _ = require('lodash');
const Promise = require('bluebird');
const catalog = require('../../managers/catalog');
const eventmesh = require('../../eventmesh');
const logger = require('../../logger');
const BaseManager = require('../BaseManager');

class DefaultBackupManager extends BaseManager {

  registerWatcher() {
    logger.info(`Registering Backup watcher`)
    eventmesh.server.registerWatcher('deployments/director', this.worker, true);
  }

  worker(change) {
    logger.info('Change key:', change.key.toString());
    logger.info('Change value:', change.value.toString());
    const fabrik = require('../../backupcontroller');
    const changedKey = change.key.toString();
    logger.info('Changed key is : ', changedKey);
    logger.info('Changed key length is : ', _.split(changedKey, '/').length);
    let keys = _.split(changedKey, '/');
    if (keys.length === 7 && keys[3] === 'backup' && keys[4] === 'default' && keys[6] === 'options') {
      logger.info('Match found');
      const changedValue = JSON.parse(change.value.toString());
      logger.info('Values are : ', changedValue);
      return Promise.try(() => {
        const service_id = changedValue.service_id;
        const plan_id = changedValue.plan_id;
        const plan = catalog.getPlan(plan_id);
        assert.strictEqual(service_id, plan.service.id);
        return fabrik.createManager(plan);
      }).then(manager => manager.startBackup(changedValue));
    }
  }
}

module.exports = DefaultBackupManager;
