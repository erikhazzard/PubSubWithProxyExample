"use strict";
/**
 *
 * PubSub Redis connector instance
 *
 * @module lib/pubsub__driver-redis-instance.js
 */

var redisConnection = require('./pubsub__driver-redis.js')({
    shards: [
        {
            host: 'localhost',
            port: 6379
        }
    ],

    // number of connections per shard
    connections: 1
});

console.log(">>>>>>>", redisConnection);
module.exports = redisConnection;
