'use strict';

const Promise = require('bluebird');
const eventmesh = require('../../data-access-layer/eventmesh');
const logger = require('../../common/logger');
const CONST = require('../../common/constants');
const BaseManager = require('../BaseManager');
const DockerService = require('./DockerService');

class DockerManager extends BaseManager {

  init() {
    const queryString = `state in (${CONST.APISERVER.RESOURCE_STATE.IN_QUEUE},${CONST.APISERVER.RESOURCE_STATE.UPDATE},${CONST.APISERVER.RESOURCE_STATE.DELETE})`;
    return this.registerWatcher(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, CONST.APISERVER.RESOURCE_TYPES.DOCKER, queryString);
  }

  processRequest(requestObjectBody) {
    return Promise.try(() => {
      if (requestObjectBody.status.state === CONST.APISERVER.RESOURCE_STATE.IN_QUEUE) {
        return this._processCreate(requestObjectBody);
      } else if (requestObjectBody.status.state === CONST.APISERVER.RESOURCE_STATE.UPDATE) {
        return this._processUpdate(requestObjectBody);
      } else if (requestObjectBody.status.state === CONST.APISERVER.RESOURCE_STATE.DELETE) {
        return this._processDelete(requestObjectBody);
      }
    });
  }

  _processCreate(changeObjectBody) {
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    logger.info('Triggering backup with the following options:', changedOptions);
    //const plan = catalog.getPlan(changedOptions.plan_id);
    return DockerService.createDockerService(changeObjectBody.metadata.name, changedOptions)
      .then(dockerService => dockerService.create(changedOptions))
      .then(response => eventmesh.apiServerClient.updateResourceStateAndResponse({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceId: changeObjectBody.metadata.name,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DOCKER,
        response: response,
        stateValue: CONST.APISERVER.RESOURCE_STATE.SUCCEEDED
      }));
  }

  _processUpdate(changeObjectBody) {
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    logger.info('Triggering backup with the following options:', changedOptions);
    //const plan = catalog.getPlan(changedOptions.plan_id);
    return DockerService.createDockerService(changeObjectBody.metadata.name, changedOptions)
      .then(dockerService => dockerService.update(changedOptions))
      .then(response => eventmesh.apiServerClient.updateResourceStateAndResponse({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceId: changeObjectBody.metadata.name,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DOCKER,
        response: response,
        stateValue: CONST.APISERVER.RESOURCE_STATE.SUCCEEDED
      }));
  }

  _processDelete(changeObjectBody) {
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    logger.info('Triggering backup with the following options:', changedOptions);
    //const plan = catalog.getPlan(changedOptions.plan_id);
    return DockerService.createDockerService(changeObjectBody.metadata.name, changedOptions)
      .then(dockerService => dockerService.delete(changedOptions))
      .then(response => eventmesh.apiServerClient.updateResourceStateAndResponse({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceId: changeObjectBody.metadata.name,
        resourceType: CONST.APISERVER.RESOURCE_TYPES.DOCKER,
        response: response,
        stateValue: CONST.APISERVER.RESOURCE_STATE.SUCCEEDED
      }));
  }


}

module.exports = DockerManager;