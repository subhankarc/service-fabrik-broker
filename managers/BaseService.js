'use strict';

const _ = require('lodash');
const CONST = require('../common/constants');
const Agent = require('../data-access-layer/service-agent');
const errors = require('../common/errors');
const NotImplemented = errors.NotImplemented;

class BaseService {
  constructor(plan) {
    this.plan = plan;
    this.agent = new Agent(this.settings.agent);
  }

  get settings() {
    return this.plan.manager.settings;
  }

  getTenantGuid(context) {
    if (context.platform === CONST.PLATFORM.CF) {
      return context.space_guid;
    } else if (context.platform === CONST.PLATFORM.K8S) {
      return context.namespace;
    }
  }

  get service() {
    return this.plan.service;
  }

  get name() {
    return this.plan.manager.name;
  }

  get updatePredecessors() {
    return this.settings.update_predecessors || [];
  }

  get restorePredecessors() {
    return this.settings.restore_predecessors || this.updatePredecessors;
  }

  isRestorePossible(plan_id) {
    const previousPlan = _.find(this.service.plans, ['id', plan_id]);
    return this.plan === previousPlan || _.includes(this.restorePredecessors, previousPlan.id);
  }

  verifyFeatureSupport(feature) {
    if (!_.includes(this.agent.features, feature)) {
      throw new NotImplemented(`Feature '${feature}' not supported`);
    }
  }

  get securityGroupName() {
    return `${this.constructor.prefix}-${this.guid}`;
  }
}

module.exports = BaseService;