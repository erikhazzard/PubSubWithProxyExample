"use strict";
/**
 *
 * Handles the pub/sub messaging layer. Clients can subscribe to rooms,
 * usernames, server events (TODO: See more)
 *
 * Exposes a pubsub object which clients can call subscribe() and ubsubscribe()
 * (see below)
 *
 * Server failures need to be taken into account and more robust strategies
 * for automatic reconnectioning and handling failover must exist
 *
 * Notes:
 * -What happens if we change how the shard keys are calculated?
 *      -When shard keys change, any subs may not receive messages to
 *          publishers
 *      -This would require a restart of all services for a simple approach
 *      -Alternatively, we could persist the shard key info in a DB and
 *          periodically update it
 *
 *  @module lib/pubsub-client
 */
var uuid = require('uuid');
var logger = require('bragi');
var microtime = require('microtime');

// Connection driver
var connectionWrapperRedis = require('./pubsub__driver-redis-instance.js');

/**
 *
 *
 * PubSub client
 *
 *
 */
/**
 *
 * Shared PubSubClient functions
 *
 */

/**
 * Publishes a message to the corresponding connection instance. Handles cases
 * for when client is not connected
 *
 * @param {String} routingKey - required routing key (roomId, username, etc)
 * @param {Object} message - required message object or string
 * @param {Function} [callback] - optional function called after message is published
 */
function publish (routingKey, message, callback) {
    callback = callback || function () {};
    if (!routingKey || !message) {
        return callback({error: true, message: 'Invalid params', status: 400});
    }

    var start = microtime.now();

    //// TODO: Message augmenting. Add additional meta properties to the messge
    // message._publishDate = start;
    // message._pubId = this.id;

    // TODO: Should we use protobuff to store messages? Store in a different
    // format?
    // Serialize the message
    if (typeof message !== 'string') { message = JSON.stringify(message); }

    // Publish message over connection. Connection wrapper handles error
    // cases (e.g., server unreachable)
    return this.connectionWrapper.publish(
        routingKey,
        message,
        callback
    );
}

/**
 * String representation of object
 */
function toString () { return 'PubSub Client: ' + this.id; }

/**
 * Returns a PubSub object. Called like:
 *  `var pubSubClient = require('./pubsub-client')({ options });'
 *
 * @name PubSub#publish
 * @name PubSub#subscribe
 *
 * @param {Object} [options] - Optional configuration options
 *
 * @param {Object} [optoins.connectionWrapper] - Allows a different connection wrapper
 * object (useful for testing). Defaults to use Redis
 * @returns {PubSubObject} Returns a pubsub object with publish and subscribe
 * functionality
 */
function pubSubClientFactory (options) {
    // Returned client object
    let client = {};

    // private variables
    let _subCallbacksByRoutingKey = {};

    // Define some read online properties, like `id`
    Object.defineProperty(client, 'id', {
        value: uuid.v4(),
        writable: false,
        enumerable: true,
        configurable: false
    });

    let numMessagesPerRoutingKey = {};
    client.numMessagesPerRoutingKey = numMessagesPerRoutingKey;

    // Variables which can be overridden (e.g., by tests for mocking)
    client.connectionWrapper = options.connectionWrapper || connectionWrapperRedis;

    /**
     *
     * Pub / Sub (and unsub)
     *
     */
    client.publish = publish;

    /**
     * Subscribe to routing key with callback.
     * This is created as a closure so private variables can be set to keep
     * track of callbacks passed into subscribe so that unsubsribe calls can
     * be simpler.
     *
     * @param {String} routingKey - required key to listen for messages on
     * @param {Function} callback - Function to call when a message is received. Must
     *        have signature of (message)
     */
    function subscribe (routingKey, callback) {
        callback = callback || function (message) {};
        numMessagesPerRoutingKey[routingKey] = numMessagesPerRoutingKey[routingKey] || 0; // set initial count

        if (_subCallbacksByRoutingKey[routingKey]) {
            // remove existing function (if one exists) and unsubscribe
            this.unsubscribe(routingKey);
        }

        /**
         * wrap the passed in callback so the message can be de-serialized
         * and meta information tracked
         */
        var wrappedCallback = (message) => {
            message = JSON.parse(message);
            numMessagesPerRoutingKey[routingKey]++;
            callback(message); // original callback
        };

        // store and subscribe
        _subCallbacksByRoutingKey[routingKey] = wrappedCallback;

        // TODO: if pubsub client is a polling subscription, set it here
        this.connectionWrapper.subscribe(routingKey, wrappedCallback);

        return this;
    }
    client.subscribe = subscribe;

    /**
     * Unsubscribe from a routingKey. The callback for subscribe() is used to
     * unsubscribe from the driver layer, so the caller does not need to
     * keep track of and pass in the original callback
     *
     * @param {String} routingKey - target routingKey to unsubscribe from
     */
    function unsubscribe (routingKey) {
        this.connectionWrapper.unsubscribe(routingKey, _subCallbacksByRoutingKey[routingKey]);
        delete _subCallbacksByRoutingKey[routingKey];
    }
    client.unsubscribe = unsubscribe;

    // set toString function reference
    client.toString = toString;

    return client;
}
module.exports = pubSubClientFactory;
