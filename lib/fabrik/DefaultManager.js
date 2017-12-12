'use strict';

const BaseManager = require('./BaseManager');
const DefaultInstance = require('./DefaultInstance');
class DefaultManager extends BaseManager {
  constructor(plan) {
    super(plan);
  }

  static get instanceConstructor() {
    return DefaultInstance;
  }

  static load(plan) {
    if (!this[plan.id]) {
      this[plan.id] = new this(plan);
    }
    return Promise.resolve(this[plan.id]);
  }
}

module.exports = DefaultManager;