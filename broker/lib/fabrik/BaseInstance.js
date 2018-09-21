'use strict';

const errors = require('../../../common/errors');
//TODO-CF-DEPENDENCY
const cf = require('../../../data-access-layer/cf');
const cloudController = cf.cloudController;
const serviceFabrikClient = cf.serviceFabrikClient;
const NotImplementedBySubclass = errors.NotImplementedBySubclass;

class BaseInstance {
  constructor(guid, manager) {
    this.guid = guid;
    this.manager = manager;
    this.platformManager = undefined;
    this.cloudController = cloudController;
    this.serviceFabrikClient = serviceFabrikClient;
  }

  static get typeDescription() {
    return 'service instance';
  }

  get plan() {
    return this.manager.plan;
  }

  get service() {
    return this.manager.service;
  }

  get dashboardUrl() {
    return this.manager.getDashboardUrl(this.guid);
  }

  get securityGroupName() {
    return this.manager.getSecurityGroupName(this.guid);
  }

  isUpdatePossible(plan_id) {
    return this.manager.isUpdatePossible(plan_id);
  }

  get platformContext() {
    throw new NotImplementedBySubclass('platformContext');
  }

  create(params) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('create');
  }

  update(params) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('update');
  }

  delete(params) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('delete');
  }

  lastOperation(params) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('lastOperation');
  }

  bind(params) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('bind');
  }

  unbind(params) {
    /* jshint unused:false */
    throw new NotImplementedBySubclass('unbind');
  }

  buildIpRules() {
    throw new NotImplementedBySubclass('buildIpRules');
  }

  assignPlatformManager(platformManager) {
    this.platformManager = platformManager;
  }
}

module.exports = BaseInstance;