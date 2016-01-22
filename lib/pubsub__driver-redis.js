"use strict";
/**
 *
 * Handles created a redis connection wrapper for the carrot pubsub client.
 * This SHOULD not be imported anywhere other than the `pubsub__driver-redis-instance.js`
 * module or for unit tests. Only a single connection wrapper object needs to
 * exist - it handles created multiple redis connections.
 *
 * The pub/sub layer uses application level sharding. Redis has built in pubsub
 * sharding that works well, however, at high publisher rates it does not scale
 * well and eats up network traffic.
 *      (See https://github.com/antirez/redis/issues/2672)
 *
 *
 * TODO: Before unsubscribing, ensure client is connected. If not connected,
 * exponentially backoff
 *
 * Tradeoffs made:
 *      * Messages may be dropped - either not published or not delivered - in
 *      the case of a server failure.
 *      * We make this tradeoff for performance / speed / development time
 *      * Clients can manually fetch messages since X to help fill this gap,
 *      so it can be mitigated
 *
 * @module lib/pubsub__driver-redis.js
 */
var _ = require('lodash');
var logger = require('bragi');
var Redis = require('ioredis');
var getStringSize = require('./util/helpers.js').getStringSize;

var EventEmitter = require('events').EventEmitter;
var pubSubEvents = new EventEmitter();
pubSubEvents.setMaxListeners(Infinity);

/**
 *
 * Redis Connection object creator. Only one of these connection wrappers
 * per process should exist (there is no need to create more than one of these
 * objects, apart from in unit tests)
 *
 * @param {Object} options - Configuration options
 * @param {Array} options.shards - Array of redis configuration objects, e.g.,
 *      [{ host: 'localhost', port: 6379 }]
 * @param {Array} options.connections - Number of local connection objects to
 *      create *per* shard. This number can be 1 and a single connection can
 *      be shared amongst all pubsub clients (keep in mind, the server is running
 *      clustered so for each machine there will be
 *      numProcesses * numShards * connections). If a value > 1 is passed in,
 *      that many connection objects *per* cluster will be created
 * @returns {ConnectionObject} returns a redis connection object
 */
function redisConnectionFactory (options) {
    // TODO: Get shards from config
    let SHARDS = options.shards || [
        {
            host: 'localhost',
            post: 6379
        }
    ];
    const SHARDS_LENGTH = SHARDS.length;

    // How many local connections we should create to the shard
    // TODO: We might not need more than 1 connection per shard. If we do add this,
    // the same routingKey must always return the same connection
    let NUM_CONNECTIONS_PER_SHARD = options.connections || options.numConnectionsPerShard || 1;

    /**
     * Creates a redis client.
     *
     * Also handles falling back to polling when necessary
     * Subscription has two modes:
     *  1) PubSub (default)
     *  2) Polling
     *
     * Polling is used to fetch messages for rooms which reach a message / sec
     * rate above some threshhold. This mode is automatically switched to.
     * Polling could also be used to fetch messages for rooms the user is not
     * currently looking at.
     *
     * Handles connection errors, re-sharding, automatic switching to fetching
     * if message
     *
     * TODO: Determine good message / sec rate
     * TODO: Implement fallback behavior
     * TODO: Implement behavior to re-subscribe to pubsub layer if message rate
     * becomes low again
     * TODO: Caller should be able to set mode to polling and configure rates
     *
     * @param {String} shard - Shard index
     * @param {String} type - 'pub' or 'sub'
     */
    function createRedisClient (shard, type) {
        var configOptions = {
            host: shard.host,
            port: shard.port
        };

        var redisClient = new Redis(configOptions);

        let lastErrorDate = Date.now();
        redisClient.on('error', (err) => {
            if (Date.now() - lastErrorDate > 1000) {
                logger.log('error:pubsub__driver-redis/client:error', 'error with redis client: ' + err);
                lastErrorDate = Date.now();
            }
        });

        redisClient.on('connect', () => {
            logger.log('pubsub__driver-redis/client:connect', 'connecting: %j', {
                shard: shard, type: type
            });
        });

        /**
         * When message comes in on a sub connection, inform all listeners
         */
        if (type === 'sub') {
            redisClient.on('message', (channel, message) => {
                // TODO: Check message rate. If it's too high, fall back to polling
                // and unsubscribe from the channel

                // emit a message
                pubSubEvents.emit('channel:' + channel, message);
            });
        }
        return redisClient;
    }

    /**
     *
     * Redis Client setup
     *
     * Note: Two types of clients are needed - a subscriber client (for sub) and a
     * publisher client (for pub calls)
     *
     */
    var subscriberClientsPerShard = {
        //shardIndex: [ redisClientObjects ]
    };
    var publisherClientsPerShard = {}; // same structure as subscrber

    SHARDS.forEach((shard, shardIndex) => {
        _.range(NUM_CONNECTIONS_PER_SHARD).forEach((i) => {
            subscriberClientsPerShard[shardIndex] = subscriberClientsPerShard[shardIndex] || [];
            publisherClientsPerShard[shardIndex] = publisherClientsPerShard[shardIndex] || [];

            // create a sub and pub client for each connection and shard
            subscriberClientsPerShard[shardIndex].push(createRedisClient(shard, 'sub'));
            publisherClientsPerShard[shardIndex].push(createRedisClient(shard, 'pub'));
        });
    });

    /**
     * Shard and connection calculation. This must be re-producible on all servers,
     * so we cannot simply use a round robin approach
     * @returns {Array} Returns an array of [shard, connectionIndex]
     */
    function getShardAndConnectionFromRoutingKey (routingKey) {
        // For now, do round robin. This is a naive approach; ideally, we should
        // shard based on distribution of users in a room
        var shardIndex = getStringSize(routingKey) % SHARDS_LENGTH;
        var connectionIndex = getStringSize(routingKey) % NUM_CONNECTIONS_PER_SHARD;
        return [shardIndex, connectionIndex];
    }

    /**
     *
     * Connection object setup (returns a single object)
     *
     */
    let connectionRedis = {
        _numSubscriptionsByRoutingKey: {},

        /**
         * Returns a redis client for the passed in routingKey. Handles shard key
         * generation
         *
         * @return {redisClient} - Returns an ioredis client object
         */
        getSubscriberClientForRoutingKey: function getSubscriberClientForRoutingKey (routingKey) {
            var keys = getShardAndConnectionFromRoutingKey(routingKey);
            // TODO: Calculate shard
            return subscriberClientsPerShard[keys[0]][keys[1]];
        },

        getPublisherClientForRoutingKey: function getPublisherClientForRoutingKey (routingKey) {
            // TODO: Calculate shard
            var keys = getShardAndConnectionFromRoutingKey(routingKey);
            return publisherClientsPerShard[keys[0]][keys[1]];
        },

        /**
         * Publish a message to a routing key. Adds an additional layer of
         * re-publishing in case publisher comes online before subscribers
         *
         * @param {String} routingKey - required key to listen for messages on
         * @param {String} message - required message to publish to routingKey
         * @param {Function} [publishedCallback] - function to call after publishing
         */
        publish: function publish (routingKey, message, publishedCallback) {
            publishedCallback = publishedCallback || function () {};
            var _this = this;
            var numAttempts = 0;

            // Do not only on ioredis's re-publish commands. The problem is that if
            // the publishers reconnect *before* subscribers reconnect, nobody
            // will receive the message.
            // Note this is a very clumsy way to do it, as we don't know many
            // subscribers to expect. It's possible that there may legitimately
            // be no clients listening (uncommong - in the case of a server crash)
            // or it may be the case that not all remote clients have re-connected
            // (this will be a common occurrence).
            // We make a trade-off here for performance, but may drop messages.
            //
            // Potential solutions: clients could hook into the `connect` event
            // and fetch all messages after some timeout to help fill the gap.

            // The subscriber's callback function will always return first
            // (message published --> subscribers receive message --> publisher callback received with # of subscribers reached)
            function publishIt () {
                _this.getPublisherClientForRoutingKey(routingKey)
                    .publish(routingKey, message, function wrappedPubCallback (err, numReceivers) {
                        // attempt to re-publish. If it's been too long, discard
                        // message (assuming ioredis doesn't pick up message)
                        if (numAttempts < 6 && numReceivers === 0) {
                            numAttempts++;
                            setTimeout(publishIt, 300 * numAttempts);

                        } else {
                            return publishedCallback(err);
                        }
                    });
            }
            publishIt();
        },

        /**
         *
         * subscribes to a routingKey (channel), calling the passed in callback when
         * a message is published
         *
         * @param {String} routingKey - required key to listen for messages on
         * @param {Function} callback - required function to call when a message is
         * received
         */
        subscribe: function subscribe (routingKey, callback) {
            // Keep track of each routingKey. Emit events which only those routing
            // key listeners receive when a message comes over
            if (!routingKey || !callback) {
                throw new Error('No routing key or callback passed in');
            }

            /**
             * Redis settings
             */
            // subscribe to messages over redis for the passed in routing key
            // if it hasn't already been subscribed to (to avoid duplicate subscribe
            // calls)
            if (!this._numSubscriptionsByRoutingKey[routingKey]) {
                this.getSubscriberClientForRoutingKey(routingKey).subscribe(routingKey);
                this._numSubscriptionsByRoutingKey[routingKey] = 0; // initial value
            }
            // TODO: check mode - pubsub or polling

            /**
             * Our pubsub proxy layer. Add a listener so that when a message comes
             * in, the PubSub client subscriber will get notified. (Note that the
             * redis pubsub layer already has a message listener defined when
             * the connection is setup, which will emit the message to any of our
             * PubSub clients connected)
             */
            this._numSubscriptionsByRoutingKey[routingKey]++;
            pubSubEvents.on('channel:' + routingKey, callback);

            return this;
        },

        /**
         *
         * @param {String} routingKey - key to stop listening for messages on
         * @param {Function} callback - callback to remove - this is the callback
         * which is fired when a message for the routing key comes in. It must
         * be the same callback as was passed in to subscribe()
         */
        unsubscribe: function unsubscribe (routingKey, callback) {
            // decrement count by routingKey
            this._numSubscriptionsByRoutingKey[routingKey] = this._numSubscriptionsByRoutingKey[routingKey] || 1;
            this._numSubscriptionsByRoutingKey[routingKey]--;

            if (this._numSubscriptionsByRoutingKey[routingKey] < 0) {
                this._numSubscriptionsByRoutingKey[routingKey] = 0;
            }

            // Unsubscribe from the redis layer if there are no more listeners
            if (this._numSubscriptionsByRoutingKey[routingKey] < 1) {
                this.getSubscriberClientForRoutingKey(routingKey).unsubscribe(routingKey);
            }

            // get rid of our pubsub listener
            pubSubEvents.removeListener('channel:' + routingKey, callback);

            return this;
        }
    };

    return connectionRedis;
}
module.exports = redisConnectionFactory;
