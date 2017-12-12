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
const BaseManager = require('./BaseManager');
const CONST = require('../constants');

class DefaultPostprocessingManager extends BaseManager {

  registerWatcher() {
    resourceManager.manager.registerWatcher('deployments', this.worker, true);
  }

  worker(change) {
    const fabrik = require('../fabrik');
    const changedKey = change.node.key;
    logger.info('Changed key is : ', changedKey);
    logger.info('Changed key is : ', _.split(changedKey, '/').length);
    let keys = _.split(changedKey, '/');
    if (keys.length == 5 && keys[4] == 'state' && change.node.value === CONST.RESOURCE_STATE.DEPLOYED) {
      logger.info('Match found');
      const instanceId = keys[3];
      let platform = '';
      let spaceGuid = '';
      return Promise.try(() => {
        return resourceManager.manager.getResourceKey(keys[2], keys[3], 'options')
      }).then(resultStr => {
        const options = JSON.parse(resultStr);
        const serviceId = options.service_id;
        const planId = options.plan_id;
        platform = options.parameters.context.platform;
        spaceGuid = options.parameters.context.space_guid;
        const plan = catalog.getPlan(planId);
        assert.strictEqual(serviceId, plan.service.id);
        return fabrik.createManager(plan);
      }).then(manager => {
        return manager.createInstance(instanceId);
      }).then(instance => {
        if (platform === 'cloudfoundry') {
          return instance.createSecurityGroup(spaceGuid);
        }
      }).then(() => {
        if (platform === 'cloudfoundry') {
          resourceManager.manager.updateResourceState(keys[2], keys[3], CONST.RESOURCE_STATE.SUCCEEDED)
        }
      }); //TODO ERROR Handling
    }
  }

}

module.exports = DefaultPostprocessingManager;