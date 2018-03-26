'use strict';

const assert = require('assert');
const _ = require('lodash');
const Promise = require('bluebird');
const catalog = require('../../models/catalog');
const eventmesh = require('../../eventmesh');
const logger = require('../../logger');
const BaseManager = require('../BaseManager');

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

class DockerManager extends BaseManager {

  registerServices(provisionerType) {
    const filename = path.join(__dirname, '..', '..', '..', 'config', `${provisionerType}-services.yml`);
    const buffer = fs.readFileSync(filename, 'utf8');
    const context = {
      require: require,
      __filename: filename,
      __dirname: path.dirname(filename),
      base64_template: function (prefix) {
        const template = path.join(this.__dirname, 'templates', `${prefix}-manifest.yml.ejs`);
        return fs.readFileSync(template).toString('base64');
      },
      certificate: function (name) {
        const filename = path.join(this.__dirname, 'certs', name);
        return JSON.stringify(fs.readFileSync(filename).toString('ascii'));
      }
    };
    const config = yaml.safeLoad(_.template(buffer)(context));
    _.map(config.services, function (service) {
      const serviceAttribues = _.omit(service, 'plans');
      const servicePlans = service.plans;
      eventmesh.server.registerServices(provisionerType, service.name, serviceAttribues, servicePlans);
    });

  }

  registerWatcher() {
    eventmesh.server.registerWatcher('deployments/docker', this.worker, true);
  }

  worker(change) {
    const fabrik = require('../fabrik');
    const changedKey = change.node.key;
    logger.info('Changed key is : ', changedKey);
    logger.info('Changed key is : ', _.split(changedKey, '/').length);
    let keys = _.split(changedKey, '/');
    if (keys.length === 5 && keys[4] === 'options') {
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
        const context = changedValue.parameters.context;
        instance.assignPlatformManager(fabrik.getPlatformManager(context.platform));
        return instance;
      }).then(instance => {
        return instance.create(changedValue.parameters);
      });
    }
  }
}

module.exports = DockerManager;