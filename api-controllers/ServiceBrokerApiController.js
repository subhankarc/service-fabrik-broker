'use strict';

const assert = require('assert');
const _ = require('lodash');
const Promise = require('bluebird');
const errors = require('../common/errors');
const utils = require('../common/utils');
const catalog = require('../common/models/catalog');
const FabrikBaseController = require('./FabrikBaseController');
const lockManager = require('../data-access-layer/eventmesh').lockManager;
const AssertionError = assert.AssertionError;
const BadRequest = errors.BadRequest;
const PreconditionFailed = errors.PreconditionFailed;
const ServiceInstanceAlreadyExists = errors.ServiceInstanceAlreadyExists;
const ServiceInstanceNotFound = errors.ServiceInstanceNotFound;
const ServiceBindingAlreadyExists = errors.ServiceBindingAlreadyExists;
const ServiceBindingNotFound = errors.ServiceBindingNotFound;
const ContinueWithNext = errors.ContinueWithNext;
const CONST = require('../common/constants');
const config = require('../common/config');
const BasePlatformManager = require('../broker/lib/fabrik/BasePlatformManager');
const DirectorService = require('../managers/bosh-manager');

class ServiceBrokerApiController extends FabrikBaseController {
  constructor() {
    super();
  }

  apiVersion(req, res) {
    /* jshint unused:false */
    const minVersion = CONST.SF_BROKER_API_VERSION_MIN;
    const version = _.get(req.headers, 'x-broker-api-version', '1.0');
    return Promise
      .try(() => {
        if (utils.compareVersions(version, minVersion) >= 0) {
          return;
        } else {
          throw new PreconditionFailed(`At least Broker API version ${minVersion} is required.`);
        }
      })
      .throw(new ContinueWithNext());
  }

  getCatalog(req, res) {
    /* jshint unused:false */
    res.status(CONST.HTTP_STATUS_CODE.OK).json(this.fabrik.getPlatformManager(req.params.platform).getCatalog(catalog));
  }

  createDirectorService(req) {
    const instance_id = req.params.instance_id;
    const service_id = req.body.service_id || req.query.service_id;
    const plan_id = req.body.plan_id || req.query.plan_id;
    const plan = catalog.getPlan(plan_id);
    this.validateUuid(instance_id, 'Service Instance ID');
    this.validateUuid(service_id, 'Service ID');
    this.validateUuid(plan_id, 'Plan ID');
    const encodedOp = _.get(req, 'query.operation', undefined);
    const operation = encodedOp === undefined ? null : utils.decodeBase64(encodedOp);
    const context = _.get(req, 'body.context') || _.get(operation, 'context');
    //TODO : assign the platform context as well here.
    const directorService = new DirectorService(instance_id, plan);
    return Promise
      .try(() => context ? context : directorService.platformContext)
      .then(context => directorService.assignPlatformManager(ServiceBrokerApiController.getPlatformManager(context.platform)))
      .return(directorService);
  }

  static getPlatformManager(platform) {
    const PlatformManager = (platform && CONST.PLATFORM_MANAGER[platform]) ? require(`../fabrik/${CONST.PLATFORM_MANAGER[platform]}`) : ((platform && CONST.PLATFORM_MANAGER[CONST.PLATFORM_ALIAS_MAPPINGS[platform]]) ? require(`../fabrik/${CONST.PLATFORM_MANAGER[CONST.PLATFORM_ALIAS_MAPPINGS[platform]]}`) : undefined);
    if (PlatformManager === undefined) {
      return new BasePlatformManager(platform);
    } else {
      return new PlatformManager(platform);
    }
  }

  putInstance(req, res) {
    const params = _.omit(req.body, 'plan_id', 'service_id');

    function done(result) {
      let statusCode = CONST.HTTP_STATUS_CODE.CREATED;
      const body = {
        dashboard_url: req.instance.dashboardUrl
      };
      if (req.instance.async) {
        statusCode = CONST.HTTP_STATUS_CODE.ACCEPTED;
        body.operation = utils.encodeBase64(result);
      }
      res.status(statusCode).send(body);
    }

    function conflict(err) {
      /* jshint unused:false */
      res.status(CONST.HTTP_STATUS_CODE.CONFLICT).send({});
    }

    req.operation_type = CONST.OPERATION_TYPE.CREATE;

    return Promise
      .try(() => this.createDirectorService(req))
      .then(directorService => directorService.create(params))
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
      let statusCode = CONST.HTTP_STATUS_CODE.OK;
      const body = {};
      if (req.instance.async) {
        statusCode = CONST.HTTP_STATUS_CODE.ACCEPTED;
        body.operation = utils.encodeBase64(result);
      }
      res.status(statusCode).send(body);
    }

    req.operation_type = CONST.OPERATION_TYPE.UPDATE;

    return Promise
      .try(() => {
        if (!req.manager.isUpdatePossible(params.previous_values.plan_id)) {
          throw new BadRequest(`Update to plan '${req.manager.plan.name}' is not possible`);
        }
        return this.createDirectorService(req);
      })
      .then(directorService => directorService.update(params))
      .then(done);
  }

  deleteInstance(req, res) {
    const params = _.omit(req.query, 'plan_id', 'service_id');

    function done(result) {
      let statusCode = CONST.HTTP_STATUS_CODE.OK;
      const body = {};
      if (req.instance.async) {
        statusCode = CONST.HTTP_STATUS_CODE.ACCEPTED;
        body.operation = utils.encodeBase64(result);
      }
      res.status(statusCode).send(body);
    }

    function gone(err) {
      /* jshint unused:false */
      res.status(CONST.HTTP_STATUS_CODE.GONE).send({});
    }
    req.operation_type = CONST.OPERATION_TYPE.DELETE;

    return Promise
      .try(() => this.createDirectorService(req))
      .then(directorService => directorService.delete(params))
      .then(done)
      .catch(ServiceInstanceNotFound, gone);
  }
  getLastInstanceOperation(req, res) {
    const encodedOp = _.get(req, 'query.operation', undefined);
    const operation = encodedOp === undefined ? null : utils.decodeBase64(encodedOp);
    const action = _.capitalize(operation.type);
    const instanceType = req.instance.constructor.typeDescription;
    const guid = req.instance.guid;

    function done(result) {
      const body = _.pick(result, 'state', 'description');
      // Unlock resource if state is succeeded or failed
      if (result.state === CONST.OPERATION.SUCCEEDED || result.state === CONST.OPERATION.FAILED) {
        return lockManager.unlock(req.params.instance_id)
          .then(() => res.status(CONST.HTTP_STATUS_CODE.OK).send(body));
      }
      res.status(CONST.HTTP_STATUS_CODE.OK).send(body);
    }

    function failed(err) {
      return lockManager.unlock(req.params.instance_id)
        .then(() => res.status(CONST.HTTP_STATUS_CODE.OK).send({
          state: CONST.OPERATION.FAILED,
          description: `${action} ${instanceType} '${guid}' failed because "${err.message}"`
        }));
    }

    function gone() {
      return lockManager.unlock(req.params.instance_id)
        .then(() => res.status(CONST.HTTP_STATUS_CODE.GONE).send({}));
    }

    function notFound(err) {
      if (operation.type === 'delete') {
        return gone();
      }
      failed(err);
    }

    return this.createDirectorService(req)
      .then(directorService => directorService.lastOperation(operation))
      .then(done)
      .catch(AssertionError, failed)
      .catch(ServiceInstanceNotFound, notFound);
  }

  putBinding(req, res) {
    const params = _(req.body)
      .omit('plan_id', 'service_id')
      .set('binding_id', req.params.binding_id)
      .value();

    function done(credentials) {
      res.status(CONST.HTTP_STATUS_CODE.CREATED).send({
        credentials: credentials
      });
    }

    function conflict(err) {
      /* jshint unused:false */
      res.status(CONST.HTTP_STATUS_CODE.CONFLICT).send({});
    }

    return Promise
      .try(() => this.createDirectorService(req))
      .then(directorService => directorService.bind(params))
      .then(done)
      .catch(ServiceBindingAlreadyExists, conflict);
  }

  deleteBinding(req, res) {
    const params = _(req.query)
      .omit('plan_id', 'service_id')
      .set('binding_id', req.params.binding_id)
      .value();

    function done() {
      res.status(CONST.HTTP_STATUS_CODE.OK).send({});
    }

    function gone(err) {
      /* jshint unused:false */
      res.status(CONST.HTTP_STATUS_CODE.GONE).send({});
    }

    return Promise
      .try(() => this.createDirectorService(req))
      .then(directorService => directorService.unbind(params))
      .then(done)
      .catch(ServiceBindingNotFound, gone);
  }

}

module.exports = ServiceBrokerApiController;