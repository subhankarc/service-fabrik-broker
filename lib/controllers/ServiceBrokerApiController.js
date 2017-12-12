'use strict';

const assert = require('assert');
const _ = require('lodash');
const Promise = require('bluebird');
const errors = require('../errors');
const utils = require('../utils');
const catalog = require('../models/catalog');
const resourceManager = require('../resourcemanager');
const logger = require('../logger');
const CONST = require('../constants');
const BaseController = require('./BaseController');
const AssertionError = assert.AssertionError;
const BadRequest = errors.BadRequest;
const PreconditionFailed = errors.PreconditionFailed;
const ServiceInstanceAlreadyExists = errors.ServiceInstanceAlreadyExists;
const ServiceInstanceNotFound = errors.ServiceInstanceNotFound;
const ServiceBindingAlreadyExists = errors.ServiceBindingAlreadyExists;
const ServiceBindingNotFound = errors.ServiceBindingNotFound;
const ContinueWithNext = errors.ContinueWithNext;

class ServiceBrokerApiController extends BaseController {
  constructor() {
    super();
  }

  apiVersion(req, res) {
    /* jshint unused:false */
    const minVersion = '2.9';
    const maybeVersion = '2.8';
    const minCloudControllerApiVersion = '2.57.0';
    const version = _.get(req.headers, 'x-broker-api-version', '1.0');
    return Promise
      .try(() => {
        if (utils.compareVersions(version, minVersion) >= 0) {
          return;
        }
        if (utils.compareVersions(version, maybeVersion) < 0) {
          throw new PreconditionFailed(`At least Broker API version ${minVersion} is required.`);
        }
        return this.cloudController
          .getApiVersion()
          .then(apiVersion => {
            if (utils.compareVersions(apiVersion, minCloudControllerApiVersion) < 0) {
              throw new PreconditionFailed(`At least Cloud Controller API version ${minCloudControllerApiVersion} is required.`);
            }
          });
      })
      .throw(new ContinueWithNext());
  }

  getCatalog(req, res) {
    /* jshint unused:false */
    res.status(200).json(catalog);
  }

  putInstance(req, res) {
    const params = _.omit(req.body, 'plan_id', 'service_id');

    function done(resultStr) {
      const result = JSON.parse(resultStr);
      let statusCode = 201;
      const body = {
        dashboard_url: req.instance.dashboardUrl
      };
      if (result.error != null) {
        //throw it!
        logger.error('Error occured');
        res.status(409).send({});
        return;
      }
      if (req.instance.async) {
        statusCode = 202;
        logger.info('response is ', result.response);
        body.operation = utils.encodeBase64(result.response);
      }
      res.status(statusCode).send(body);
    }

    function conflict(err) {
      /* jshint unused:false */
      res.status(409).send({});
    }

    function getResourceStatus(resourceType, resourceId) {
      return Promise.try(() => {
        return resourceManager.manager.getResourceState(resourceType, resourceId);
      }).then(state => {
        if (state == CONST.RESOURCE_STATE.IN_PROGRESS || state == CONST.RESOURCE_STATE.SUCCEEDED) {
          return resourceManager.manager.getResourceKey(resourceType, resourceId, 'result');
        } else {
          return getResourceStatus(resourceType, resourceId);
        }
      });
    }

    return Promise
      .try(() => {
        // req.instance.create(params)
        const value = {};
        value.parameters = params;
        value.instance_id = req.params.instance_id;
        value.service_id = req.body.service_id || req.query.service_id;
        value.plan_id = req.body.plan_id || req.query.plan_id;
        return resourceManager.manager.createResource(req.instance.manager.name, req.instance.guid, JSON.stringify(value));
      })
      //.delay(5000)
      .then(() => {
        return getResourceStatus(req.instance.manager.name, req.instance.guid);
      })
      .then(done)
      .catch(ServiceInstanceAlreadyExists, conflict);
  }

  patchInstance(req, res) {
    const params = _
      .chain(req.body)
      .omit('plan_id', 'service_id')
      .cloneDeep()
      .value();
    //cloning here so that the DirectorInstance.update does not unset the 'service-fabrik-operation' from original req.body object

    function done(result) {
      let statusCode = 200;
      const body = {};
      if (req.instance.async) {
        statusCode = 202;
        body.operation = utils.encodeBase64(result);
      } else if (result && result.description) {
        body.description = result.description;
      }
      res.status(statusCode).send(body);
    }

    return Promise
      .try(() => {
        if (!req.manager.isUpdatePossible(params.previous_values.plan_id)) {
          throw new BadRequest(`Update to plan '${req.manager.plan.name}' is not possible`);
        }
        return req.instance.update(params);
      })
      .then(done);
  }

  deleteInstance(req, res) {
    const params = _.omit(req.query, 'plan_id', 'service_id');

    function done(result) {
      let statusCode = 200;
      const body = {};
      if (req.instance.async) {
        statusCode = 202;
        body.operation = utils.encodeBase64(result);
      }
      res.status(statusCode).send(body);
    }

    function gone(err) {
      /* jshint unused:false */
      res.status(410).send({});
    }

    return Promise
      .try(() => req.instance.delete(params))
      .then(done)
      .catch(ServiceInstanceNotFound, gone);
  }

  getLastInstanceOperation(req, res) {
    const operation = utils.decodeBase64(req.query.operation || 'bnVsbA==');
    const action = _.capitalize(operation.type);
    const instanceType = req.instance.constructor.typeDescription;
    const guid = req.instance.guid;

    function done(result) {
      const body = _.pick(result, 'state', 'description');
      res.status(200).send(body);
    }

    function failed(err) {
      res.status(200).send({
        state: 'failed',
        description: `${action} ${instanceType} '${guid}' failed because "${err.message}"`
      });
    }

    function gone() {
      res.status(410).send({});
    }

    function notFound(err) {
      if (operation.type === 'delete') {
        return gone();
      }
      failed(err);
    }

    if (operation.type === 'create') { //Now doing it only for create, later will have to do for all.
      return Promise.all([
        resourceManager.manager.getResourceState(req.instance.manager.name, req.instance.guid),
        resourceManager.manager.getResourceKey(req.instance.manager.name, req.instance.guid, 'lastoperation')
      ]).spread((state, resultStr) => {
        let description = '';
        if (resultStr != '') {
          description = JSON.parse(resultStr).response;
          if (JSON.parse(resultStr).error != null) {
            //HANDLE ERROR!!
          }
        }
        const body = {};
        body.state = state;
        if (state === 'deployed') {
          body.state = 'in progress';
        }
        body.description = description;
        res.status(200).send(body);
      });
    } else {
      return Promise
        .try(() => req.instance.lastOperation(operation))
        .then(done)
        .catch(AssertionError, failed)
        .catch(ServiceInstanceNotFound, notFound);

    }
  }

  putBinding(req, res) {
    const params = _(req.body)
      .omit('plan_id', 'service_id')
      .set('binding_id', req.params.binding_id)
      .value();

    function done(resultStr) {
      const result = JSON.parse(resultStr);
      if (result.error != null) {
        //throw it!
        logger.error('Error occured');
        res.status(409).send({});
        return;
      }
      res.status(201).send({
        credentials: result.response
      });
    }

    function conflict(err) {
      /* jshint unused:false */
      res.status(409).send({});
    }

    function getResourceAnnotationStatus(resourceType, resourceId) {
      return Promise.try(() => {
        return resourceManager.manager.getAnnotationState(resourceType, resourceId, 'bind', 'default', params.binding_id);
      }).then(state => {
        if (state == CONST.RESOURCE_STATE.IN_QUEUE) {
          return getResourceAnnotationStatus(resourceType, resourceId);
        } else {
          return resourceManager.manager.getAnnotationKey(resourceType, resourceId, 'bind', 'default', params.binding_id, 'result');
        }
      });
    }

    return Promise
      .try(() => {
        // req.instance.create(params)
        const value = {};
        value.parameters = params;
        value.instance_id = req.params.instance_id;
        value.service_id = req.body.service_id || req.query.service_id;
        value.plan_id = req.body.plan_id || req.query.plan_id;
        return resourceManager.manager.annotateResource(req.instance.manager.name, req.instance.guid, 'bind', 'default', params.binding_id, JSON.stringify(value));
      })
      //.delay(5000)
      .then(() => {
        return getResourceAnnotationStatus(req.instance.manager.name, req.instance.guid);
      })
      .then(done)
      .catch(ServiceInstanceAlreadyExists, conflict);
    // return Promise
    //   .try(() => req.instance.bind(params))
    //   .then(done)
    //   .catch(ServiceBindingAlreadyExists, conflict);
  }

  deleteBinding(req, res) {
    const params = _(req.query)
      .omit('plan_id', 'service_id')
      .set('binding_id', req.params.binding_id)
      .value();

    function done() {
      res.status(200).send({});
    }

    function gone(err) {
      /* jshint unused:false */
      res.status(410).send({});
    }

    return Promise
      .try(() => req.instance.unbind(params))
      .then(done)
      .catch(ServiceBindingNotFound, gone);
  }
}

module.exports = ServiceBrokerApiController;