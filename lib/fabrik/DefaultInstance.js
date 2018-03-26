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
    /* jshint unused:false */
    logger.info('Create called');
  }

  update(params) {
    /* jshint unused:false */
    logger.info('update called');
  }

  delete(params) {
    /* jshint unused:false */
    logger.info('delete called');
  }

  lastOperation(params) {
    /* jshint unused:false */
    logger.info('lastOperation called');
  }

  bind(params) {
    /* jshint unused:false */
    logger.info('bind called');
  }

  unbind(params) {
    /* jshint unused:false */
    logger.info('unbind called');
  }

  buildSecurityGroupRules() {
    logger.info('buildSecurityGroupRules called');
  }

}

module.exports = DefaultInstance;