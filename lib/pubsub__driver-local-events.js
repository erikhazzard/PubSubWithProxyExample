"use strict";
/**
 *
 * Handles local event-emitter driven pub/sub layer. Used to mock redis 
 * connection for tests
 *
 * @module lib/pubsub__driver-local-events.js
 */
var EventEmitter = require('events').EventEmitter;
var pubSubEvents = new EventEmitter();
pubSubEvents.setMaxListeners(Infinity);

/**
 * NOTE: This is a mock implements of pubsub__driver-redis but mocked out
 * locally. The API this is implemented agains is in pubsub__driver-redis
 */
let connectionLocal = {
    // Don't need clients, can do it all locally
    _clients: [{}],
    _numSubscriptionsByRoutingKey: {},

    publish: function publish (routingKey, message, publishedCallback) {
        pubSubEvents.emit('channel:' + routingKey, message);
        publishedCallback(null);
        return this;
    },

    subscribe: function subscribe (routingKey, callback) {
        // Keep track of each routingKey. Emit events which only those routing
        // key listeners receive when a message comes over
        pubSubEvents.on('channel:' + routingKey, callback);

        if (!this._numSubscriptionsByRoutingKey[routingKey]) {
            this._numSubscriptionsByRoutingKey[routingKey] = 0; // initial value
        }
        this._numSubscriptionsByRoutingKey[routingKey]++;

        return this;
    },

    unsubscribe: function unsubscribe (routingKey, callback) {
        // decrement count by routingKey
        this._numSubscriptionsByRoutingKey[routingKey] = this._numSubscriptionsByRoutingKey[routingKey] || 1;
        this._numSubscriptionsByRoutingKey[routingKey]--;

        if (this._numSubscriptionsByRoutingKey[routingKey] < 0) {
            this._numSubscriptionsByRoutingKey[routingKey] = 0;
        }

        // get rid of our pubsub listener
        pubSubEvents.removeListener('channel:' + routingKey, callback);

        return this;
    }

};

module.exports = connectionLocal;
