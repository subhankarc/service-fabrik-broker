'use strict';

const Promise = require('bluebird');
const eventmesh = require('../../data-access-layer/eventmesh');
const logger = require('../../common/logger');
const CONST = require('../../common/constants');
const BaseManager = require('../BaseManager');
const errors = require('../../common/errors');
const utils = require('../../common/utils');
const ServiceInstanceNotFound = errors.ServiceInstanceNotFound;
const assert = require('assert');
const child_process = require('child_process');

class K8sManager extends BaseManager {
  init() {
    const validStateList = [CONST.APISERVER.RESOURCE_STATE.IN_QUEUE, CONST.APISERVER.RESOURCE_STATE.UPDATE, CONST.APISERVER.RESOURCE_STATE.DELETE];
    return this.registerCrds(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, 'kubes')
      .then(() => this.registerWatcher(CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT, 'kubes', validStateList));
  }

  processRequest(changeObjectBody) {
    return Promise.try(() => {
        switch (changeObjectBody.status.state) {
        case CONST.APISERVER.RESOURCE_STATE.IN_QUEUE:
          return this._processCreate(changeObjectBody);
        case CONST.APISERVER.RESOURCE_STATE.UPDATE:
          return this._processUpdate(changeObjectBody);
        case CONST.APISERVER.RESOURCE_STATE.DELETE:
          return this._processDelete(changeObjectBody);
        default:
          logger.error('Ideally it should never come to default state! There must be some error as the state is ', changeObjectBody.status.state);
          break;
        }
      })
      .catch(err => {
        logger.error('Error occurred in processing request by BoshManager', err);
        return eventmesh.apiServerClient.updateResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
          resourceType: 'kubes',
          resourceId: changeObjectBody.metadata.name,
          status: {
            state: CONST.APISERVER.RESOURCE_STATE.FAILED,
            lastOperation: {
              state: CONST.APISERVER.RESOURCE_STATE.FAILED,
              description: CONST.SERVICE_BROKER_ERR_MSG
            },
            error: utils.buildErrorJson(err)
          }
        });
      });
  }

  _processCreate(changeObjectBody) {
    assert.ok(changeObjectBody.metadata.name, `Argument 'metadata.name' is required to process the request`);
    assert.ok(changeObjectBody.spec.options, `Argument 'spec.options' is required to process the request`);
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    assert.ok(changedOptions.plan_id, `Argument 'spec.options' should have an argument plan_id to process the request`);
    logger.info('Creating deployment resource with the following options:', changedOptions);
    //Put your code here
    const response = {
      'deployment_name': changeObjectBody.metadata.name
    };
    return Promise.try(() => {
        // spawn a bin
        return child_process.spawnSync('/Users/i068838/git/kube-provisioner/src/kube-provisioner/create', [changeObjectBody.metadata.name]);
      })
      .then(() => eventmesh.apiServerClient.updateResource({
        resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
        resourceType: 'kubes',
        resourceId: changeObjectBody.metadata.name,
        status: {
          response: response,
          state: CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS
        }
      }));
  }

  _processUpdate(changeObjectBody) {
    assert.ok(changeObjectBody.metadata.name, `Argument 'metadata.name' is required to process the request`);
    assert.ok(changeObjectBody.spec.options, `Argument 'spec.options' is required to process the request`);
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    assert.ok(changedOptions.plan_id, `Argument 'spec.options' should have an argument plan_id to process the request`);
    logger.info('Updating deployment resource with the following options:', changedOptions);
    //Put your code here
    const response = {
      'foo': 'bar'
    };
    return eventmesh.apiServerClient.updateResource({
      resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
      resourceType: 'kubes',
      resourceId: changeObjectBody.metadata.name,
      status: {
        response: response,
        state: CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS
      }
    });
  }

  _processDelete(changeObjectBody) {
    assert.ok(changeObjectBody.metadata.name, `Argument 'metadata.name' is required to process the request`);
    assert.ok(changeObjectBody.spec.options, `Argument 'spec.options' is required to process the request`);
    const changedOptions = JSON.parse(changeObjectBody.spec.options);
    assert.ok(changedOptions.plan_id, `Argument 'spec.options' should have an argument plan_id to process the request`);
    logger.info('Deleting deployment resource with the following options:', changedOptions);
    //Put your code here
    const response = {
      'deployment_name': changeObjectBody.metadata.name
    };
    return Promise.try(() => {
        // spawn a bin
        return child_process.spawnSync('/Users/i068838/git/kube-provisioner/src/kube-provisioner/delete', [changeObjectBody.metadata.name]);
      })
      .then(() => eventmesh.apiServerClient.updateResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
          resourceType: 'kubes',
          resourceId: changeObjectBody.metadata.name,
          status: {
            response: response,
            state: CONST.APISERVER.RESOURCE_STATE.IN_PROGRESS
          }
        })
        .catch(ServiceInstanceNotFound, () => eventmesh.apiServerClient.deleteResource({
          resourceGroup: CONST.APISERVER.RESOURCE_GROUPS.DEPLOYMENT,
          resourceType: 'kubes',
          resourceId: changeObjectBody.metadata.name
        })));
  }
}

module.exports = K8sManager;