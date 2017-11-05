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
const BaseProvisioner = require('./BaseProvisioner');


class DefaultBindExecutor extends BaseProvisioner {

  registerWatcher() {
    resourceManager.manager.registerWatcher('deployments', this.worker, true);
  }

  worker(change) {
    const fabrik = require('../fabrik');
    const changedKey = change.node.key;
    logger.info('Changed key is : ', changedKey);
    logger.info('Changed key is : ', _.split(changedKey, '/').length);
    let keys = _.split(changedKey, '/');
    if (keys.length == 8 && keys[4] == 'bind' && keys[5] == 'default' && keys[7] == 'options') {
      logger.info('Match found');
      const changedValue = JSON.parse(change.node.value);
      logger.info('Values are : ', changedValue);
      return Promise.try(() => {
        const service_id = changedValue.service_id;
        const plan_id = changedValue.plan_id;
        const plan = catalog.getPlan(plan_id);
        assert.strictEqual(service_id, plan.service.id);
        return fabrik.createManager(plan);
      }).then(manager => {
        const instance_id = changedValue.instance_id;
        return manager.createInstance(instance_id);
      }).then(instance => {
        return instance.bind(changedValue.parameters);;
      })
    }
  }
}

module.exports = DefaultBindExecutor;