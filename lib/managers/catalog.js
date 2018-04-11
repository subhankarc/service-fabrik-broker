'use strict';

const _ = require('lodash');
const config = require('../config');
const errors = require('../errors');
const Service = require('./Service');
const ServiceNotFound = errors.ServiceNotFound;
const ServicePlanNotFound = errors.ServicePlanNotFound;

class Catalog {
  constructor() {
    this.services = _.map(config.services, service => new Service(service));
    this.plans = _.flatMap(this.services, service => service.plans);
  }

  getPlan(id) {
    const plan = _.find(this.plans, plan => plan.id === id);
    if (!plan) {
      throw new ServicePlanNotFound(id);
    }
    return plan;
  }

  getService(id) {
    const service = _.find(this.services, ['id', id]);
    if (!service) {
      throw new ServiceNotFound(id);
    }
    return service;
  }

  toJSON() {
    return {
      services: this.services
    };
  }
}

module.exports = new Catalog();