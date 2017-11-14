'use strict';

const errors = require('../errors');
const NotImplementedBySubclass = errors.NotImplementedBySubclass;

class BaseProvisioner {

  registerWatcher() {
    throw new NotImplementedBySubclass('registerWatcher');
  }

    worker() {
    throw new NotImplementedBySubclass('registerWatcher');
  }

}

module.exports = BaseProvisioner;