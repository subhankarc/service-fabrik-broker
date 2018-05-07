'use strict';

const assert = require('assert');
const Promise = require('bluebird');
const catalog = require('../../../managers').catalog;
const DirectorManager = require('./DirectorManager');
const CONST = require('../../../constants');

class Fabrik {
  static createManager(plan) {
    return Promise
      .try(() => {
        return DirectorManager;
      })
      .then(managerConstructor => managerConstructor.load(plan));
  }

}
Fabrik.DirectorManager = DirectorManager;
module.exports = Fabrik;