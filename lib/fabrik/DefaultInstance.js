'use strict';

const BaseInstance = require('./BaseInstance');
const logger = require('../logger');

class DefaultInstance extends BaseInstance {
  constructor(guid, manager) {
    super(guid, manager);
  }

  get async() {
    return false;
  }

  create(params) {
    logger.info('Create called');
  }

  update(params) {
    logger.info('update called');
  }

  delete(params) {
    logger.info('delete called');
  }

  lastOperation(params) {
    logger.info('lastOperation called');
  }

  bind(params) {
    logger.info('bind called');
  }

  unbind(params) {
    logger.info('unbind called');
  }

  buildSecurityGroupRules() {
    logger.info('buildSecurityGroupRules called');
  }

}

module.exports = DefaultInstance;